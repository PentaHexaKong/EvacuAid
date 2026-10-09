from datetime import datetime, timedelta, timezone
import uuid

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import select, update

from app.db.session import get_session
from app.db.models.pilot import PilotAttempt, PilotInvitation, PilotLocation, PilotRequest
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
        assert stated.status_code == 200 and stated.json()['enrolled'] is True
        assert (await client.get('/v1/buddy-pilot/availability', headers=stranger)).json()['enrolled'] is False
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
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        _, owner = await guest(client)
        helper_id, helper = await guest(client)
        volunteer_id, volunteer = await guest(client)
        await trusted(client, owner, helper)
        request = (await client.post('/v1/buddy-pilot/requests', headers=owner, json={'helperUserId': helper_id, 'sharingConsent': True, 'idempotencyKey': 'expiry-request'})).json()
        assert (await client.get('/v1/buddy-pilot/requests/current', headers=helper)).json()['id'] == request['id']
        assert (await client.get('/v1/buddy-pilot/requests/current', headers=volunteer)).json() is None
        attempt = await dbSession.get(PilotAttempt, uuid.UUID(request['attempts'][0]['id']))
        attempt.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await dbSession.commit()
        await pilotService.expire(dbSession)
        await dbSession.commit()
        path = '/v1/buddy-pilot/requests/' + request['id']
        assert (await client.get(path, headers=owner)).json()['status'] == 'FALLBACK_REQUIRED'
        assert (await client.get('/v1/buddy-pilot/requests/current', headers=helper)).json() is None
        assert (await client.post(path + '/accept', headers=helper, json={'attemptId': str(attempt.id), 'sharingConsent': True})).status_code in (403, 409)
        point = {'latitude': -6.2, 'longitude': 106.8, 'accuracyM': 5, 'observedAt': datetime.now(timezone.utc).isoformat()}
        await trusted(client, (await guest(client))[1], volunteer)
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
        dbSession.add(PilotLocation(request_id=request.id, user_id=user.id, latitude=-6.201 if user is owner else -6.2, longitude=106.801 if user is owner else 106.8, accuracy_m=5, observed_at=datetime.now(timezone.utc)))
    await dbSession.commit()
    profiles = []

    async def route(self, origin, destination, profile):
        profiles.append(profile)
        return RouteData(100, 60, {'type': 'LineString', 'coordinates': [[106.8, -6.2], [106.801, -6.201]]}, [{'instruction': 'Continue', 'beginShapeIndex': 0, 'endShapeIndex': 1, 'distanceM': 100, 'durationSec': 60, 'type': 1}])

    async def hazards(geometry):
        return 'UNKNOWN', ['HAZARD_DATA_UNAVAILABLE']

    async def routes(self, origin, destination, profile, **kwargs):
        return [await route(self, origin, destination, profile)]

    monkeypatch.setattr(pilotNavigation.ValhallaRoutingProvider, 'routes', routes)
    monkeypatch.setattr(pilotNavigation, 'routeHazards', hazards)
    result = await pilotNavigation.session_route(dbSession, request, helper.id, SessionRoute(leg='TO_REQUESTER', profile='WALKING'))
    assert profiles == ['WHEELCHAIR']
    assert result['route']['maneuvers'][0]['endShapeIndex'] == 1
    assert result['evaluation']['accessibilityStatus'] == 'UNKNOWN'


