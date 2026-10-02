from datetime import datetime, timedelta, timezone
import uuid

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import select

from app.db.session import get_session
from app.db.models.pilot import PilotAttempt, PilotLocation, PilotRequest
from app.routers.pilot import router
from app.routers.sessions import router as sessions
from app.routers.assistance import router as assistance
from app.services import pilotService


def api(db):
    app = FastAPI()
    app.include_router(router)
    app.include_router(sessions)
    app.include_router(assistance)

    async def database():
        yield db

    app.dependency_overrides[get_session] = database
    return app


async def guest(client):
    response = (await client.post('/v1/guest-sessions')).json()
    return response['user']['id'], {'Authorization': 'Bearer ' + response['access_token']}


async def trusted(client, owner, helper):
    invite = (await client.post('/v1/buddy-pilot/invitations', headers=owner)).json()
    assert (await client.post('/v1/buddy-pilot/invitations/redeem', headers=helper, json={'code': invite['code']})).status_code == 200
    assert (await client.get('/v1/buddy-pilot/contacts', headers=owner)).json() == []
    assert (await client.post('/v1/buddy-pilot/invitations/' + invite['id'] + '/confirm', headers=owner)).status_code == 200
    return invite


@pytest.mark.asyncio
async def test_pilot_trust_session_completion_and_privacy(dbSession):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        owner_id, owner = await guest(client)
        helper_id, helper = await guest(client)
        _, stranger = await guest(client)
        await trusted(client, owner, helper)
        assert (await client.get('/v1/buddy-pilot/contacts', headers=owner)).json()[0]['available'] is False
        availability_point = {'optedIn': True, 'latitude': -6.2, 'longitude': 106.8, 'accuracyM': 5, 'observedAt': datetime.now(timezone.utc).isoformat()}
        stated = await client.put('/v1/buddy-pilot/availability', headers=helper, json=availability_point)
        assert stated.status_code == 200 and stated.json()['enrolled'] is False
        saved_contact = (await client.get('/v1/buddy-pilot/contacts', headers=owner)).json()[0]
        assert saved_contact['available'] and saved_contact['observedAt']
        assert 'latitude' not in saved_contact and 'longitude' not in saved_contact
        from app.db.models.pilot import PilotAvailability
        helper_presence = await dbSession.get(PilotAvailability, uuid.UUID(helper_id))
        helper_presence.observed_at = datetime.now(timezone.utc) - timedelta(minutes=3)
        await dbSession.commit()
        assert (await client.get('/v1/buddy-pilot/contacts', headers=owner)).json()[0]['available'] is False
        payload = {'helperUserId': helper_id, 'message': 'Please help', 'sharingConsent': True, 'idempotencyKey': 'pilot-test-request'}
        created = await client.post('/v1/buddy-pilot/requests', headers=owner, json=payload)
        assert created.status_code == 201, created.text
        request = created.json()
        path = '/v1/buddy-pilot/requests/' + request['id']
        assert (await client.post('/v1/buddy-pilot/requests', headers=owner, json=payload)).json()['id'] == request['id']
        assert (await client.post('/v1/assistance/requests', headers=owner, json={})).status_code == 409
        assert (await client.get(path, headers=stranger)).status_code == 403
        point = {'latitude': -6.2, 'longitude': 106.8, 'accuracyM': 5, 'observedAt': datetime.now(timezone.utc).isoformat(), 'sharingConsent': True, 'sharingVersion': 0}
        assert (await client.put(path + '/location', headers=owner, json=point)).status_code == 409
        offer = {'attemptId': request['attempts'][0]['id'], 'sharingConsent': True}
        accepted = await client.post(path + '/accept', headers=helper, json=offer)
        assert accepted.status_code == 200, accepted.text
        assert (await client.delete('/v1/guest-sessions/current', headers=helper)).status_code == 409
        assert (await client.put(path + '/location', headers=owner, json=point)).status_code == 200
        assert (await client.get(path + '/location', headers=stranger)).status_code == 403
        older = {**point, 'observedAt': (datetime.fromisoformat(point['observedAt']) - timedelta(seconds=1)).isoformat()}
        assert (await client.put(path + '/location', headers=owner, json=older)).json()['updated'] is False
        stopped = await client.delete(path + '/location', headers=owner)
        assert stopped.status_code == 200 and stopped.json()['sharingVersion'] == 1
        assert (await client.put(path + '/location', headers=owner, json=point)).status_code == 409
        assert (await client.get(path + '/location', headers=owner)).json()['sharingVersion'] == 1
        assert (await client.get(path + '/location', headers=owner)).json()['locations'] == []
        point['sharingVersion'] = 1
        assert (await client.put(path + '/location', headers=owner, json={**point, 'sharingConsent': False})).status_code == 409
        assert (await client.put(path + '/phone-sharing', headers=owner, json={'enabled': True})).status_code == 200
        assert (await client.get(path, headers=owner)).json()['phoneShared'] is True
        assert (await client.get(path, headers=helper)).json()['phoneShared'] is False
        assert (await client.post('/v1/buddy-pilot/requests', headers=owner, json=payload)).json()['phoneShared'] is True
        assert (await client.put(path + '/location', headers=owner, json=point)).status_code == 200
        assert (await client.post('/v1/assistance/requests/' + request['id'] + '/safe', headers=helper)).status_code == 409
        assert (await client.post(path + '/messages', headers=owner, json={'text': 'Here', 'idempotencyKey': 'message-1'})).status_code == 201
        assert len((await client.get(path + '/messages', headers=helper)).json()) == 1
        assert (await client.post(path + '/depart', headers=helper)).status_code == 200
        assert (await client.post(path + '/arrive', headers=helper)).status_code == 200
        assert (await client.post(path + '/evacuating', headers=helper)).status_code == 409
        assert (await client.post(path + '/confirm-meeting', headers=owner)).status_code == 200
        assert (await client.post(path + '/evacuating', headers=helper)).status_code == 200
        assert (await client.post(path + '/report-complete', headers=helper)).json()['status'] == 'COMPLETION_PENDING'
        assert (await client.post(path + '/confirm-complete', headers=helper)).status_code == 403
        assert (await client.post(path + '/confirm-complete', headers=owner)).json()['status'] == 'COMPLETED'
        assert (await client.get(path + '/location', headers=owner)).status_code == 409
        assert (await dbSession.execute(select(PilotLocation).where(PilotLocation.request_id == uuid.UUID(request['id'])))).first() is None


