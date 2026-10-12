from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
import uuid

import httpx
import pytest
from fastapi import FastAPI
from geoalchemy2.shape import from_shape, to_shape
from shapely.geometry import Point, Polygon, mapping
from sqlalchemy import func, select

from app import config
from app.db.models import BuddyRelationship, User
from app.db.models.alert import AlertDelivery, AlertResponse
from app.db.models.hazard import HazardRecord
from app.db.models.buddySession import BuddyInbox, BuddyOutbox, BuddyPushToken
from app.db.session import get_session
from app.routers.alerts import router
from app.routers.alerts_dev import router as devRouter
from app.routers.buddy import router as buddy
from app.routers.sessions import router as sessions
from app.models.hazard import HazardEvidence
from app.repositories import hazardRepository
from app.services import alertService, buddyRequestService, buddyWorker
from app.services import alertSimulation


def api(db):
    app = FastAPI()
    app.include_router(router)
    app.include_router(buddy, prefix='/v1/buddy')
    app.include_router(sessions)

    async def database():
        yield db

    app.dependency_overrides[get_session] = database
    return app


async def guest(client, db, latitude=-6.2, longitude=106.8, age=0):
    response = (await client.post('/v1/guest-sessions')).json()
    user = await db.get(User, uuid.UUID(response['user']['id']))
    user.latitude, user.longitude = latitude, longitude
    user.locationObservedAt = datetime.now(timezone.utc) - timedelta(hours=age) if latitude is not None else None
    await db.commit()
    return user, {'Authorization': 'Bearer ' + response['access_token']}


async def warning(db, status='AWAS', **values):
    now = datetime.now(timezone.utc)
    row = HazardRecord(sourceId=str(uuid.uuid4()), hazardType='FLOOD', source='TEST_OFFICIAL', authority='OFFICIAL', evidenceType='ACTIVE_WARNING', geometry=from_shape(Polygon([(106.79, -6.21), (106.81, -6.21), (106.81, -6.19), (106.79, -6.19)]), srid=4326), observedAt=now, validFrom=now - timedelta(hours=1), validUntil=now + timedelta(hours=1), evidenceMetadata={'officialStatus': status, 'area': 'Test area'})
    for key, value in values.items():
        setattr(row, key, value)
    db.add(row)
    await db.commit()
    return row


@pytest.mark.asyncio
async def test_alert_location_coverage_and_item(dbSession):
    row = await warning(dbSession)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        user, inside = await guest(client, dbSession)
        _, outside = await guest(client, dbSession, latitude=-6.3)
        _, missing = await guest(client, dbSession, latitude=None, longitude=None)
        response = await client.get('/v1/alerts', headers=inside)
        assert response.status_code == 200
        data = response.json()
        alert = data['items'][0]
        assert alert['id'] == str(alertService.alertKey(row)) and alert['level'] == 'awas'
        assert alert['hazardType'] == 'FLOOD' and alert['source'] == 'TEST_OFFICIAL'
        assert alert['area'] == 'Test area' and alert['myResponse'] is None
        assert alert['latitude'] == pytest.approx(-6.2) and alert['longitude'] == pytest.approx(106.8)
        assert datetime.fromisoformat(alert['issuedAt']) == row.observedAt
        assert datetime.fromisoformat(alert['validUntil']) == row.validUntil
        assert datetime.fromisoformat(data['location']['observedAt']) == user.locationObservedAt
        assert (await client.get('/v1/alerts', headers=outside)).json()['items'] == []
        required = await client.get('/v1/alerts', headers=missing)
        assert required.status_code == 409 and required.json() == {'detail': 'location required'}
        assert (await client.get('/v1/alerts')).status_code == 401


