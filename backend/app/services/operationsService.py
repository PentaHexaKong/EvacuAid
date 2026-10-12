from datetime import datetime, timedelta, timezone
from uuid import UUID
from fastapi import HTTPException
from sqlalchemy import select, func, delete, text, update
from geoalchemy2.shape import from_shape
from shapely.geometry import Point, mapping
from app.db.models.operations import FieldReport, EvacuationCheckIn, OperationalRoute
from app.db.models.hazard import HazardRecord
from app.models.operations import ReportCreate, CheckInCreate, RouteSet
from app.models.hazard import HazardEvidence
from app.models.navigation import NavigationPreviewCreate
from app.repositories import hazardRepository, shelterRepository
from app.services import navigationService, shelterService


def report_response(row):
    return {**row.payload, 'id': str(row.id), 'status': row.status, 'review': row.review,
            'createdAt': row.createdAt, 'updatedAt': row.updatedAt}


async def region_exists(session, region_id):
    if not (await session.execute(text("SELECT id FROM command_regions WHERE id=:id AND data_mode='REFERENCE'"), {'id': region_id})).first():
        raise HTTPException(404, 'Operational reference region not found')


async def submit(session, model, payload, user_id):
    # Serialize retries and rate-limit checks by actor, including concurrent requests.
    for key in sorted({user_id.int & ((1 << 63)-1), payload.id.int & ((1 << 63)-1)}):
        await session.execute(select(func.pg_advisory_xact_lock(key)))
    existing = await session.get(model, payload.id)
    values = payload.model_dump(mode='json', exclude={'id'})
    if existing:
        if existing.userId != user_id or existing.payload != values:
            raise HTTPException(409, 'Submission ID already has different data')
        return existing
    count = (await session.execute(select(func.count()).select_from(model).where(model.userId == user_id, model.createdAt > datetime.now(timezone.utc)-timedelta(days=1)))).scalar()
    if count >= 100:
        raise HTTPException(429, 'Daily submission limit reached; retry later')
    if model is EvacuationCheckIn:
        await region_exists(session, payload.regionId)
    row = model(id=payload.id, userId=user_id, payload=values)
    session.add(row)
    await session.flush()
    if model is FieldReport and payload.kind != 'SHELTER_CROWDING':
        await hazardRepository.saveEvidence(session, [HazardEvidence(sourceId=str(row.id), source='EVACUAID_FIELD_REPORT',
            hazardType=payload.hazardType, authority='COMMUNITY', evidenceType='OBSERVATION',
            geometry=mapping(Point(payload.longitude, payload.latitude)), observedAt=payload.observedAt,
            validUntil=payload.observedAt + timedelta(hours=24), confidence=None, severity=None,
            metadata={'reportKind': payload.kind, 'reviewStatus': 'UNVERIFIED'})])
    await session.commit()
    await session.refresh(row)
    return row


async def review_report(session, report_id, payload):
    await session.execute(select(func.pg_advisory_xact_lock(172512)))
    row = (await session.execute(select(FieldReport).where(FieldReport.id == report_id).with_for_update())).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, 'Report not found')
    if row.updatedAt != payload.expectedUpdatedAt:
        raise HTTPException(409, 'Report changed; refresh before reviewing')
    now = datetime.now(timezone.utc)
    if payload.barrier and (payload.status != 'CONFIRMED' or row.payload['kind'] == 'SHELTER_CROWDING' or payload.validUntil is None or payload.validUntil.tzinfo is None or not now < payload.validUntil <= now+timedelta(hours=24)):
        raise HTTPException(422, 'A confirmed barrier needs an explicit expiry within 24 hours; crowding is not a road closure')
    await session.execute(delete(HazardRecord).where(HazardRecord.sourceId == str(row.id), HazardRecord.source.in_(['EVACUAID_FIELD_REPORT', 'GOVERNMENT_FIELD_REVIEW'])))
    row.status = payload.status
    row.review = payload.model_dump(mode='json', exclude={'expectedUpdatedAt'})
    if payload.status == 'CONFIRMED' and row.payload['kind'] != 'SHELTER_CROWDING':
        point = Point(row.payload['longitude'], row.payload['latitude'])
        geometry = mapping(point)
        if payload.barrier:
            geometry = (await session.execute(text('SELECT ST_AsGeoJSON(ST_Buffer(ST_SetSRID(ST_MakePoint(:lon,:lat),4326)::geography,:radius)::geometry)::json'),
                {'lon': point.x, 'lat': point.y, 'radius': payload.radiusM})).scalar()
        await hazardRepository.saveEvidence(session, [HazardEvidence(sourceId=str(row.id), source='GOVERNMENT_FIELD_REVIEW',
            hazardType=row.payload['hazardType'], authority='OFFICIAL', evidenceType='CONFIRMED_CLOSURE' if payload.barrier else 'OBSERVATION',
            geometry=geometry, observedAt=datetime.fromisoformat(row.payload['observedAt'].replace('Z','+00:00')),
            validFrom=now, validUntil=payload.validUntil or now+timedelta(hours=24),
            metadata={'reportKind': row.payload['kind'], 'confirmedDamage': payload.barrier})])
    # A revision to evidence invalidates publication; no stale operational routes survive review.
    await session.execute(update(OperationalRoute).where(OperationalRoute.status == 'PUBLISHED').values(status='DRAFT'))
    await session.commit()
    await session.refresh(row)
    return report_response(row)