@pytest.mark.asyncio
async def test_requester_sees_helper_approach_route(dbSession, monkeypatch):
    from fastapi import HTTPException
    from app.models.user import UserCreate
    from app.models.pilot import SessionRoute
    from app.services import pilotNavigation, user_service
    from app.services.valhallaProvider import RouteData

    owner = await user_service.create_user(dbSession, UserCreate(name='Requester'))
    helper = await user_service.create_user(dbSession, UserCreate(name='Helper'))
    request = PilotRequest(requester_id=owner.id, helper_id=helper.id, status='EN_ROUTE', pilot=True, idempotency_key='approach-test', sharing_consent=True)
    dbSession.add(request)
    await dbSession.flush()
    now = datetime.now(timezone.utc)
    dbSession.add(PilotLocation(request_id=request.id, user_id=owner.id, latitude=-6.2, longitude=106.8, accuracy_m=5, observed_at=now))
    helper_point = PilotLocation(request_id=request.id, user_id=helper.id, latitude=-6.21, longitude=106.81, accuracy_m=5, observed_at=now)
    dbSession.add(helper_point)
    await dbSession.commit()
    legs = []

    async def route(self, origin, destination, profile):
        legs.append((origin, destination))
        return RouteData(1000, 600, {'type': 'LineString', 'coordinates': [[106.81, -6.21], [106.8, -6.2]]}, [{'instruction': 'Continue', 'beginShapeIndex': 0, 'endShapeIndex': 1, 'distanceM': 1000, 'durationSec': 600, 'type': 1}])

    async def hazards(geometry):
        return 'UNKNOWN', []

    async def routes(self, origin, destination, profile, **kwargs):
        return [await route(self, origin, destination, profile)]

    monkeypatch.setattr(pilotNavigation.ValhallaRoutingProvider, 'routes', routes)
    monkeypatch.setattr(pilotNavigation, 'routeHazards', hazards)
    result = await pilotNavigation.session_route(dbSession, request, owner.id, SessionRoute(leg='TO_REQUESTER', profile='WALKING'))
    assert result['routeStatus'] == 'READY'
    assert legs == [((-6.21, 106.81), (-6.2, 106.8))]

    helper_point.observed_at = now - timedelta(minutes=2)
    await dbSession.commit()
    with pytest.raises(HTTPException) as stale:
        await pilotNavigation.session_route(dbSession, request, owner.id, SessionRoute(leg='TO_REQUESTER', profile='WALKING'))
    assert stale.value.status_code == 409

    helper_point.observed_at = now
    request.status = 'ARRIVED'
    await dbSession.commit()
    with pytest.raises(HTTPException) as arrived:
        await pilotNavigation.session_route(dbSession, request, owner.id, SessionRoute(leg='TO_REQUESTER', profile='WALKING'))
    assert arrived.value.status_code == 409


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
        await trusted(client, (await guest(client))[1], volunteer)
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


@pytest.mark.asyncio
async def test_incoming_contact_needs_relation_and_removal(dbSession):
    from app.db.models import BuddyRelationship, UserAccessibility

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        owner_id, owner = await guest(client)
        _, helper = await guest(client)
        await trusted(client, owner, helper)
        row = (await dbSession.execute(select(BuddyRelationship))).scalar_one()
        row.relation = 'KELUARGA'
        dbSession.add_all([UserAccessibility(user_id=uuid.UUID(owner_id), type=kind) for kind in ['VISUAL', 'MOBILITY']])
        await dbSession.commit()
        contacts = (await client.get('/v1/buddy-pilot/contacts/incoming', headers=helper)).json()
        assert len(contacts) == 1 and contacts[0]['userId'] == owner_id
        assert contacts[0]['needs'] == ['MOBILITY', 'VISUAL'] and contacts[0]['relation'] == 'KELUARGA'
        assert (await client.get('/v1/buddy-pilot/contacts', headers=owner)).json()[0]['relation'] == 'KELUARGA'
        assert (await client.delete('/v1/buddy-pilot/contacts/' + contacts[0]['id'], headers=helper)).status_code == 200
        assert (await client.get('/v1/buddy-pilot/contacts/incoming', headers=helper)).json() == []


@pytest.mark.asyncio
async def test_personal_code_stability_and_collision_retry(dbSession, monkeypatch):
    import re
    from app.db.models import User

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        _, owner = await guest(client)
        first = await client.get('/v1/buddy-pilot/me/code', headers=owner)
        assert first.status_code == 200 and re.fullmatch(r'[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}', first.json()['code'])
        assert (await client.get('/v1/buddy-pilot/me/code', headers=owner)).json() == first.json()
        helper_id, helper = await guest(client)
        occupied = await dbSession.get(User, uuid.UUID(helper_id))
        occupied.buddy_code = '2345-6789'
        await dbSession.commit()
        _, stranger = await guest(client)
        chars = iter('234567892345678A')
        monkeypatch.setattr('app.routers.pilot.secrets.choice', lambda alphabet: next(chars))
        assert (await client.get('/v1/buddy-pilot/me/code', headers=stranger)).json() == {'code': '2345-678A'}
        assert (await client.get('/v1/buddy-pilot/me/code', headers=helper)).json() == {'code': '2345-6789'}