@pytest.mark.asyncio
async def test_alert_sorting_filtering_and_boundary(dbSession):
    now = datetime.now(timezone.utc)
    waspada = await warning(dbSession, 'WASPADA')
    siaga = await warning(dbSession, 'SIAGA')
    old_awas = await warning(dbSession, observedAt=now - timedelta(minutes=10))
    new_awas = await warning(dbSession, observedAt=None, validFrom=now - timedelta(minutes=1), evidenceType='CRITICAL_HAZARD', evidenceMetadata={'officialStatus': 'AWAS'})
    for values in [{'validUntil': now - timedelta(seconds=1)}, {'validFrom': now + timedelta(minutes=1)}, {'authority': 'COMMUNITY', 'evidenceType': 'OBSERVATION', 'geometry': from_shape(Point(106.8, -6.2), srid=4326)}, {'evidenceType': 'BASELINE_HAZARD'}, {'evidenceMetadata': {'officialStatus': 'OTHER'}}]:
        await warning(dbSession, **values)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        _, headers = await guest(client, dbSession, longitude=106.79)
        items = (await client.get('/v1/alerts', headers=headers)).json()['items']
        assert [item['id'] for item in items] == [str(alertService.alertKey(row)) for row in (new_awas, old_awas, siaga, waspada)]
        assert items[0]['area'] is None
        assert datetime.fromisoformat(items[0]['issuedAt']) == new_awas.validFrom


@pytest.mark.asyncio
async def test_alert_response_upsert_and_actor_scope(dbSession):
    row = await warning(dbSession)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        user, headers = await guest(client, dbSession)
        _, other = await guest(client, dbSession)
        path = f'/v1/alerts/{alertService.alertKey(row)}/response'
        for value in ('SAFE', 'NEEDS_HELP', 'NEEDS_HELP'):
            response = await client.post(path, headers=headers, json={'response': value})
            assert response.status_code == 200 and response.json()['myResponse'] == value
        rows = (await dbSession.execute(select(AlertResponse))).scalars().all()
        assert len(rows) == 1 and rows[0].user_id == user.id and rows[0].response == 'NEEDS_HELP'
        assert (await client.get('/v1/alerts', headers=headers)).json()['items'][0]['myResponse'] == 'NEEDS_HELP'
        assert (await client.get('/v1/alerts', headers=other)).json()['items'][0]['myResponse'] is None
        assert (await client.post(path, headers=headers, json={'response': 'INVALID'})).status_code == 422
        assert (await client.post(path, json={'response': 'SAFE'})).status_code == 401


@pytest.mark.asyncio
async def test_response_rejects_missing_inactive_and_non_alert_evidence(dbSession):
    now = datetime.now(timezone.utc)
    rows = [await warning(dbSession, **values) for values in ({'validUntil': now - timedelta(seconds=1)}, {'validFrom': now + timedelta(hours=1)}, {'authority': 'COMMUNITY', 'evidenceType': 'OBSERVATION', 'geometry': from_shape(Point(106.8, -6.2), srid=4326)}, {'evidenceType': 'OBSERVATION'})]
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        _, headers = await guest(client, dbSession)
        for alertId in [uuid.uuid4(), *(alertService.alertKey(row) for row in rows)]:
            assert (await client.post(f'/v1/alerts/{alertId}/response', headers=headers, json={'response': 'SAFE'})).status_code == 404
        assert (await dbSession.execute(select(func.count()).select_from(AlertResponse))).scalar_one() == 0


