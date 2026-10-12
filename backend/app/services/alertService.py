from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid5

from fastapi import HTTPException
from geoalchemy2.shape import to_shape
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert

from app import config
from app.db.models.alert import AlertDelivery, AlertResponse
from app.db.models.hazard import HazardRecord
from app.db.models.user import User
from app.models.alerts import AlertItem, AlertList, AlertLocation
from app.repositories import hazardRepository
from app.services import buddyRequestService


NAMESPACE = UUID('68bd5a3a-276c-4f9c-8d52-f38920dfab72')


def alertKey(row):
    return uuid5(NAMESPACE, f'{row.source}:{row.sourceId}')


HAZARD_WORDS = {'FLOOD': 'Banjir', 'EARTHQUAKE': 'Gempa bumi', 'TSUNAMI': 'Tsunami', 'WILDFIRE': 'Kebakaran hutan', 'LANDSLIDE': 'Tanah longsor', 'EXTREME_WEATHER': 'Cuaca ekstrem'}


async def activeAlert(db, alertId, statuses=('WASPADA', 'SIAGA', 'AWAS')):
    rows = (await db.execute(hazardRepository.activeOfficialAlerts(statuses).execution_options(populate_existing=True))).scalars()
    return next((row for row in rows if str(alertKey(row)) == str(alertId)), None)


def isSimulation(row):
    return row.source.upper().startswith(('DEMO', 'SIMULATION', 'SYNTHETIC')) or row.evidenceMetadata.get('simulation') is True or row.evidenceMetadata.get('commandMock') is True


def item(row, response=None):
    centroid = to_shape(row.geometry).centroid
    return AlertItem(id=alertKey(row), level=row.evidenceMetadata['officialStatus'].lower(), hazardType=row.hazardType, source=row.source, simulation=isSimulation(row), area=row.evidenceMetadata.get('area'), issuedAt=row.observedAt or row.validFrom, validUntil=row.validUntil, latitude=centroid.y, longitude=centroid.x, myResponse=response)


async def listAlerts(db, actor):
    if actor.latitude is None or actor.longitude is None:
        raise HTTPException(409, 'location required')
    rows = (await db.execute(hazardRepository.activeOfficialAlerts().where(hazardRepository.coversLocation(actor.latitude, actor.longitude)))).scalars().all()
    responses = dict((await db.execute(select(AlertResponse.alert_key, AlertResponse.response).where(AlertResponse.user_id == actor.id, AlertResponse.alert_key.in_([alertKey(row) for row in rows])))).all()) if rows else {}
    return AlertList(items=[item(row, responses.get(alertKey(row))) for row in rows], location=AlertLocation(observedAt=actor.locationObservedAt))


async def respond(db, actor, alertId, response):
    row = await activeAlert(db, alertId)
    if row is None:
        raise HTTPException(404, 'alert not found')
    statement = insert(AlertResponse).values(user_id=actor.id, alert_key=alertId, response=response)
    await db.execute(statement.on_conflict_do_update(constraint='uq_alert_response_user_alert', set_={'response': response, 'updated_at': func.now()}, where=AlertResponse.response != response))
    await db.commit()
    return item(row, response)


def payload(row):
    status = row.evidenceMetadata['officialStatus']
    result = {'alertId': str(alertKey(row)), 'level': status.lower(), 'title': f'Peringatan {status}', 'body': f'{HAZARD_WORDS.get(row.hazardType, "Bahaya")} di area Anda. Buka EvacuAid untuk langkah selanjutnya.', 'interruptionLevel': 'time-sensitive'}
    if isSimulation(row):
        result.update(title=f'Simulasi: Peringatan {status}', body='Ini simulasi, bukan peringatan resmi. ' + result['body'], simulation=True, interruptionLevel='active')
    return result


async def enqueueAlerts(db):
    if not config.ALERT_PUSH_ENABLED:
        return
    now = datetime.now(timezone.utc)
    alerts = (await db.execute(hazardRepository.activeOfficialAlerts(('SIAGA', 'AWAS'), now))).scalars().all()
    for row in alerts:
        alertId = alertKey(row)
        candidates = select(User.id).select_from(HazardRecord).join(User, hazardRepository.coversLocation(User.latitude, User.longitude)).where(HazardRecord.id == row.id, User.latitude.is_not(None), User.longitude.is_not(None), User.locationObservedAt >= now - timedelta(hours=24), User.locationObservedAt <= now)
        userIds = (await db.execute(candidates)).scalars().all()
        if not userIds:
            continue
        statement = insert(AlertDelivery).values([{'alert_key': alertId, 'user_id': userId, 'level': row.evidenceMetadata['officialStatus'].lower()} for userId in userIds]).on_conflict_do_nothing(index_elements=['alert_key', 'user_id', 'level']).returning(AlertDelivery.user_id)
        for userId in (await db.execute(statement)).scalars():
            await buddyRequestService.event(db, userId, None, 'ALERT', payload(row))


async def cleanup(db):
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    await db.execute(delete(AlertDelivery).where(AlertDelivery.created_at < cutoff))
    await db.execute(delete(AlertResponse).where(AlertResponse.updated_at < cutoff))


async def latestResponses(db, userIds):
    if not userIds:
        return {}
    now = datetime.now(timezone.utc)
    ranked = select(AlertResponse.id, func.row_number().over(partition_by=AlertResponse.user_id, order_by=(AlertResponse.updated_at.desc(), AlertResponse.id)).label('rank')).where(AlertResponse.user_id.in_(userIds), AlertResponse.updated_at >= now - timedelta(hours=24), AlertResponse.updated_at <= now).subquery()
    rows = (await db.execute(select(AlertResponse).join(ranked, AlertResponse.id == ranked.c.id).where(ranked.c.rank == 1))).scalars()
    return {row.user_id: {'alertId': row.alert_key, 'response': row.response, 'at': row.updated_at} for row in rows}