@pytest.mark.asyncio
async def test_expiry_explicit_fallback_and_interrupt(dbSession, monkeypatch):
    monkeypatch.setenv('BUDDY_PILOT_ENROLLMENT_CODE', 'test-pilot')
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        _, owner = await guest(client)
        helper_id, helper = await guest(client)
        volunteer_id, volunteer = await guest(client)
        await trusted(client, owner, helper)
        request = (await client.post('/v1/buddy-pilot/requests', headers=owner, json={'helperUserId': helper_id, 'sharingConsent': True, 'idempotencyKey': 'expiry-request'})).json()
        attempt = await dbSession.get(PilotAttempt, uuid.UUID(request['attempts'][0]['id']))
        attempt.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await dbSession.commit()
        await pilotService.expire(dbSession)
        await dbSession.commit()
        path = '/v1/buddy-pilot/requests/' + request['id']
        assert (await client.get(path, headers=owner)).json()['status'] == 'FALLBACK_REQUIRED'
        assert (await client.post(path + '/accept', headers=helper, json={'attemptId': str(attempt.id), 'sharingConsent': True})).status_code in (403, 409)
        point = {'latitude': -6.2, 'longitude': 106.8, 'accuracyM': 5, 'observedAt': datetime.now(timezone.utc).isoformat()}
        assert (await client.post('/v1/buddy-pilot/enrollment', headers=volunteer, json={'code': 'test-pilot'})).status_code == 200
        assert (await client.put('/v1/buddy-pilot/availability', headers=volunteer, json={'optedIn': True, **point})).status_code == 200
        nearby = await client.post(path + '/nearby', headers=owner, json=point)
        assert nearby.status_code == 200, nearby.text
        assert nearby.json()['attempts'][-1]['helperUserId'] == volunteer_id
        assert (await client.post(path + '/interrupt', headers=owner)).json()['status'] == 'INTERRUPTED'
        assert (await client.post(path + '/accept', headers=volunteer, json={'attemptId': nearby.json()['attempts'][-1]['id'], 'sharingConsent': True})).status_code in (403, 409)