@pytest.mark.asyncio
@pytest.mark.parametrize('status', ['SIAGA', 'AWAS'])
async def test_worker_push_deduplicates_and_preserves_buddy_messages(dbSession, monkeypatch, status):
    row = await warning(dbSession, status)
    await warning(dbSession, 'WASPADA')
    await warning(dbSession, validUntil=datetime.now(timezone.utc) - timedelta(seconds=1))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        fresh, headers = await guest(client, dbSession)
        stale, _ = await guest(client, dbSession, age=25)
        outside, _ = await guest(client, dbSession, latitude=-6.3)
        missing, _ = await guest(client, dbSession, latitude=None, longitude=None)
        future, _ = await guest(client, dbSession, age=-1)
        for user in (fresh, stale, outside, missing, future):
            dbSession.add(BuddyPushToken(token=f'ExpoPushToken[{user.id}]', user_id=user.id))
        await buddyRequestService.event(dbSession, fresh.id, None, 'INVITATION_CONFIRMED', {})
        await dbSession.commit()
        buddy_inbox = await client.get('/v1/buddy/inbox', headers=headers)
        assert len(buddy_inbox.json()) == 1

    @asynccontextmanager
    async def database():
        yield dbSession

    calls = []
    apiClient = httpx.AsyncClient

    class Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def post(self, url, json):
            assert url.endswith('/send')
            calls.extend(json)
            return httpx.Response(200, request=httpx.Request('POST', url), json={'data': [{'status': 'ok', 'id': str(uuid.uuid4())} for message in json]})

    monkeypatch.setattr(config, 'ALERT_PUSH_ENABLED', True)
    monkeypatch.setattr(buddyWorker, 'SessionLocal', database)
    monkeypatch.setattr(buddyWorker.httpx, 'AsyncClient', Client)
    await buddyWorker.tick()
    await buddyWorker.tick()
    inboxes = (await dbSession.execute(select(BuddyInbox).where(BuddyInbox.kind == 'ALERT'))).scalars().all()
    assert len(inboxes) == 1 and inboxes[0].user_id == fresh.id and inboxes[0].request_id is None
    assert (await dbSession.execute(select(func.count()).select_from(BuddyOutbox).where(BuddyOutbox.inbox_id == inboxes[0].id))).scalar_one() == 1
    deliveries = (await dbSession.execute(select(AlertDelivery))).scalars().all()
    assert len(deliveries) == 1 and deliveries[0].alert_key == alertService.alertKey(row) and deliveries[0].user_id == fresh.id
    assert len(calls) == 2
    alert = next(message for message in calls if 'alertId' in message['data'])
    assert alert['title'] == f'Peringatan {status}'
    assert alert['body'] == 'Banjir di area Anda. Buka EvacuAid untuk langkah selanjutnya.'
    assert alert['interruptionLevel'] == 'time-sensitive' and alert['priority'] == 'high'
    assert alert['data']['alertId'] == str(alertService.alertKey(row)) and alert['data']['level'] == status.lower()
    buddy = next(message for message in calls if 'alertId' not in message['data'])
    assert buddy['title'] == 'EvacuAid Buddy' and buddy['body'] == 'Ada pembaruan Buddy. Buka aplikasi untuk melihat.'
    assert 'priority' not in buddy and 'interruptionLevel' not in buddy
    async with apiClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        response = await client.get('/v1/buddy/inbox', headers=headers)
        assert response.status_code == 200
        items = response.json()
        assert len(items) == 1 and items[0]['kind'] == 'INVITATION_CONFIRMED'


@pytest.mark.asyncio
async def test_waspada_does_not_enqueue_alerts(dbSession, monkeypatch):
    await warning(dbSession, 'WASPADA')
    user = User(latitude=-6.2, longitude=106.8, locationObservedAt=datetime.now(timezone.utc))
    dbSession.add(user)
    await dbSession.commit()

    @asynccontextmanager
    async def database():
        yield dbSession

    async def no_network(*args, **kwargs):
        raise AssertionError('unexpected Expo HTTP call')

    monkeypatch.setattr(config, 'ALERT_PUSH_ENABLED', True)
    monkeypatch.setattr(buddyWorker, 'SessionLocal', database)
    monkeypatch.setattr(buddyWorker.httpx.AsyncClient, 'post', no_network)
    await buddyWorker.tick()
    assert (await dbSession.execute(select(func.count()).select_from(BuddyInbox))).scalar_one() == 0
    assert (await dbSession.execute(select(func.count()).select_from(BuddyOutbox))).scalar_one() == 0
    assert (await dbSession.execute(select(func.count()).select_from(AlertDelivery))).scalar_one() == 0


@pytest.mark.asyncio
async def test_incoming_contacts_show_recent_latest_response_for_active_buddies(dbSession):
    row = await warning(dbSession)
    older_alert = await warning(dbSession, 'SIAGA')
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        helper, headers = await guest(client, dbSession)
        active, active_headers = await guest(client, dbSession)
        stale, _ = await guest(client, dbSession)
        empty, _ = await guest(client, dbSession)
        revoked, _ = await guest(client, dbSession)
        pending, _ = await guest(client, dbSession)
        outgoing, _ = await guest(client, dbSession)
        stranger, _ = await guest(client, dbSession)
        for user, status in ((active, 'ACTIVE'), (stale, 'ACTIVE'), (empty, 'ACTIVE'), (revoked, 'REVOKED'), (pending, 'PENDING')):
            dbSession.add(BuddyRelationship(userId=user.id, buddyUserId=helper.id, level='PRIMARY', status=status))
        dbSession.add(BuddyRelationship(userId=helper.id, buddyUserId=outgoing.id, level='PRIMARY', status='ACTIVE'))
        now = datetime.now(timezone.utc)
        for user in (stale, revoked, pending, outgoing, stranger):
            dbSession.add(AlertResponse(user_id=user.id, alert_key=alertService.alertKey(row), response='SAFE', updated_at=now - timedelta(hours=25) if user == stale else now))
        dbSession.add(AlertResponse(user_id=active.id, alert_key=alertService.alertKey(older_alert), response='EVACUATING', updated_at=now - timedelta(hours=1)))
        await dbSession.commit()
        assert (await client.post(f'/v1/alerts/{alertService.alertKey(row)}/response', headers=active_headers, json={'response': 'NEEDS_HELP'})).status_code == 200
        response = await client.get('/v1/buddy/contacts/incoming', headers=headers)
        assert response.status_code == 200
        contacts = {contact['userId']: contact for contact in response.json()}
        assert set(contacts) == {str(user.id) for user in (active, stale, empty)}
        latest = contacts[str(active.id)]['latestAlertResponse']
        assert latest['alertId'] == str(alertService.alertKey(row)) and latest['response'] == 'NEEDS_HELP'
        assert datetime.fromisoformat(latest['at']) >= now
        assert contacts[str(stale.id)]['latestAlertResponse'] is None
        assert contacts[str(empty.id)]['latestAlertResponse'] is None


