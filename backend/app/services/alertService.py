from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from geoalchemy2.shape import to_shape
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert

from app.db.models.alert import AlertDelivery, AlertResponse
from app.db.models.hazard import HazardRecord
from app.db.models.user import User
from app.models.alerts import AlertItem, AlertList, AlertLocation
from app.repositories import hazardRepository
from app.services import pilotService


HAZARD_WORDS = {'FLOOD': 'Banjir', 'EARTHQUAKE': 'Gempa bumi', 'TSUNAMI': 'Tsunami', 'WILDFIRE': 'Kebakaran hutan', 'LANDSLIDE': 'Tanah longsor', 'EXTREME_WEATHER': 'Cuaca ekstrem'}


def item(row, response=None):
    centroid = to_shape(row.geometry).centroid
    return AlertItem(id=row.id, level=row.evidenceMetadata['officialStatus'].lower(), hazardType=row.hazardType, source=row.source, area=row.evidenceMetadata.get('area'), issuedAt=row.observedAt or row.validFrom, validUntil=row.validUntil, latitude=centroid.y, longitude=centroid.x, myResponse=response)


async def listAlerts(db, actor):
    if actor.latitude is None or actor.longitude is None:
        raise HTTPException(409, 'location required')
    rows = (await db.execute(hazardRepository.activeOfficialAlerts().where(hazardRepository.coversLocation(actor.latitude, actor.longitude)))).scalars().all()
    responses = dict((await db.execute(select(AlertResponse.alert_id, AlertResponse.response).where(AlertResponse.user_id == actor.id, AlertResponse.alert_id.in_([row.id for row in rows])))).all()) if rows else {}
    return AlertList(items=[item(row, responses.get(row.id)) for row in rows], location=AlertLocation(observedAt=actor.locationObservedAt))


async def respond(db, actor, alertId, response):
    row = (await db.execute(hazardRepository.activeOfficialAlerts().where(HazardRecord.id == alertId).with_for_update())).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, 'alert not found')
    statement = insert(AlertResponse).values(user_id=actor.id, alert_id=alertId, response=response)
    await db.execute(statement.on_conflict_do_update(constraint='uq_alert_response_user_alert', set_={'response': response, 'updated_at': func.now()}, where=AlertResponse.response != response))
    await db.commit()
    return item(row, response)


async def enqueueAlerts(db):
    now = datetime.now(timezone.utc)
    candidates = hazardRepository.activeOfficialAlerts(('SIAGA', 'AWAS'), now).with_only_columns(HazardRecord.id, User.id).order_by(None).join(User, hazardRepository.coversLocation(User.latitude, User.longitude)).where(User.latitude.is_not(None), User.longitude.is_not(None), User.locationObservedAt >= now - timedelta(hours=24), User.locationObservedAt <= now)
    statement = insert(AlertDelivery).from_select(['alert_id', 'user_id'], candidates).on_conflict_do_nothing(index_elements=['alert_id', 'user_id']).returning(AlertDelivery.alert_id, AlertDelivery.user_id)
    pairs = (await db.execute(statement)).all()
    alerts = {row.id: row for row in (await db.execute(select(HazardRecord).where(HazardRecord.id.in_({alertId for alertId, userId in pairs})))).scalars()} if pairs else {}
    for alertId, userId in pairs:
        row = alerts[alertId]
        status = row.evidenceMetadata['officialStatus']
        payload = {'alertId': str(alertId), 'level': status.lower(), 'title': f'Peringatan {status}', 'body': f'{HAZARD_WORDS.get(row.hazardType, "Bahaya")} di area Anda. Buka EvacuAid untuk langkah selanjutnya.', 'interruptionLevel': 'time-sensitive'}
        await pilotService.event(db, userId, None, 'ALERT', payload)


async def latestResponses(db, userIds):
    if not userIds:
        return {}
    now = datetime.now(timezone.utc)
    ranked = select(AlertResponse.id, func.row_number().over(partition_by=AlertResponse.user_id, order_by=(AlertResponse.updated_at.desc(), AlertResponse.id)).label('rank')).where(AlertResponse.user_id.in_(userIds), AlertResponse.updated_at >= now - timedelta(hours=24), AlertResponse.updated_at <= now).subquery()
    rows = (await db.execute(select(AlertResponse).join(ranked, AlertResponse.id == ranked.c.id).where(ranked.c.rank == 1))).scalars()
    return {row.user_id: {'alertId': row.alert_id, 'response': row.response, 'at': row.updated_at} for row in rows}