async def evaluate_set(session, payload):
    await region_exists(session, payload.regionId)
    inside = (await session.execute(text('SELECT ST_Covers(geometry, ST_SetSRID(ST_MakePoint(:lon,:lat),4326)) FROM command_regions WHERE id=:id'),
        {'id':payload.regionId, 'lat':payload.originLatitude, 'lon':payload.originLongitude})).scalar()
    if not inside:
        raise HTTPException(422, 'Assembly point must be inside the selected reference region')
    shelter = await shelterRepository.getShelter(session, payload.shelterId)
    if shelter is None:
        raise HTTPException(404, 'Shelter not found')
    suitable, reasons = shelterService.suitabilityReasons(shelter, payload.mobilityRequired)
    if not suitable:
        return {'routeStatus': 'UNAVAILABLE', 'route': None, 'selectionReasonCodes': reasons, 'safetyVerified': False}
    result = await navigationService.previewNavigation(session, NavigationPreviewCreate(
        originLatitude=payload.originLatitude, originLongitude=payload.originLongitude,
        destinationLatitude=shelter.entranceLatitude if shelter.entranceLatitude is not None else shelter.latitude,
        destinationLongitude=shelter.entranceLongitude if shelter.entranceLongitude is not None else shelter.longitude,
        mobilityRequired=payload.mobilityRequired))
    return {**result.model_dump(mode='json'), 'shelterName': shelter.name, 'safetyVerified': False,
            'shelterAccessibility': shelter.wheelchairAccessible, 'evaluatedAt': datetime.now(timezone.utc).isoformat()}


def route_response(row):
    expiry = datetime.fromisoformat(row.result['evaluatedAt']) + timedelta(minutes=5) if row.result.get('evaluatedAt') else datetime.min.replace(tzinfo=timezone.utc)
    stale = expiry <= datetime.now(timezone.utc)
    return {**row.payload, 'id': str(row.id), 'status': row.status, 'result': row.result,
            'updatedAt': row.updatedAt, 'expiresAt': expiry, 'stale': stale,
            'usable': row.status == 'PUBLISHED' and not stale and row.result.get('routeStatus') == 'READY'}


async def save_route(session, payload, publish=False):
    previous = await session.get(OperationalRoute, payload.id)
    revision = previous.updatedAt if previous else None
    revision_query = text("SELECT md5(coalesce(string_agg(id::text || xmin::text, ',' ORDER BY id), '')) FROM hazard_evidence")
    baseline = (await session.execute(revision_query)).scalar()
    result = await evaluate_set(session, payload)
    await session.execute(select(func.pg_advisory_xact_lock(172512)))
    if baseline != (await session.execute(revision_query)).scalar():
        raise HTTPException(409, 'Evidence changed during calculation; recalculate')
    row = await session.get(OperationalRoute, payload.id, populate_existing=True)
    if (row.updatedAt if row else None) != revision:
        raise HTTPException(409, 'Route changed during calculation; refresh and retry')
    if row is None:
        row = OperationalRoute(id=payload.id)
        session.add(row)
    row.payload = payload.model_dump(mode='json', exclude={'id'})
    row.result = result
    row.status = 'PUBLISHED' if publish and result['routeStatus'] == 'READY' else 'DRAFT'
    await session.commit()
    await session.refresh(row)
    if publish and result['routeStatus'] != 'READY':
        raise HTTPException(409, {'message': 'No feasible route to publish; previous publication invalidated', 'result': result})
    return route_response(row)