def worker_database(monkeypatch, db):
    @asynccontextmanager
    async def database():
        yield db

    monkeypatch.setattr(config, 'ALERT_PUSH_ENABLED', True)
    monkeypatch.setattr(buddyWorker, 'SessionLocal', database)


@pytest.mark.asyncio
async def test_alert_state_survives_source_refresh(dbSession, monkeypatch):
    row = await warning(dbSession, 'SIAGA')
    old_id = row.id
    key = alertService.alertKey(row)
    evidence = HazardEvidence(sourceId=row.sourceId, hazardType=row.hazardType, source=row.source, authority=row.authority, evidenceType=row.evidenceType, geometry=mapping(to_shape(row.geometry)), observedAt=row.observedAt, validFrom=row.validFrom, validUntil=row.validUntil, metadata=row.evidenceMetadata)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        user, headers = await guest(client, dbSession)
        assert (await client.post(f'/v1/alerts/{key}/response', headers=headers, json={'response': 'SAFE'})).status_code == 200
    dbSession.add(BuddyPushToken(token=f'ExpoPushToken[{user.id}]', user_id=user.id))
    await dbSession.commit()
    worker_database(monkeypatch, dbSession)
    calls = []
    original_post = httpx.AsyncClient.post

    async def send(self, url, json):
        calls.extend(json)
        return httpx.Response(200, request=httpx.Request('POST', url), json={'data': [{'status': 'ok', 'id': str(uuid.uuid4())} for message in json]})

    monkeypatch.setattr(buddyWorker.httpx.AsyncClient, 'post', send)
    await buddyWorker.tick()
    await hazardRepository.replaceSource(dbSession, evidence.source, [evidence])
    await dbSession.commit()
    current = (await dbSession.execute(select(HazardRecord))).scalar_one()
    assert current.id != old_id and alertService.alertKey(current) == key
    await buddyWorker.tick()
    assert len(calls) == 1
    assert (await dbSession.execute(select(AlertDelivery))).scalar_one().alert_key == key
    assert (await dbSession.execute(select(AlertResponse))).scalar_one().response == 'SAFE'
    monkeypatch.setattr(buddyWorker.httpx.AsyncClient, 'post', original_post)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        item = (await client.get('/v1/alerts', headers=headers)).json()['items'][0]
        assert item['id'] == str(key) and item['myResponse'] == 'SAFE'
        assert (await client.post(f'/v1/alerts/{key}/response', headers=headers, json={'response': 'EVACUATING'})).status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize('change', ['expired', 'expired_with_token', 'waspada', 'removed', 'no_token_timeout'])