@pytest.mark.asyncio
async def test_push_tickets_receipts_and_retention(dbSession, monkeypatch):
    from app.db.models import User
    from app.db.models.pilot import PilotInbox, PilotMessage, PilotOutbox, PilotPushToken
    from app.services import pilotWorker
    from contextlib import asynccontextmanager

    user = User(name='Push pilot')
    dbSession.add(user)
    await dbSession.flush()
    token = 'ExpoPushToken[test_device]'
    dbSession.add(PilotPushToken(token=token, user_id=user.id))
    await pilotService.event(dbSession, user.id, None, 'INVITATION_CONFIRMED', {'invitationId': str(uuid.uuid4())})
    await dbSession.commit()

    @asynccontextmanager
    async def database():
        yield dbSession

    calls = []

    class Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def post(self, url, json):
            calls.append((url, json))
            if url.endswith('/send'):
                assert 'latitude' not in str(json)
                return httpx.Response(200, request=httpx.Request('POST', url), json={'data': [{'status': 'ok', 'id': 'ticket-1'}]})
            return httpx.Response(200, request=httpx.Request('POST', url), json={'data': {'ticket-1': {'status': 'error', 'details': {'error': 'DeviceNotRegistered'}}}})

    monkeypatch.setattr(pilotWorker, 'SessionLocal', database)
    monkeypatch.setattr(pilotWorker.httpx, 'AsyncClient', Client)
    await pilotWorker.tick()
    outbox = (await dbSession.execute(select(PilotOutbox))).scalars().one()
    assert outbox.sent_at is not None
    assert not outbox.tickets[0]['receiptChecked']
    outbox.sent_at = datetime.now(timezone.utc) - timedelta(seconds=20)
    await dbSession.commit()
    await pilotWorker.tick()
    await dbSession.refresh(outbox)
    assert outbox.tickets[0]['receiptChecked']
    assert await dbSession.get(PilotPushToken, token) is None
    assert len(calls) == 2


@pytest.mark.asyncio
async def test_parallel_requests_keep_single_canonical_assignment(dbSession):
    import asyncio
    from app.db.models import AssistanceRequest

    app = FastAPI()
    app.include_router(router)
    app.include_router(sessions)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        owner_id, owner = await guest(client)
        helper_id, helper = await guest(client)
        await trusted(client, owner, helper)
        first, second = await asyncio.gather(*[
            client.post('/v1/buddy-pilot/requests', headers=owner, json={'helperUserId': helper_id, 'sharingConsent': True, 'idempotencyKey': 'parallel-' + str(index)}) for index in range(2)
        ])
        assert sorted([first.status_code, second.status_code]) == [201, 409]
        requests = (await dbSession.execute(select(AssistanceRequest).where(AssistanceRequest.userId == uuid.UUID(owner_id)))).scalars().all()
        assert len(requests) == 1
        assert requests[0].pilot