@pytest.mark.asyncio
@pytest.mark.parametrize('direction', ['OFFER_HELP', 'SEEK_HELP'])
async def test_direct_invitation_direction_needs_and_acceptance(dbSession, direction):
    from app.db.models import BuddyRelationship, User, UserAccessibility
    from app.db.models.pilot import PilotInbox, PilotInvitation

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        sender_id, sender = await guest(client)
        target_id, target = await guest(client)
        _, stranger = await guest(client)
        owner = await dbSession.get(User, uuid.UUID(sender_id))
        redeemer = await dbSession.get(User, uuid.UUID(target_id))
        owner.name, redeemer.name = 'Sender', 'Target'
        dbSession.add_all([UserAccessibility(user_id=owner.id, type='VISUAL'), UserAccessibility(user_id=redeemer.id, type='MOBILITY')])
        await dbSession.commit()
        code = (await client.get('/v1/buddy-pilot/me/code', headers=target)).json()['code']
        sent = await client.post('/v1/buddy-pilot/invitations/direct', headers=sender, json={'code': code.lower().replace('-', ''), 'relation': 'TEMAN', 'direction': direction})
        assert sent.status_code == 201, sent.text
        invitation = sent.json()
        assert set(invitation) == {'id', 'expiresAt', 'status', 'redeemerUserId', 'redeemerName', 'direction', 'relation', 'ownerName', 'ownerUserId', 'ownerNeeds'}
        assert invitation['status'] == 'SENT' and invitation['direction'] == direction and invitation['relation'] == 'TEMAN'
        assert invitation['ownerUserId'] == sender_id and invitation['ownerName'] == 'Sender'
        assert invitation['redeemerUserId'] == target_id and invitation['redeemerName'] == 'Target'
        assert invitation['ownerNeeds'] == []
        assert timedelta(days=6, hours=23) < datetime.fromisoformat(invitation['expiresAt']) - datetime.now(timezone.utc) <= timedelta(days=7)
        received = (await client.get('/v1/buddy-pilot/invitations/received', headers=target)).json()
        assert len(received) == 1 and received[0]['ownerNeeds'] == (['VISUAL'] if direction == 'SEEK_HELP' else [])
        assert (await client.get('/v1/buddy-pilot/invitations/received', headers=stranger)).json() == []
        assert (await client.get('/v1/buddy-pilot/invitations', headers=sender)).json() == [invitation]
        assert (await client.get('/v1/buddy-pilot/inbox', headers=target)).json()[0]['kind'] == 'INVITATION_RECEIVED'
        path = '/v1/buddy-pilot/invitations/' + invitation['id']
        assert (await client.post(path + '/accept', headers=sender)).status_code == 404
        assert (await client.post(path + '/accept', headers=stranger)).status_code == 404
        assert (await client.post(path + '/confirm', headers=sender)).status_code == 409
        assert (await client.post('/v1/buddy-pilot/invitations/redeem', headers=target, json={'code': code})).status_code == 409
        accepted = await client.post(path + '/accept', headers=target)
        assert accepted.status_code == 200 and accepted.json()['status'] == 'CONFIRMED'
        assert accepted.json()['ownerNeeds'] == []
        assert (await client.post(path + '/accept', headers=target)).json() == accepted.json()
        assert (await client.post(path + '/accept', headers=sender)).status_code == 404
        person_id, helper_id, person, helper, needs = (target_id, sender_id, target, sender, ['MOBILITY']) if direction == 'OFFER_HELP' else (sender_id, target_id, sender, target, ['VISUAL'])
        relationship = (await dbSession.execute(select(BuddyRelationship))).scalar_one()
        assert str(relationship.userId) == person_id and str(relationship.buddyUserId) == helper_id
        assert relationship.relation == 'TEMAN' and relationship.level == 'PRIMARY' and relationship.status == 'ACTIVE'
        incoming = (await client.get('/v1/buddy-pilot/contacts/incoming', headers=helper)).json()[0]
        assert incoming['userId'] == person_id and incoming['needs'] == needs and incoming['relation'] == 'TEMAN'
        assert (await client.get('/v1/buddy-pilot/contacts', headers=person)).json()[0]['relation'] == 'TEMAN'
        assert (await client.get('/v1/buddy-pilot/invitations/received', headers=target)).json() == []
        assert (await client.post('/v1/buddy-pilot/invitations/direct', headers=sender, json={'code': code, 'relation': 'TEMAN', 'direction': direction})).status_code == 409
        assert (await client.delete(path, headers=sender)).status_code == 409
        assert (await client.post(path + '/decline', headers=target)).status_code == 409
        assert (await dbSession.get(PilotInvitation, uuid.UUID(invitation['id']))).code_hash is None
        assert len((await dbSession.execute(select(PilotInbox).where(PilotInbox.kind == 'INVITATION_ACCEPTED', PilotInbox.user_id == uuid.UUID(sender_id)))).scalars().all()) == 1