async def test_queued_alert_cancellation(dbSession, monkeypatch, change):
    row = await warning(dbSession, 'SIAGA')
    user = User(latitude=-6.2, longitude=106.8, locationObservedAt=datetime.now(timezone.utc))
    dbSession.add(user)
    await dbSession.commit()
    worker_database(monkeypatch, dbSession)

    async def no_network(*args, **kwargs):
        raise AssertionError('unexpected Expo HTTP call')

    monkeypatch.setattr(buddyWorker.httpx.AsyncClient, 'post', no_network)
    await buddyWorker.tick()
    outbox = (await dbSession.execute(select(BuddyOutbox))).scalar_one()
    inbox = await dbSession.get(BuddyInbox, outbox.inbox_id)
    outbox.next_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    if change == 'expired_with_token':
        dbSession.add(BuddyPushToken(token=f'ExpoPushToken[{user.id}]', user_id=user.id))
    if change in ('expired', 'expired_with_token'):
        row.validUntil = datetime.now(timezone.utc) - timedelta(seconds=1)
    elif change == 'waspada':
        row.evidenceMetadata = {'officialStatus': 'WASPADA'}
    elif change == 'removed':
        await hazardRepository.replaceSource(dbSession, row.source, [])
    else:
        inbox.created_at = datetime.now(timezone.utc) - timedelta(hours=3)
    await dbSession.commit()
    await buddyWorker.tick()
    assert outbox.sent_at is not None and outbox.attempts == 0
    if change != 'expired_with_token':
        dbSession.add(BuddyPushToken(token=f'ExpoPushToken[{user.id}]', user_id=user.id))
    await dbSession.commit()
    await buddyWorker.tick()
    assert outbox.attempts == 0


@pytest.mark.asyncio
async def test_worker_cleans_old_alert_state(dbSession, monkeypatch):
    user = User()
    dbSession.add(user)
    await dbSession.commit()
    now = datetime.now(timezone.utc)
    old, recent = uuid.uuid4(), uuid.uuid4()
    for key, at in ((old, now - timedelta(days=31)), (recent, now - timedelta(days=29))):
        dbSession.add(AlertDelivery(alert_key=key, user_id=user.id, level='siaga', created_at=at))
        dbSession.add(AlertResponse(alert_key=key, user_id=user.id, response='SAFE', created_at=at, updated_at=at))
    await dbSession.commit()
    worker_database(monkeypatch, dbSession)
    await buddyWorker.tick()
    assert [row.alert_key for row in (await dbSession.execute(select(AlertDelivery))).scalars()] == [recent]
    assert [row.alert_key for row in (await dbSession.execute(select(AlertResponse))).scalars()] == [recent]


@pytest.mark.asyncio
async def test_extreme_cap_alert_context_and_push(dbSession, monkeypatch):
    from app.routers import context as contextRouter
    from app.services.bmkg_service import BmkgFetchResult
    from app.services.cacheService import CacheService, getCache
    from app.services.hazardContextService import officialWarningForLocation
    from app.services.hazardProviders import parseCap
    from app.services.petabencana_service import PetaBencanaFetchResult

    now = datetime.now(timezone.utc)
    xml = f'''<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
    <identifier>SYNTHETIC_TEST_EXTREME_CAP</identifier><status>Actual</status><msgType>Alert</msgType>
    <sent>{(now - timedelta(minutes=5)).isoformat()}</sent><info><severity>Extreme</severity>
    <effective>{(now - timedelta(minutes=5)).isoformat()}</effective><expires>{(now + timedelta(hours=1)).isoformat()}</expires>
    <area><polygon>-6.21,106.79 -6.21,106.81 -6.19,106.81 -6.19,106.79 -6.21,106.79</polygon></area>
    </info></alert>'''
    evidence = parseCap(xml, now)
    await hazardRepository.replaceSource(dbSession, 'BMKG_CAP', evidence)
    await dbSession.commit()
    app = api(dbSession)
    app.include_router(contextRouter.router)
    app.dependency_overrides[getCache] = lambda: CacheService(None)

    async def weather(adm4):
        return BmkgFetchResult(None, 'SYNTHETIC_TEST_UNAVAILABLE')

    async def reports():
        return PetaBencanaFetchResult([])

    monkeypatch.setattr(contextRouter, 'fetch_weather', weather)
    monkeypatch.setattr(contextRouter, 'fetch_reports', reports)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        user, headers = await guest(client, dbSession)
        alerts = (await client.get('/v1/alerts', headers=headers)).json()['items']
        assert len(alerts) == 1 and alerts[0]['level'] == 'siaga' and alerts[0]['source'] == 'BMKG_CAP'
        warning = await officialWarningForLocation(dbSession, user.latitude, user.longitude)
        assert warning.status.value == 'SIAGA'
        response = await client.get('/v1/context', headers=headers)
        assert response.status_code == 200
        assert response.json()['event']['official_status'] == 'SIAGA'
        assert response.json()['action']['recommended_action'] == 'FOLLOW_OFFICIAL_INSTRUCTION'
    dbSession.add(BuddyPushToken(token=f'ExpoPushToken[{user.id}]', user_id=user.id))
    await dbSession.commit()
    worker_database(monkeypatch, dbSession)
    calls = []

    async def send(self, url, json):
        calls.extend(json)
        return httpx.Response(200, request=httpx.Request('POST', url), json={'data': [{'status': 'ok', 'id': str(uuid.uuid4())} for message in json]})

    monkeypatch.setattr(buddyWorker.httpx.AsyncClient, 'post', send)
    await buddyWorker.tick()
    await buddyWorker.tick()
    assert len(calls) == 1 and calls[0]['data']['alertId'] == alerts[0]['id']
    assert calls[0]['title'] == 'Peringatan SIAGA'
    assert (await dbSession.execute(select(func.count()).select_from(BuddyInbox).where(BuddyInbox.kind == 'ALERT'))).scalar_one() == 1
    assert (await dbSession.execute(select(func.count()).select_from(BuddyOutbox))).scalar_one() == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('status', ['SIAGA', 'AWAS'])