@pytest.mark.asyncio
async def test_two_leg_navigation_uses_maneuvers_and_requester_mobility(dbSession, monkeypatch):
    from app.models.user import UserCreate, AccessibilityUpdate
    from app.models.pilot import SessionRoute
    from app.services import pilotNavigation, user_service
    from app.services.valhallaProvider import RouteData

    owner = await user_service.create_user(dbSession, UserCreate(name='Requester'))
    helper = await user_service.create_user(dbSession, UserCreate(name='Helper'))
    await user_service.update_accessibility(dbSession, owner.id, AccessibilityUpdate(items=[{'type': 'MOBILITY_LIMITATION'}]))
    request = PilotRequest(requester_id=owner.id, helper_id=helper.id, status='ACCEPTED', pilot=True, idempotency_key='route-test', sharing_consent=True)
    dbSession.add(request)
    await dbSession.flush()
    for user in (owner, helper):
        dbSession.add(PilotLocation(request_id=request.id, user_id=user.id, latitude=-6.2, longitude=106.8, accuracy_m=5, observed_at=datetime.now(timezone.utc)))
    await dbSession.commit()
    profiles = []

    async def route(self, origin, destination, profile):
        profiles.append(profile)
        return RouteData(100, 60, {'type': 'LineString', 'coordinates': [[106.8, -6.2], [106.801, -6.201]]}, [{'instruction': 'Continue', 'beginShapeIndex': 0, 'endShapeIndex': 1, 'distanceM': 100, 'durationSec': 60, 'type': 1}])

    async def hazards(geometry):
        return 'UNKNOWN', ['HAZARD_DATA_UNAVAILABLE']

    monkeypatch.setattr(pilotNavigation.ValhallaRoutingProvider, 'route', route)
    monkeypatch.setattr(pilotNavigation, 'routeHazards', hazards)
    result = await pilotNavigation.session_route(dbSession, request, helper.id, SessionRoute(leg='TO_REQUESTER', profile='WALKING'))
    assert profiles == ['WHEELCHAIR']
    assert result['route']['maneuvers'][0]['endShapeIndex'] == 1
    assert result['evaluation']['accessibilityStatus'] == 'UNKNOWN'


@pytest.mark.asyncio
async def test_valhalla_rejects_invalid_maneuver_metrics(monkeypatch):
    from app.services import valhallaProvider

    class Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def post(self, url, json):
            assert json['costing_options']['pedestrian']['type'] == 'wheelchair'
            return httpx.Response(200, request=httpx.Request('POST', url), json={'trip': {'summary': {'length': 1, 'time': 60}, 'legs': [{'shape': {'type': 'LineString', 'coordinates': [[106.8, -6.2], [106.81, -6.21]]}, 'maneuvers': [{'instruction': 'Continue', 'begin_shape_index': 0, 'end_shape_index': 1, 'length': -1, 'time': 10}]}]}})

    monkeypatch.setattr(valhallaProvider.httpx, 'AsyncClient', Client)
    with pytest.raises(valhallaProvider.NoRoute):
        await valhallaProvider.ValhallaRoutingProvider().route((-6.2, 106.8), (-6.21, 106.81), 'WHEELCHAIR')


@pytest.mark.asyncio
async def test_invitation_confirmer_expiry_revocation_and_replay(dbSession):
    from app.db.models.pilot import PilotInvitation

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        _, owner = await guest(client)
        _, helper = await guest(client)
        _, stranger = await guest(client)
        invitation = (await client.post('/v1/buddy-pilot/invitations', headers=owner)).json()
        assert (await client.post('/v1/buddy-pilot/invitations/redeem', headers=helper, json={'code': invitation['code']})).status_code == 200
        path = '/v1/buddy-pilot/invitations/' + invitation['id']
        assert (await client.post(path + '/confirm', headers=helper)).status_code == 404
        assert (await client.post(path + '/confirm', headers=stranger)).status_code == 404
        assert (await client.delete(path, headers=owner)).json()['status'] == 'REVOKED'
        assert (await client.post(path + '/confirm', headers=owner)).status_code == 409
        assert (await client.post('/v1/buddy-pilot/invitations/redeem', headers=helper, json={'code': invitation['code']})).status_code == 409
        expired = (await client.post('/v1/buddy-pilot/invitations', headers=owner)).json()
        row = await dbSession.get(PilotInvitation, uuid.UUID(expired['id']))
        row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await dbSession.commit()
        assert (await client.post('/v1/buddy-pilot/invitations/redeem', headers=helper, json={'code': expired['code']})).status_code == 409
        assert (await client.get('/v1/buddy-pilot/contacts', headers=owner)).json() == []
        confirmed_invitation = await trusted(client, owner, helper)
        assert (await client.post('/v1/buddy-pilot/invitations/redeem', headers=helper, json={'code': confirmed_invitation['code']})).status_code == 409
        confirmed = (await client.get('/v1/buddy-pilot/invitations', headers=owner)).json()
        assert sum(item['status'] == 'CONFIRMED' for item in confirmed) == 1