@pytest.mark.asyncio
async def test_direct_invitation_validation_decline_and_revoke(dbSession):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        _, sender = await guest(client)
        _, target = await guest(client)
        _, stranger = await guest(client)
        path = '/v1/buddy-pilot/invitations/direct'
        payload = {'code': 'ZZZZ-ZZZZ', 'relation': 'TETANGGA', 'direction': 'SEEK_HELP'}
        missing = await client.post(path, headers=sender, json=payload)
        assert missing.status_code == 404 and missing.json()['detail'] == 'buddy code not found'
        own_code = (await client.get('/v1/buddy-pilot/me/code', headers=sender)).json()['code']
        assert (await client.post(path, headers=sender, json={**payload, 'code': own_code})).status_code == 409
        code = (await client.get('/v1/buddy-pilot/me/code', headers=target)).json()['code']
        payload['code'] = ' \t' + code[:4].lower() + ' -\n ' + code[5:].lower() + ' '
        invitation = (await client.post(path, headers=sender, json=payload)).json()
        assert (await client.post(path, headers=sender, json=payload)).status_code == 409
        for invalid in ['1234-5678', '2345-678', '2345-67899', 'OOOO-OOOO', 'IIII-IIII', 'LLLL-LLLL', '2345-678!']:
            assert (await client.post(path, headers=sender, json={**payload, 'code': invalid})).status_code == 422
        assert (await client.post(path, headers=sender, json={**payload, 'relation': 'OTHER'})).status_code == 422
        assert (await client.post(path, headers=sender, json={**payload, 'direction': 'OTHER'})).status_code == 422
        invite_path = '/v1/buddy-pilot/invitations/' + invitation['id']
        assert (await client.post(invite_path + '/decline', headers=sender)).status_code == 404
        assert (await client.post(invite_path + '/decline', headers=stranger)).status_code == 404
        assert (await client.delete(invite_path, headers=target)).status_code == 404
        assert (await client.post(invite_path + '/decline', headers=target)).json()['status'] == 'DECLINED'
        assert (await client.post(invite_path + '/accept', headers=target)).status_code == 409
        assert (await client.get('/v1/buddy-pilot/invitations', headers=sender)).json()[0]['status'] == 'DECLINED'
        assert (await client.get('/v1/buddy-pilot/invitations/received', headers=target)).json() == []
        fresh = (await client.post(path, headers=sender, json=payload)).json()
        fresh_path = '/v1/buddy-pilot/invitations/' + fresh['id']
        assert (await client.delete(fresh_path, headers=sender)).json()['status'] == 'REVOKED'
        assert (await client.post(fresh_path + '/accept', headers=target)).status_code == 409
        assert (await client.post(fresh_path + '/decline', headers=target)).status_code == 409


@pytest.mark.asyncio
async def test_direct_invitations_are_capped_per_day(dbSession):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        sender_id, sender = await guest(client)
        target_id, target = await guest(client)
        code = (await client.get('/v1/buddy-pilot/me/code', headers=target)).json()['code']
        payload = {'code': code, 'relation': 'TEMAN', 'direction': 'OFFER_HELP'}
        dbSession.add_all([PilotInvitation(owner_id=uuid.UUID(sender_id), redeemer_id=uuid.UUID(target_id), status='DECLINED', direction='OFFER_HELP', expires_at=datetime.now(timezone.utc) + timedelta(days=7)) for _ in range(20)])
        await dbSession.commit()
        capped = await client.post('/v1/buddy-pilot/invitations/direct', headers=sender, json=payload)
        assert capped.status_code == 429 and capped.json()['detail'] == 'too many invitations today'
        await dbSession.execute(update(PilotInvitation).values(created_at=datetime.now(timezone.utc) - timedelta(days=2)))
        await dbSession.commit()
        assert (await client.post('/v1/buddy-pilot/invitations/direct', headers=sender, json=payload)).status_code == 201


