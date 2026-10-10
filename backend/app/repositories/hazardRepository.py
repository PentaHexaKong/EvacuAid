from datetime import datetime, timezone
import logging
from math import cos, radians
import uuid

from geoalchemy2 import Geography
from geoalchemy2.shape import from_shape, to_shape
from sqlalchemy import case, delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert
from shapely.geometry import mapping

from app.config import HAZARD_MAX_EVIDENCE
from app.db.models.hazard import HazardRecord
from app.models.hazard import Authority, EvidenceType, HazardEvidence
from app.utils.hazardGeometry import validGeometry


logger = logging.getLogger(__name__)


class HazardStateUnavailable(Exception):
    pass


async def saveEvidence(session, items: list[HazardEvidence]) -> None:
    for item in items:
        geometry = validGeometry(item.geometry)
        if geometry is None:
            raise ValueError('invalid hazard geometry')
        values = {'id': uuid.uuid4(), 'source_id': item.sourceId, 'hazard_type': item.hazardType.value, 'source': item.source, 'authority': item.authority.value, 'evidence_type': item.evidenceType.value, 'geometry': from_shape(geometry, srid=4326), 'severity': item.severity, 'confidence': item.confidence, 'observed_at': item.observedAt, 'valid_from': item.validFrom, 'valid_until': item.validUntil, 'metadata': item.metadata}
        statement = insert(HazardRecord).values(**values)
        await session.execute(statement.on_conflict_do_update(constraint='uq_hazard_source_id', set_={key: value for key, value in values.items() if key not in {'id', 'source', 'source_id'}}))


async def replaceSource(session, source: str, items: list[HazardEvidence]) -> None:
    await session.execute(delete(HazardRecord).where(HazardRecord.source == source))
    await saveEvidence(session, items)


async def replaceStaticScope(session, source: str, scope: str, items: list[HazardEvidence]) -> None:
    await session.execute(delete(HazardRecord).where(HazardRecord.source == source, HazardRecord.evidenceMetadata['ingestionScope'].astext == scope))
    for item in items:
        item.metadata['ingestionScope'] = scope
    await saveEvidence(session, items)


async def evidenceCounts(session, source: str) -> dict[str, int]:
    rows = (await session.execute(select(HazardRecord.hazardType, func.count()).where(HazardRecord.source == source).group_by(HazardRecord.hazardType))).all()
    return {hazardType: count for hazardType, count in rows}


async def activeEvidence(session, center: tuple[float, float], radiusM: float, geometry: dict | None = None) -> list[HazardEvidence]:
    now = datetime.now(timezone.utc)
    shape = func.ST_SetSRID(func.ST_MakePoint(center[1], center[0]), 4326)
    if geometry is not None:
        import json
        shape = func.ST_SetSRID(func.ST_GeomFromGeoJSON(json.dumps(geometry)), 4326)
    point = shape.cast(Geography)
    # The geodesic distance test is slow against large polygons, so an indexed bounding-box test drops far-away rows first.
    # A degree of longitude shrinks with latitude, so the box widens with it; 100 km per degree (not 111) and one extra degree of latitude leave a margin.
    nearby = HazardRecord.geometry.op('&&')(func.ST_Expand(shape, radiusM / (100000 * max(0.02, cos(radians(min(89.0, abs(center[0]) + 1)))))))
    query = select(HazardRecord).where(nearby, or_(HazardRecord.validFrom.is_(None), HazardRecord.validFrom <= now), or_(HazardRecord.validUntil.is_(None), HazardRecord.validUntil > now), func.ST_DWithin(HazardRecord.geometry.cast(Geography), point, radiusM)).order_by(HazardRecord.source, HazardRecord.sourceId).limit(HAZARD_MAX_EVIDENCE + 1)
    rows = (await session.execute(query)).scalars().all()
    logger.info('hazardState activeEvidenceCount=%s', len(rows))
    if len(rows) > HAZARD_MAX_EVIDENCE:
        raise HazardStateUnavailable('HAZARD_EVIDENCE_LIMIT_EXCEEDED')
    return [HazardEvidence(sourceId=row.sourceId, hazardType=row.hazardType, source=row.source, authority=row.authority, evidenceType=row.evidenceType, geometry=mapping(to_shape(row.geometry)), severity=row.severity, confidence=row.confidence, observedAt=row.observedAt, validFrom=row.validFrom, validUntil=row.validUntil, metadata=row.evidenceMetadata) for row in rows]


def coversLocation(latitude, longitude):
    return func.ST_Covers(HazardRecord.geometry, func.ST_SetSRID(func.ST_MakePoint(longitude, latitude), 4326))


def activeOfficialAlerts(statuses=('WASPADA', 'SIAGA', 'AWAS'), now=None):
    now = now or datetime.now(timezone.utc)
    status = HazardRecord.evidenceMetadata['officialStatus'].astext
    return select(HazardRecord).where(HazardRecord.authority == Authority.OFFICIAL.value, HazardRecord.evidenceType.in_((EvidenceType.ACTIVE_WARNING.value, EvidenceType.CRITICAL_HAZARD.value)), status.in_(statuses), or_(HazardRecord.validFrom.is_(None), HazardRecord.validFrom <= now), or_(HazardRecord.validUntil.is_(None), HazardRecord.validUntil > now)).order_by(case((status == 'AWAS', 0), (status == 'SIAGA', 1), else_=2), func.coalesce(HazardRecord.observedAt, HazardRecord.validFrom).desc().nulls_last(), HazardRecord.id)
