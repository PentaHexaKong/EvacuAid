import logging
from datetime import datetime, timedelta, timezone

from app import config
from app.repositories import externalDataRepository, hazardRepository
from app.services.hazardProviders import fetchProvider


logger = logging.getLogger(__name__)
LIVE_SOURCES = ('BMKG_EARTHQUAKE', 'BMKG_CAP', 'FIRMS', 'PETABENCANA')


async def refreshSource(session, source: str, cache=None, fetcher=fetchProvider, force=False) -> dict:
    now = datetime.now(timezone.utc)
    snapshot = await externalDataRepository.getSnapshot(session, f'HAZARD_{source}', 'STATUS')
    last = snapshot.payload if snapshot else {}
    configurationRecovered = source == 'FIRMS' and bool(config.FIRMS_MAP_KEY) and last.get('status') == 'unconfigured'
    if not force and not configurationRecovered and last.get('nextAttemptAt') and datetime.fromisoformat(last['nextAttemptAt']) > now:
        await session.rollback()
        return last
    await session.rollback()
    try:
        items = await fetcher(source, now)
        if len(items) > config.HAZARD_MAX_EVIDENCE or any(item.source != source for item in items):
            raise ValueError('invalid or oversized provider refresh')
        await hazardRepository.replaceSource(session, source, items)
        status = {'status': 'available', 'lastSuccessAt': now.isoformat(), 'evidenceCount': len(items), 'nextAttemptAt': (now + timedelta(seconds=config.HAZARD_TTLS[source])).isoformat(), 'error': None}
        await externalDataRepository.saveSnapshot(session, f'HAZARD_{source}', 'STATUS', status)
        await session.commit()
        if cache:
            await cache.setJson(f'hazard:{source}:status', status, config.HAZARD_TTLS[source])
        logger.info('hazardRefresh source=%s result=success evidenceCount=%s', source, len(items))
        return status
    except Exception as error:
        await session.rollback()
        status = {**last, 'status': 'unconfigured' if source == 'FIRMS' and not config.FIRMS_MAP_KEY else 'degraded', 'error': type(error).__name__, 'nextAttemptAt': (now + timedelta(seconds=config.HAZARD_TTLS[source])).isoformat()}
        await externalDataRepository.saveSnapshot(session, f'HAZARD_{source}', 'STATUS', status)
        await session.commit()
        logger.warning('hazardRefresh source=%s result=failure errorType=%s', source, type(error).__name__)
        return status


async def providerHealth(session) -> dict:
    from app.services.elevationProvider import ElevationProvider

    now = datetime.now(timezone.utc)
    result = {}
    for source in (*LIVE_SOURCES, 'INARISK'):
        snapshot = await externalDataRepository.getSnapshot(session, f'HAZARD_{source}', 'STATUS')
        status = dict(snapshot.payload) if snapshot else {'status': 'unconfigured' if source == 'FIRMS' and not config.FIRMS_MAP_KEY else 'unknown', 'error': 'NOT_PREPARED_OR_REFRESHED'}
        if status.get('lastSuccessAt') and now - datetime.fromisoformat(status['lastSuccessAt']) > timedelta(seconds=config.HAZARD_TTLS[source] * 2):
            status['status'] = 'stale'
        result[source] = {**status, 'optional': True}
    import asyncio
    status = await asyncio.to_thread(ElevationProvider().health)
    result['DEM'] = {**status, 'optional': True}
    return result
