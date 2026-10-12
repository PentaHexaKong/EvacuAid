import math
import uuid
from datetime import datetime, timedelta, timezone

from shapely.geometry import box, mapping
from sqlalchemy import delete, select

from app.db.models.alert import AlertDelivery, AlertResponse
from app.db.models.hazard import HazardRecord
from app.db.models.user import User
from app.models.hazard import Authority, EvidenceType, HazardEvidence, HazardType
from app.repositories import hazardRepository
from app.services.alertService import alertKey


# Dummy official warnings for testing the alert flow: scripts/simulate_alerts.py and the dev-only /v1/alerts/dev routes.
SOURCE = 'DEMO_SIMULATION'
SEVERITY = {'waspada': 0.3, 'siaga': 0.6, 'awas': 0.9}
JAKARTA = (-6.2, 106.8)


async def defaultCenter(session):
    row = (await session.execute(select(User.latitude, User.longitude).where(User.latitude.is_not(None), User.longitude.is_not(None)).order_by(User.locationObservedAt.desc().nulls_last()).limit(1))).first()
    return (row.latitude, row.longitude) if row else JAKARTA


async def resetAnswers(session, keys):
    await session.execute(delete(AlertResponse).where(AlertResponse.alert_key.in_(keys)))
    await session.execute(delete(AlertDelivery).where(AlertDelivery.alert_key.in_(keys)))


# fresh=True gives the warning a new id: the app shows its emergency sheet once per alert id, so a repeat test needs a new alert.
async def apply(session, level, hazard='FLOOD', center=None, radiusKm=3.0, hours=2.0, area=None, fresh=False):
    latitude, longitude = center or await defaultCenter(session)
    dLat = radiusKm / 111.32
    dLon = radiusKm / (111.32 * math.cos(math.radians(latitude)))
    now = datetime.now(timezone.utc)
    item = HazardEvidence(sourceId=f'sim-{hazard.lower()}' + (f'-{uuid.uuid4().hex[:8]}' if fresh else ''), hazardType=HazardType(hazard), source=SOURCE, authority=Authority.OFFICIAL, evidenceType=EvidenceType.ACTIVE_WARNING, geometry=mapping(box(longitude - dLon, latitude - dLat, longitude + dLon, latitude + dLat)), severity=SEVERITY[level], confidence=1.0, observedAt=now, validFrom=now - timedelta(minutes=1), validUntil=now + timedelta(hours=hours), metadata={'officialStatus': level.upper(), 'area': area or 'Area simulasi EvacuAid', 'sourceUrl': 'https://evacuaid.invalid/simulation', 'attribution': 'EvacuAid simulation, not an official warning'})
    await hazardRepository.saveEvidence(session, [item])
    await session.flush()
    row = (await session.execute(select(HazardRecord).where(HazardRecord.source == SOURCE, HazardRecord.sourceId == item.sourceId).execution_options(populate_existing=True))).scalar_one()
    await resetAnswers(session, [alertKey(row)])
    await session.commit()
    return row, (latitude, longitude)


async def clear(session):
    rows = (await session.execute(select(HazardRecord).where(HazardRecord.source == SOURCE))).scalars().all()
    await resetAnswers(session, [alertKey(row) for row in rows])
    await session.execute(delete(HazardRecord).where(HazardRecord.source == SOURCE))
    await session.commit()
    return len(rows)