@pytest.mark.asyncio
async def test_competing_acceptance_rejects_stale_offer_and_keeps_one_helper(dbSession, monkeypatch):
    import asyncio

    monkeypatch.setenv('BUDDY_PILOT_ENROLLMENT_CODE', 'acceptance-test')
    app = FastAPI()
    app.include_router(router)
    app.include_router(sessions)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        _, owner = await guest(client)
        helper_id, helper = await guest(client)
        volunteer_id, volunteer = await guest(client)
        await trusted(client, owner, helper)
        request = (await client.post('/v1/buddy-pilot/requests', headers=owner, json={'helperUserId': helper_id, 'sharingConsent': True, 'idempotencyKey': 'competing-acceptance'})).json()
        stale_id = uuid.UUID(request['attempts'][0]['id'])
        attempt = await dbSession.get(PilotAttempt, stale_id)
        attempt.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await dbSession.commit()
        await pilotService.expire(dbSession)
        await dbSession.commit()
        point = {'latitude': -6.2, 'longitude': 106.8, 'accuracyM': 5, 'observedAt': datetime.now(timezone.utc).isoformat()}
        assert (await client.post('/v1/buddy-pilot/enrollment', headers=volunteer, json={'code': 'acceptance-test'})).status_code == 200
        assert (await client.put('/v1/buddy-pilot/availability', headers=volunteer, json={'optedIn': True, **point})).status_code == 200
        path = '/v1/buddy-pilot/requests/' + request['id']
        nearby = (await client.post(path + '/nearby', headers=owner, json=point)).json()
        fresh_id = nearby['attempts'][-1]['id']
        losing, winner, retry = await asyncio.gather(
            client.post(path + '/accept', headers=helper, json={'attemptId': str(stale_id), 'sharingConsent': True}),
            client.post(path + '/accept', headers=volunteer, json={'attemptId': fresh_id, 'sharingConsent': True}),
            client.post(path + '/accept', headers=volunteer, json={'attemptId': fresh_id, 'sharingConsent': True}),
        )
        assert losing.status_code in (403, 409)
        assert winner.status_code == retry.status_code == 200
        assert winner.json()['helperUserId'] == retry.json()['helperUserId'] == volunteer_id
        canonical = (await client.get(path, headers=owner)).json()
        assert canonical['status'] == 'ACCEPTED'
        assert sum(attempt['status'] == 'ACCEPTED' for attempt in canonical['attempts']) == 1
        assert next(attempt for attempt in canonical['attempts'] if attempt['id'] == str(stale_id))['status'] == 'EXPIRED'


@pytest.mark.asyncio
async def test_delayed_availability_refresh_cannot_undo_opt_out(dbSession):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        _, helper = await guest(client)
        point = {'latitude': -6.2, 'longitude': 106.8, 'accuracyM': 5, 'observedAt': datetime.now(timezone.utc).isoformat()}
        assert (await client.put('/v1/buddy-pilot/availability', headers=helper, json={'optedIn': True, **point})).status_code == 200
        assert (await client.put('/v1/buddy-pilot/availability', headers=helper, json={'optedIn': True, 'refreshOnly': True, **point})).status_code == 200
        assert (await client.put('/v1/buddy-pilot/availability', headers=helper, json={'optedIn': False})).json()['optedIn'] is False
        delayed = await client.put('/v1/buddy-pilot/availability', headers=helper, json={'optedIn': True, 'refreshOnly': True, **point})
        assert delayed.status_code == 409
        assert (await client.get('/v1/buddy-pilot/availability', headers=helper)).json()['optedIn'] is False
        explicit = await client.put('/v1/buddy-pilot/availability', headers=helper, json={'optedIn': True, **point})
        assert explicit.status_code == 200 and explicit.json()['optedIn'] is True