@pytest.mark.asyncio
async def test_direct_invitation_expiry_order_and_readding(dbSession):
    from app.db.models import BuddyRelationship
    from app.db.models.pilot import PilotInvitation

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        sender_id, sender = await guest(client)
        _, target = await guest(client)
        _, primary = await guest(client)
        await trusted(client, sender, primary)
        code = (await client.get('/v1/buddy-pilot/me/code', headers=target)).json()['code']
        payload = {'code': code, 'relation': 'PENDAMPING', 'direction': 'SEEK_HELP'}
        first = (await client.post('/v1/buddy-pilot/invitations/direct', headers=sender, json=payload)).json()
        row = await dbSession.get(PilotInvitation, uuid.UUID(first['id']))
        row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await dbSession.commit()
        path = '/v1/buddy-pilot/invitations/' + first['id']
        assert (await client.post(path + '/accept', headers=target)).status_code == 409
        assert (await client.post(path + '/decline', headers=target)).status_code == 409
        assert (await client.get('/v1/buddy-pilot/invitations/received', headers=target)).json() == []
        assert (await client.get('/v1/buddy-pilot/invitations', headers=sender)).json()[0]['status'] == 'EXPIRED'
        fresh = (await client.post('/v1/buddy-pilot/invitations/direct', headers=sender, json=payload)).json()
        opposite = (await client.post('/v1/buddy-pilot/invitations/direct', headers=sender, json={**payload, 'direction': 'OFFER_HELP'})).json()
        assert [item['id'] for item in (await client.get('/v1/buddy-pilot/invitations/received', headers=target)).json()] == [opposite['id'], fresh['id']]
        assert (await client.post('/v1/buddy-pilot/invitations/' + fresh['id'] + '/accept', headers=target)).status_code == 200
        incoming = (await client.get('/v1/buddy-pilot/contacts/incoming', headers=target)).json()[0]
        assert incoming['level'] == 'SECONDARY' and incoming['needs'] == []
        assert (await client.delete('/v1/buddy-pilot/contacts/' + incoming['id'], headers=target)).status_code == 200
        again = (await client.post('/v1/buddy-pilot/invitations/direct', headers=sender, json={**payload, 'relation': 'LAINNYA'})).json()
        assert (await client.post('/v1/buddy-pilot/invitations/' + again['id'] + '/accept', headers=target)).status_code == 200
        restored = (await client.get('/v1/buddy-pilot/contacts/incoming', headers=target)).json()[0]
        assert restored['id'] != incoming['id'] and restored['relation'] == 'LAINNYA' and restored['level'] == 'SECONDARY'
        assert len((await dbSession.execute(select(BuddyRelationship).where(BuddyRelationship.userId == uuid.UUID(sender_id)))).scalars().all()) == 3


@pytest.mark.asyncio
async def test_legacy_invitation_needs_remain_private(dbSession):
    from app.db.models import UserAccessibility

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        owner_id, owner = await guest(client)
        helper_id, helper = await guest(client)
        dbSession.add_all([UserAccessibility(user_id=uuid.UUID(owner_id), type='VISUAL'), UserAccessibility(user_id=uuid.UUID(helper_id), type='MOBILITY')])
        await dbSession.commit()
        invitation = await trusted(client, owner, helper)
        assert invitation['direction'] == 'SEEK_HELP' and invitation['relation'] is None
        assert invitation['ownerNeeds'] == []
        owned = (await client.get('/v1/buddy-pilot/invitations', headers=owner)).json()[0]
        assert owned['ownerNeeds'] == []
        assert (await client.post('/v1/buddy-pilot/invitations/' + invitation['id'] + '/accept', headers=helper)).status_code == 404
        assert (await client.post('/v1/buddy-pilot/invitations/' + invitation['id'] + '/decline', headers=helper)).status_code == 404


@pytest.mark.asyncio
async def test_concurrent_personal_code_direct_send_and_accept(dbSession):
    import asyncio
    from app.db.models import BuddyRelationship
    from app.db.models.pilot import PilotInbox, PilotInvitation

    app = FastAPI()
    app.include_router(router)
    app.include_router(sessions)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        _, sender = await guest(client)
        _, target = await guest(client)
        codes = await asyncio.gather(client.get('/v1/buddy-pilot/me/code', headers=target), client.get('/v1/buddy-pilot/me/code', headers=target))
        assert codes[0].status_code == codes[1].status_code == 200 and codes[0].json() == codes[1].json()
        payload = {'code': codes[0].json()['code'], 'relation': 'TEMAN', 'direction': 'OFFER_HELP'}
        sent = await asyncio.gather(client.post('/v1/buddy-pilot/invitations/direct', headers=sender, json=payload), client.post('/v1/buddy-pilot/invitations/direct', headers=sender, json=payload))
        assert sorted(response.status_code for response in sent) == [201, 409]
        invitation = next(response.json() for response in sent if response.status_code == 201)
        path = '/v1/buddy-pilot/invitations/' + invitation['id'] + '/accept'
        accepted = await asyncio.gather(client.post(path, headers=target), client.post(path, headers=target))
        assert accepted[0].status_code == accepted[1].status_code == 200 and accepted[0].json() == accepted[1].json()
        assert len((await dbSession.execute(select(BuddyRelationship))).scalars().all()) == 1
        assert len((await dbSession.execute(select(PilotInvitation))).scalars().all()) == 1
        events = (await dbSession.execute(select(PilotInbox.kind))).scalars().all()
        assert sorted(events) == ['INVITATION_ACCEPTED', 'INVITATION_RECEIVED']