async def test_alert_push_disabled_preserves_api_and_later_delivery(dbSession, monkeypatch, status):
    row = await warning(dbSession, status)
    worker_database(monkeypatch, dbSession)
    monkeypatch.setattr(config, 'ALERT_PUSH_ENABLED', False)

    async def no_network(*args, **kwargs):
        raise AssertionError('unexpected Expo HTTP call')

    original_post = httpx.AsyncClient.post
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        _, headers = await guest(client, dbSession)
        monkeypatch.setattr(buddyWorker.httpx.AsyncClient, 'post', no_network)
        await buddyWorker.tick()
        await buddyWorker.tick()
        for model in (BuddyInbox, BuddyOutbox, AlertDelivery):
            assert (await dbSession.execute(select(func.count()).select_from(model))).scalar_one() == 0
        items = (await client.get('/v1/alerts', headers=headers)).json()['items']
        assert len(items) == 1 and items[0]['level'] == status.lower()
        monkeypatch.setattr(buddyWorker.httpx.AsyncClient, 'post', original_post)
        response = await client.post(f'/v1/alerts/{alertService.alertKey(row)}/response', headers=headers, json={'response': 'SAFE'})
        assert response.status_code == 200 and response.json()['myResponse'] == 'SAFE'
    worker_database(monkeypatch, dbSession)
    monkeypatch.setattr(buddyWorker.httpx.AsyncClient, 'post', no_network)
    await buddyWorker.tick()
    await buddyWorker.tick()
    for model in (BuddyInbox, BuddyOutbox, AlertDelivery):
        assert (await dbSession.execute(select(func.count()).select_from(model))).scalar_one() == 1


@pytest.mark.asyncio
async def test_queued_alert_uses_current_payload(dbSession, monkeypatch):
    row = await warning(dbSession, 'SIAGA')
    user = User(latitude=-6.2, longitude=106.8, locationObservedAt=datetime.now(timezone.utc))
    dbSession.add(user)
    await dbSession.commit()
    worker_database(monkeypatch, dbSession)
    await buddyWorker.tick()
    outbox = (await dbSession.execute(select(BuddyOutbox))).scalar_one()
    inbox = await dbSession.get(BuddyInbox, outbox.inbox_id)
    assert inbox.payload['level'] == 'siaga'
    row.evidenceMetadata = {'officialStatus': 'AWAS'}
    row.hazardType = 'TSUNAMI'
    outbox.next_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    dbSession.add(BuddyPushToken(token=f'ExpoPushToken[{user.id}]', user_id=user.id))
    await dbSession.commit()
    monkeypatch.setattr(config, 'ALERT_PUSH_ENABLED', False)
    calls = []

    async def send(self, url, json):
        calls.extend(json)
        return httpx.Response(200, request=httpx.Request('POST', url), json={'data': [{'status': 'ok', 'id': str(uuid.uuid4())} for message in json]})

    monkeypatch.setattr(buddyWorker.httpx.AsyncClient, 'post', send)
    await buddyWorker.tick()
    assert len(calls) == 1 and outbox.sent_at is not None
    assert calls[0]['title'] == 'Peringatan AWAS'
    assert calls[0]['body'] == 'Tsunami di area Anda. Buka EvacuAid untuk langkah selanjutnya.'
    assert calls[0]['data']['level'] == 'awas'
    assert calls[0]['data']['alertId'] == str(alertService.alertKey(row))
    assert calls[0]['interruptionLevel'] == 'time-sensitive' and calls[0]['priority'] == 'high'


