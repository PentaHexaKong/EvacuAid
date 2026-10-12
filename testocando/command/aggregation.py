"""Set-based PostGIS projection; HTTP reads never perform spatial aggregation."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import defer

from app.models.hazard import Authority, EvidenceType, HazardEvidence, HazardType
from command.models import Region, RegionalOperationalSnapshot
from command.schemas import AssistanceAggregate, HazardSummary, RegionDetail, ShelterSummary

SIGNAL_ORDER = {'CRITICAL': 0, 'ELEVATED': 1, 'WATCH': 2, 'UNKNOWN': 3, 'NORMAL': 4}
ACTIVE_STATUSES = {'REQUESTED', 'NOTIFIED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'EVACUATING', 'WAITING', 'FALLBACK_REQUIRED', 'MATCHED', 'MEETING', 'ACTIVE'}


def priorityKey(region):
    def descending(value):
        return (value is None, -(value or 0))
    return (SIGNAL_ORDER[region.signalLevel], not region.authoritativeCriticalHazard,
            descending(region.estimatedExposedPopulation), descending(region.activeAssistanceCount),
            region.evidenceFreshness == 'FRESH', region.code)


def exposureEstimate(population, fraction):
    if population is None or fraction is None:
        return None, 'UNKNOWN'
    return round(population * min(1, max(0, fraction))), 'AREA_WEIGHTED_ESTIMATE'


def classifyEvidence(item, now):
    simulation = item.metadata.get('simulation') is True or item.metadata.get('fixture') is not None or item.source.upper().startswith(('DEMO', 'SIMULATION', 'SYNTHETIC'))
    if simulation:
        provenance = 'SIMULATION'
    elif item.evidenceType.value == 'BASELINE_HAZARD':
        provenance = 'OFFICIAL_BASELINE' if item.authority.value == 'OFFICIAL' else item.authority.value
    elif item.authority.value == 'OFFICIAL':
        provenance = 'OFFICIAL_ACTIVE'
    elif item.authority.value == 'COMMUNITY':
        provenance = 'COMMUNITY_OBSERVATION'
    else:
        provenance = 'SATELLITE_OBSERVATION'
    if not item.active(now):
        freshness = 'EXPIRED' if item.validUntil and item.validUntil <= now else 'FUTURE'
    elif item.observedAt is not None and item.observedAt > now:
        freshness = 'UNKNOWN'
    elif item.evidenceType.value == 'BASELINE_HAZARD':
        freshness = 'REFERENCE'
    elif item.observedAt is None:
        freshness = 'UNKNOWN'
    elif item.validUntil is not None:
        freshness = 'FRESH'
    elif now - item.observedAt > timedelta(hours=24):
        freshness = 'STALE'
    else:
        freshness = 'FRESH'
    return provenance, freshness


def operationalSignal(items):
    # Absence of evidence does not establish monitored-safe coverage.
    level = 'UNKNOWN'
    critical = False
    for item, freshness in items:
        if freshness not in {'FRESH', 'REFERENCE'}:
            continue
        if item.evidenceType.value == 'BASELINE_HAZARD':
            candidate = 'WATCH'
        elif item.hard():
            candidate, critical = 'CRITICAL', True
        elif item.evidenceType.value == 'ACTIVE_WARNING':
            candidate = 'ELEVATED'
        else:
            candidate = 'WATCH'
        if SIGNAL_ORDER[candidate] < SIGNAL_ORDER[level]:
            level = candidate
    return level, critical


# Every point is assigned to one leaf (code breaks shared-edge ties), then
# rolled up through its ancestors. This prevents double-counting boundary points.
MEMBERSHIP = '''WITH RECURSIVE memberships AS (
 SELECT u.id AS user_id, leaf.id AS region_id FROM users u
 CROSS JOIN LATERAL (SELECT id FROM command_regions r
   WHERE r.administrative_level = 'VILLAGE' AND r.data_mode = 'REFERENCE'
   AND ST_Covers(r.geometry, u.location::geometry) ORDER BY r.code LIMIT 1) leaf
 WHERE u.location_observed_at >= :cutoff AND u.location_observed_at <= :now
 UNION ALL SELECT m.user_id, r.parent_id FROM memberships m
 JOIN command_regions r ON r.id = m.region_id WHERE r.parent_id IS NOT NULL
) '''


async def refreshSnapshots(session):
    now = datetime.now(timezone.utc)
    if not (await session.execute(text('SELECT pg_try_advisory_xact_lock(173401, 1)'))).scalar():
        return 0
    regions = (await session.execute(select(Region).options(defer(Region.geometry),defer(Region.centroid)).order_by(Region.code))).scalars().all()
    if not regions:
        return 0
    params = {'now': now, 'cutoff': now - timedelta(hours=24)}
    userRows = (await session.execute(text(MEMBERSHIP + '''SELECT region_id, count(*) AS registered,
      count(*) FILTER (WHERE coalesce((SELECT a.status FROM assistance_requests a
        WHERE a.user_id = m.user_id AND a.updated_at >= :cutoff
        ORDER BY a.updated_at DESC, a.id DESC LIMIT 1),'UNKNOWN') NOT IN ('SAFE','EVACUATING')) AS unknown
      FROM memberships m GROUP BY region_id'''), params)).mappings().all()
    users = {r['region_id']: r for r in userRows}
    assistanceRows = (await session.execute(text(MEMBERSHIP + '''SELECT m.region_id, a.status, count(*) AS count
      FROM memberships m JOIN assistance_requests a ON a.user_id = m.user_id
      WHERE a.updated_at >= :cutoff GROUP BY m.region_id, a.status'''), params)).mappings().all()
    assistance = {}
    for row in assistanceRows:
        assistance.setdefault(row['region_id'], {})[row['status']] = row['count']
    needRows = (await session.execute(text(MEMBERSHIP + ''', reported_needs AS (
      SELECT user_id, type FROM user_accessibility
      UNION SELECT a.user_id, jsonb_array_elements_text(a.support_needs) AS type
        FROM assistance_requests a WHERE a.updated_at >= :cutoff
      ) SELECT m.region_id, a.type, count(DISTINCT m.user_id) AS count
      FROM memberships m JOIN reported_needs a ON a.user_id = m.user_id GROUP BY m.region_id, a.type'''), params)).mappings().all()
    needs = {}
    for row in needRows:
        needs.setdefault(row['region_id'], {})[row['type']] = row['count']
    hazardRows = (await session.execute(text('''SELECT r.id AS region_id, h.id AS evidence_id
      FROM command_regions r JOIN hazard_evidence h ON ST_Intersects(r.geometry, h.geometry)
      WHERE r.data_mode = 'REFERENCE' '''))).mappings().all()
    evidenceIds = list({row['evidence_id'] for row in hazardRows})
    evidenceRows = (await session.execute(text('''SELECT id, source_id, source, hazard_type, authority,
      evidence_type, severity, confidence, observed_at, valid_from, valid_until, metadata
      FROM hazard_evidence WHERE id = ANY(:ids)'''), {'ids': evidenceIds})).mappings().all() if evidenceIds else []
    classified = {}
    for row in evidenceRows:
        item = HazardEvidence.model_construct(sourceId=row['source_id'], source=row['source'], hazardType=HazardType(row['hazard_type']),
            authority=Authority(row['authority']), evidenceType=EvidenceType(row['evidence_type']), geometry=None,
            severity=row['severity'], confidence=row['confidence'], observedAt=row['observed_at'],
            validFrom=row['valid_from'], validUntil=row['valid_until'], metadata=row['metadata'] or {})
        provenance, freshness = classifyEvidence(item, now)
        if provenance != 'SIMULATION':
            classified[row['id']] = (item, freshness, provenance)
    evidence = {}
    for row in hazardRows:
        if row['evidence_id'] in classified:
            evidence.setdefault(row['region_id'], []).append(classified[row['evidence_id']])
    # Union prevents overlapping active warning polygons from counting twice.
    exposureRows = (await session.execute(text('''SELECT r.id AS region_id,
      least(1.0, greatest(0.0, ST_Area(ST_Intersection(r.geometry,
        ST_UnaryUnion(ST_Collect(h.geometry)))::geography) / nullif(ST_Area(r.geometry::geography),0))) AS fraction
      FROM command_regions r JOIN hazard_evidence h ON ST_Intersects(r.geometry,h.geometry)
      WHERE r.data_mode = 'REFERENCE' AND h.authority = 'OFFICIAL'
      AND h.evidence_type IN ('ACTIVE_WARNING','CRITICAL_HAZARD','CONFIRMED_CLOSURE')
      AND ST_Dimension(h.geometry) = 2 AND h.observed_at IS NOT NULL AND h.observed_at <= :now
      AND (h.valid_from IS NULL OR h.valid_from <= :now) AND h.valid_until > :now
      AND NOT (h.metadata ? 'fixture') AND coalesce(h.metadata->>'simulation','false') <> 'true'
      AND upper(h.source) NOT LIKE 'DEMO%' AND upper(h.source) NOT LIKE 'SIMULATION%'
      AND upper(h.source) NOT LIKE 'SYNTHETIC%'
      AND (h.hazard_type <> 'EARTHQUAKE' OR h.evidence_type <> 'CRITICAL_HAZARD' OR h.metadata->>'confirmedDamage' = 'true')
      GROUP BY r.id'''), params)).mappings().all()
    exposures = {r['region_id']: r['fraction'] for r in exposureRows}
    shelterRows = (await session.execute(text('''WITH RECURSIVE placed AS (
      SELECT s.id AS shelter_id, leaf.id AS region_id FROM shelters s
      CROSS JOIN LATERAL (SELECT id FROM command_regions r WHERE r.data_mode = 'REFERENCE'
        AND r.administrative_level = 'VILLAGE' AND ST_Covers(r.geometry,s.location::geometry)
        ORDER BY r.code LIMIT 1) leaf
      WHERE upper(s.source) NOT LIKE 'DEMO%' AND upper(s.source) NOT LIKE 'SIMULATION%' AND upper(s.source) NOT LIKE 'SYNTHETIC%'
      UNION ALL SELECT p.shelter_id,r.parent_id FROM placed p JOIN command_regions r ON r.id=p.region_id WHERE r.parent_id IS NOT NULL
      ) SELECT p.region_id,s.*,ST_AsGeoJSON(s.location::geometry)::json AS geojson
      FROM placed p JOIN shelters s ON s.id=p.shelter_id'''))).mappings().all()
    shelters = {}
    for row in shelterRows:
        fresh = row['verified_at'] is not None and now - timedelta(hours=24) <= row['verified_at'] <= now
        summary = ShelterSummary(id=row['id'], name=row['name'], geometry=row['geojson'], status=row['status'] if fresh and row['status'] != 'FULL' else 'UNKNOWN',
            capacity=row['capacity'], wheelchairAccessible=row['wheelchair_accessible'],
            source=row['source'], verifiedAt=row['verified_at'], dataMode='REFERENCE')
        shelters.setdefault(row['region_id'], []).append(summary)
    routeRows = (await session.execute(text('''SELECT (payload->>'regionId')::uuid AS region_id,
      count(*) FILTER (WHERE status='PUBLISHED' AND result->>'routeStatus'='READY'
        AND (result->>'evaluatedAt')::timestamptz > CAST(:now AS timestamptz) - interval '5 minutes') AS feasible,
      count(*) FILTER (WHERE status='DRAFT' AND result->>'routeStatus'='UNAVAILABLE'
        AND result->'selectionReasonCodes' ? 'NO_FEASIBLE_ROUTE') AS unavailable
      FROM operational_routes GROUP BY payload->>'regionId' '''), {'now': now})).mappings().all()
    routeCounts = {r['region_id']: r for r in routeRows}
    byId = {r.id: r for r in regions}
    snapshots = []
    for region in regions:
        simulation = region.dataMode == 'SIMULATION'
        regionEvidence = evidence.get(region.id, [])
        signal, critical = operationalSignal([(item, freshness) for item, freshness, _ in regionEvidence if item.active(now)])
        fraction = exposures.get(region.id)
        estimate, method = exposureEstimate(region.population, fraction)
        counts = assistance.get(region.id, {})
        reported = needs.get(region.id, {})
        userCount = users.get(region.id, {}).get('registered', 0)
        aggregate = AssistanceAggregate() if simulation else AssistanceAggregate(
            assistanceRequestedCount=sum(counts.values()), activeAssistanceCount=sum(v for k,v in counts.items() if k in ACTIVE_STATUSES),
            evacuatingCount=counts.get('EVACUATING',0), safeCheckInCount=counts.get('SAFE',0),
            unknownSafetyCount=users.get(region.id, {}).get('unknown',0),
            **{key: reported.get(category,0) for key,category in [('mobilityNeedCount','MOBILITY_LIMITATION'),('visualNeedCount','VISUAL_IMPAIRMENT'),('hearingNeedCount','HEARING_IMPAIRMENT'),('elderlyNeedCount','ELDERLY'),('otherNeedCount','OTHER')]})
        regionShelters = shelters.get(region.id, [])
        capacities = [s.capacity for s in regionShelters]
        lineage = []
        parent = byId.get(region.parentId)
        while parent:
            lineage.insert(0, {'id': str(parent.id), 'name': parent.name, 'administrativeLevel': parent.administrativeLevel})
            parent = byId.get(parent.parentId)
        expiry = min([now + timedelta(minutes=5)] + [item.validUntil for item,_,_ in regionEvidence if item.active(now) and item.validUntil])
        detail = RegionDetail(id=region.id, code=region.code, name=region.name, administrativeLevel=region.administrativeLevel,
            parentRegionId=region.parentId, geometry={}, centroid={},
            population=region.population, populationReferenceYear=region.populationReferenceYear, populationSource=region.populationSource,
            boundarySource=region.boundarySource, dataMode=region.dataMode, signalLevel=signal,
            hazardTypes=sorted({item.hazardType.value for item,_,_ in regionEvidence if item.active(now)}),
            authoritativeCriticalHazard=critical, estimatedExposedPopulation=estimate, exposureFraction=fraction,
            exposureEstimationMethod=method, activeAssistanceCount=aggregate.activeAssistanceCount,
            recordedShelterCount=None if simulation else len(regionShelters),
            evidenceFreshness='FRESH' if regionEvidence and all(f in {'FRESH','REFERENCE'} for _,f,_ in regionEvidence) else 'UNKNOWN',
            updatedAt=now, snapshotExpiresAt=expiry, snapshotStale=False, hierarchy=lineage,
            registeredUserCount=None if simulation else userCount, assistance=aggregate,
            totalShelterCapacity=sum(capacities) if capacities and all(c is not None for c in capacities) else None,
            feasibleRouteCount=None if simulation else routeCounts.get(region.id, {}).get('feasible', 0),
            noFeasibleRouteCount=None if simulation else routeCounts.get(region.id, {}).get('unavailable', 0),
            shelters=regionShelters,
            hazards=[HazardSummary(hazardType=item.hazardType.value,source=item.source,sourceId=item.sourceId,authority=item.authority.value,
                evidenceType=item.evidenceType.value,provenanceClass=provenance,geometry=None,severity=item.severity,
                confidence=item.confidence,observedAt=item.observedAt,validFrom=item.validFrom,expiresAt=item.validUntil,
                freshness=freshness,active=item.active(now)) for item,freshness,provenance in regionEvidence],
            metricProvenance={'population': 'Imported reference population; source/year supplied separately.',
                'exposure': 'Union of current official polygon warnings/exclusions, geodesic area ratio; assumes uniformly distributed population.',
                'assistance': 'Existing assistance_requests; requests updated in last 24h, grouped by requester recent profile location.',
                'accessibility': 'Distinct reported categories per user from user_accessibility and recent request support_needs; categories overlap, not demographic prevalence.',
                'shelters': 'Reference capacity and accessibility only; no live occupancy tracking. Operational status unknown when verification older than 24h.',
                'responders': 'UNKNOWN: no authoritative responder inventory.', 'routing': 'Persisted Route Setter routes. Feasible counts are unexpired publications; no-feasible counts exclude provider failures.'},
            limitations=['Missing evidence is UNKNOWN, never NORMAL.', 'Population exposure excludes baseline susceptibility and point observations.',
                'Registered users means recently located profiles, not all registrations or regional population.',
                'Safety counts refer to request statuses, not an independent citizen check-in feed.',
                'No spatial population grid is configured; area-weighted estimates are approximate.',
                'SIMULATION regions exclude all live citizen, hazard, and shelter data.' if simulation else 'Simulation evidence and shelters excluded.'])
        payload = detail.model_dump(mode='json',exclude={'geometry','centroid'})
        snapshots.append({'region_id':region.id,'payload':payload,'updated_at':now,'expires_at':expiry})
    # Batches keep each statement under asyncpg's 32,767 bind-parameter limit (4 per region); same transaction.
    for start in range(0, len(snapshots), 1000):
        statement = insert(RegionalOperationalSnapshot).values(snapshots[start:start+1000])
        await session.execute(statement.on_conflict_do_update(index_elements=['region_id'],set_={
            'payload':statement.excluded.payload,'updated_at':statement.excluded.updated_at,'expires_at':statement.excluded.expires_at}))
    return len(regions)