@pytest.mark.asyncio
async def test_alert_escalation_delivers_once_per_level(dbSession, monkeypatch):
    row = await warning(dbSession, 'SIAGA')
    user = User(latitude=-6.2, longitude=106.8, locationObservedAt=datetime.now(timezone.utc))
    dbSession.add(user)
    await dbSession.commit()
    dbSession.add(BuddyPushToken(token=f'ExpoPushToken[{user.id}]', user_id=user.id))
    await dbSession.commit()
    worker_database(monkeypatch, dbSession)
    calls = []

    async def send(self, url, json):
        calls.extend(json)
        return httpx.Response(200, request=httpx.Request('POST', url), json={'data': [{'status': 'ok', 'id': str(uuid.uuid4())} for message in json]})

    monkeypatch.setattr(buddyWorker.httpx.AsyncClient, 'post', send)
    await buddyWorker.tick()
    await buddyWorker.tick()
    assert len(calls) == 1
    row.evidenceMetadata = {'officialStatus': 'AWAS'}
    await dbSession.commit()
    await buddyWorker.tick()
    await buddyWorker.tick()
    assert [message['data']['level'] for message in calls] == ['siaga', 'awas']
    assert {message['data']['alertId'] for message in calls} == {str(alertService.alertKey(row))}
    deliveries = (await dbSession.execute(select(AlertDelivery))).scalars().all()
    assert {delivery.level for delivery in deliveries} == {'siaga', 'awas'}
    assert len(deliveries) == 2
    for model in (BuddyInbox, BuddyOutbox):
        assert (await dbSession.execute(select(func.count()).select_from(model))).scalar_one() == 2


@pytest.mark.asyncio
async def test_simulated_warning_escalates_resets_answers_and_clears(dbSession):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        _, inside = await guest(client, dbSession)
        _, outside = await guest(client, dbSession, latitude=-6.3)
        await alertSimulation.apply(dbSession, 'waspada', center=(-6.2, 106.8), radiusKm=2)
        alert = (await client.get('/v1/alerts', headers=inside)).json()['items'][0]
        assert alert['level'] == 'waspada' and alert['source'] == 'DEMO_SIMULATION'
        assert (await client.get('/v1/alerts', headers=outside)).json()['items'] == []
        assert (await client.post(f"/v1/alerts/{alert['id']}/response", json={'response': 'SAFE'}, headers=inside)).status_code == 200
        await alertSimulation.apply(dbSession, 'awas', center=(-6.2, 106.8), radiusKm=2)
        escalated = (await client.get('/v1/alerts', headers=inside)).json()['items']
        assert [(item['id'], item['level'], item['myResponse']) for item in escalated] == [(alert['id'], 'awas', None)]
        assert await alertSimulation.clear(dbSession) == 1
        assert (await client.get('/v1/alerts', headers=inside)).json()['items'] == []


@pytest.mark.asyncio
async def test_dev_simulate_route_defaults_to_red_earthquake_at_the_phone(dbSession):
    app = api(dbSession)
    app.include_router(devRouter)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        _, headers = await guest(client, dbSession, latitude=-6.25, longitude=106.9)
        _, missing = await guest(client, dbSession, latitude=None, longitude=None)
        assert (await client.post('/v1/alerts/dev/simulate', json={}, headers=missing)).status_code == 409
        created = await client.post('/v1/alerts/dev/simulate', json={}, headers=headers)
        assert created.status_code == 201, created.text
        assert created.json()['level'] == 'awas' and created.json()['hazardType'] == 'EARTHQUAKE'
        listed = (await client.get('/v1/alerts', headers=headers)).json()['items']
        assert [item['id'] for item in listed] == [created.json()['id']]
        again = await client.post('/v1/alerts/dev/simulate', json={}, headers=headers)
        assert again.json()['id'] != created.json()['id']
        assert [item['id'] for item in (await client.get('/v1/alerts', headers=headers)).json()['items']] == [again.json()['id']]
        assert (await client.delete('/v1/alerts/dev/simulate', headers=headers)).status_code == 204
        assert (await client.get('/v1/alerts', headers=headers)).json()['items'] == []
