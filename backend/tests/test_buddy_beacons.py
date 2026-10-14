from datetime import datetime, timedelta, timezone
import uuid

import httpx
import pytest
from sqlalchemy import select

from app.db.models import BuddyRelationship, User
from app.db.models.buddySession import BuddyAttempt, BuddyAvailability, BuddyInbox, BuddyRequest
from app.services import buddyRequestService as service
from test_buddy import api, guest


async def trusted(client, owner, helper):
    invite = (await client.post('/v1/buddy/invitations', headers=owner)).json()
    assert (await client.post('/v1/buddy/invitations/redeem', headers=helper, json={'code': invite['code']})).status_code == 200
    assert (await client.post('/v1/buddy/invitations/' + invite['id'] + '/confirm', headers=owner)).status_code == 200


def point(latitude=0, longitude=0):
    return {'latitude': latitude, 'longitude': longitude, 'accuracyM': 5, 'observedAt': datetime.now(timezone.utc).isoformat()}


async def search(client, owner, key='synthetic-beacon-request'):
    response = await client.post('/v1/buddy/requests', headers=owner, json={'sharingConsent': True, 'idempotencyKey': key})
    assert response.status_code == 201, response.text
    response = await client.post('/v1/buddy/requests/' + response.json()['id'] + '/nearby', headers=owner, json=point())
    assert response.status_code == 200, response.text
    return response.json()


async def opt_in(client, helper, latitude=20):
    response = await client.put('/v1/buddy/availability', headers=helper, json={'optedIn': True, **point(latitude)})
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_beacon_identity_is_stable_and_available_to_confirmed_contacts(dbSession):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        owner_id, owner = await guest(client)
        helper_id, helper = await guest(client)
        assert (await client.get('/v1/buddy/me/beacon')).status_code == 401
        await trusted(client, owner, helper)
        contacts = (await client.get('/v1/buddy/contacts', headers=owner)).json()
        incoming = (await client.get('/v1/buddy/contacts/incoming', headers=helper)).json()
        for headers, user_id, expected in ((owner, owner_id, incoming[0]['beaconId']), (helper, helper_id, contacts[0]['beaconId'])):
            first = (await client.get('/v1/buddy/me/beacon', headers=headers)).json()
            assert first == {'beaconId': expected}
            assert 1 <= first['beaconId'] <= 4294967295
            assert (await client.get('/v1/buddy/me/beacon', headers=headers)).json() == first
            assert (await dbSession.get(User, uuid.UUID(user_id))).beacon_id == expected
        assert contacts[0]['beaconId'] != incoming[0]['beaconId']
        assert 'latitude' not in contacts[0] and 'longitude' not in contacts[0]


@pytest.mark.asyncio
async def test_beacon_identity_retries_collision_and_accepts_full_uint32_range(dbSession, monkeypatch):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        first_id, first = await guest(client)
        _, second = await guest(client)
        (await dbSession.get(User, uuid.UUID(first_id))).beacon_id = 42
        await dbSession.commit()
        values = iter((41, 4294967294))
        monkeypatch.setattr(service.secrets, 'randbelow', lambda upper: next(values))
        assert (await client.get('/v1/buddy/me/beacon', headers=second)).json() == {'beaconId': 4294967295}
        assert (await client.get('/v1/buddy/me/beacon', headers=second)).json() == {'beaconId': 4294967295}
        assert (await client.get('/v1/buddy/me/beacon', headers=first)).json() == {'beaconId': 42}


@pytest.mark.asyncio
async def test_bluetooth_claim_adds_offer_and_acceptance_cancels_parallel_gps_offer(dbSession):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        _, owner = await guest(client)
        gps_id, gps = await guest(client)
        ble_id, ble = await guest(client)
        assert (await dbSession.execute(select(BuddyRelationship.id))).first() is None
        await opt_in(client, gps, 0)
        await opt_in(client, ble)
        availability = (await client.get('/v1/buddy/availability', headers=ble)).json()
        assert availability['optedIn'] is True and availability['enrolled'] is False
        rejected = await client.post('/v1/buddy/requests', headers=owner, json={'helperUserId': ble_id, 'sharingConsent': True, 'idempotencyKey': 'synthetic-untrusted-contact'})
        assert rejected.status_code == 409 and rejected.json()['detail'] == 'confirmed trusted contact required'
        request = await search(client, owner)
        assert request['attempts'][0]['source'] == 'GPS'
        beacon = (await client.get('/v1/buddy/me/beacon', headers=owner)).json()['beaconId']
        body = {'beaconIds': [beacon, beacon]}
        claimed = await client.post('/v1/buddy/nearby/beacons', headers=ble, json=body)
        assert claimed.status_code == 200, claimed.text
        offer = claimed.json()[0]
        assert offer['id'] == request['id']
        assert len(offer['attempts']) == 1
        attempt = offer['attempts'][0]
        assert attempt['source'] == 'BLE' and attempt['helperUserId'] == ble_id
        retry = (await client.post('/v1/buddy/nearby/beacons', headers=ble, json=body)).json()[0]
        assert retry['attempts'] == offer['attempts']
        inbox = (await dbSession.execute(select(BuddyInbox).where(BuddyInbox.request_id == uuid.UUID(request['id']), BuddyInbox.user_id == uuid.UUID(ble_id), BuddyInbox.kind == 'OFFER'))).scalars().all()
        assert len(inbox) == 1
        accepted = await client.post('/v1/buddy/requests/' + request['id'] + '/accept', headers=ble, json={'attemptId': attempt['id'], 'sharingConsent': True})
        assert accepted.status_code == 200, accepted.text
        assert accepted.json()['helperUserId'] == ble_id
        assert (await dbSession.execute(select(BuddyRelationship.id))).first() is None
        assert {item['helperUserId']: item['status'] for item in accepted.json()['attempts']} == {gps_id: 'CANCELLED', ble_id: 'ACCEPTED'}
        assert (await client.get('/v1/buddy/requests/current', headers=gps)).json() is None
        assert (await client.post('/v1/buddy/requests/' + request['id'] + '/accept', headers=gps, json={'attemptId': request['attempts'][0]['id'], 'sharingConsent': True})).status_code in (403, 409)


@pytest.mark.asyncio
@pytest.mark.parametrize('condition', ['not_opted_in', 'stale', 'occupied'])
async def test_bluetooth_claim_requires_helper_eligibility(dbSession, condition):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        _, owner = await guest(client)
        helper_id, helper = await guest(client)
        await opt_in(client, helper)
        request = await search(client, owner)
        assert request['attempts'] == []
        beacon = (await client.get('/v1/buddy/me/beacon', headers=owner)).json()['beaconId']
        availability = await dbSession.get(BuddyAvailability, uuid.UUID(helper_id))
        if condition == 'not_opted_in':
            availability.opted_in = False
        elif condition == 'stale':
            availability.observed_at = service.now() - timedelta(minutes=3)
        else:
            dbSession.add(BuddyRequest(requester_id=uuid.UUID(helper_id), status='FALLBACK_REQUIRED', buddy_flow=True))
        await dbSession.commit()
        rejected = await client.post('/v1/buddy/nearby/beacons', headers=helper, json={'beaconIds': [beacon]})
        assert rejected.status_code == 409, rejected.text
        assert (await client.get('/v1/buddy/requests/' + request['id'], headers=helper)).status_code == 403
        assert (await dbSession.execute(select(BuddyAttempt).where(BuddyAttempt.request_id == uuid.UUID(request['id'])))).first() is None


@pytest.mark.asyncio
async def test_unrelated_gps_helpers_can_decline_advance_and_accept(dbSession):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        _, owner = await guest(client)
        first_id, first = await guest(client)
        second_id, second = await guest(client)
        await opt_in(client, first, 0)
        await opt_in(client, second, 0.001)
        request = await search(client, owner)
        assert request['attempts'][0]['helperUserId'] == first_id
        path = '/v1/buddy/requests/' + request['id']
        declined = await client.post(path + '/decline', headers=first, json={'attemptId': request['attempts'][0]['id']})
        assert declined.status_code == 200, declined.text
        attempt = declined.json()['attempts'][0]
        assert attempt['helperUserId'] == first_id and attempt['status'] == 'DECLINED'
        offer = (await client.get('/v1/buddy/requests/current', headers=second)).json()
        assert offer['id'] == request['id']
        attempt = offer['attempts'][0]
        assert attempt['helperUserId'] == second_id and attempt['source'] == 'GPS'
        assert (await client.post(path + '/accept', headers=second, json={'attemptId': attempt['id']})).status_code == 409
        accepted = await client.post(path + '/accept', headers=second, json={'attemptId': attempt['id'], 'sharingConsent': True})
        assert accepted.status_code == 200, accepted.text
        assert accepted.json()['status'] == 'ACCEPTED' and accepted.json()['helperUserId'] == second_id
        assert (await dbSession.execute(select(BuddyRelationship.id))).first() is None


@pytest.mark.asyncio
@pytest.mark.parametrize('condition', ['not_opted_in', 'stale', 'occupied', 'no_consent'])
async def test_unrelated_bluetooth_helper_acceptance_requires_eligibility_and_consent(dbSession, condition):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        _, owner = await guest(client)
        helper_id, helper = await guest(client)
        await opt_in(client, helper)
        request = await search(client, owner)
        beacon = (await client.get('/v1/buddy/me/beacon', headers=owner)).json()['beaconId']
        response = await client.post('/v1/buddy/nearby/beacons', headers=helper, json={'beaconIds': [beacon]})
        assert response.status_code == 200, response.text
        offer = response.json()[0]
        availability = await dbSession.get(BuddyAvailability, uuid.UUID(helper_id))
        if condition == 'not_opted_in':
            availability.opted_in = False
        elif condition == 'stale':
            availability.observed_at = service.now() - timedelta(minutes=3)
        elif condition == 'occupied':
            dbSession.add(BuddyRequest(requester_id=uuid.UUID(helper_id), status='FALLBACK_REQUIRED', buddy_flow=True))
        await dbSession.commit()
        rejected = await client.post('/v1/buddy/requests/' + request['id'] + '/accept', headers=helper, json={'attemptId': offer['attempts'][0]['id'], 'sharingConsent': condition != 'no_consent'})
        assert rejected.status_code == 409, rejected.text
        row = await dbSession.get(BuddyRequest, uuid.UUID(request['id']))
        assert row.helper_id is None and row.status == 'WAITING'


@pytest.mark.asyncio
async def test_bluetooth_claim_skips_self_unknown_and_non_open_requests(dbSession):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        _, owner = await guest(client)
        helper_id, helper = await guest(client)
        await trusted(client, owner, helper)
        await opt_in(client, helper)
        self_beacon = (await client.get('/v1/buddy/me/beacon', headers=helper)).json()['beaconId']
        own = await search(client, helper, 'synthetic-own-request')
        assert (await client.post('/v1/buddy/nearby/beacons', headers=helper, json={'beaconIds': [self_beacon]})).json() == []
        assert (await client.post('/v1/buddy/requests/' + own['id'] + '/interrupt', headers=helper)).status_code == 200
        beacon = (await client.get('/v1/buddy/me/beacon', headers=owner)).json()['beaconId']
        fallback = (await client.post('/v1/buddy/requests', headers=owner, json={'sharingConsent': True, 'idempotencyKey': 'synthetic-fallback-request'})).json()
        assert (await client.post('/v1/buddy/nearby/beacons', headers=helper, json={'beaconIds': [beacon]})).json() == []
        assert (await client.post('/v1/buddy/requests/' + fallback['id'] + '/nearby', headers=owner, json=point())).status_code == 200
        row = await dbSession.get(BuddyRequest, uuid.UUID(fallback['id']))
        row.nearby_started_at = service.now() - timedelta(minutes=11)
        await dbSession.commit()
        assert (await client.post('/v1/buddy/nearby/beacons', headers=helper, json={'beaconIds': [beacon]})).json() == []
        row.status = 'UNANSWERED'
        row.nearby_started_at = service.now()
        await dbSession.commit()
        assert (await client.post('/v1/buddy/nearby/beacons', headers=helper, json={'beaconIds': [beacon]})).json() == []
        used = set((await dbSession.execute(select(User.beacon_id).where(User.beacon_id.is_not(None)))).scalars())
        missing = next(value for value in range(1, 11) if value not in used)
        assert (await client.post('/v1/buddy/nearby/beacons', headers=helper, json={'beaconIds': [missing]})).json() == []


@pytest.mark.asyncio
@pytest.mark.parametrize('ids', [[1] * 11, [0], [-1], [4294967296], [True], [1.5], ['12']])
async def test_bluetooth_claim_validates_uint32_ids_and_batch_size(dbSession, ids):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        _, helper = await guest(client)
        response = await client.post('/v1/buddy/nearby/beacons', headers=helper, json={'beaconIds': ids})
        assert response.status_code == 422, response.text


@pytest.mark.asyncio
async def test_requester_selects_unrelated_bluetooth_helper_once_and_helper_accepts(dbSession):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        _, owner = await guest(client)
        helper_id, helper = await guest(client)
        _, stranger = await guest(client)
        await opt_in(client, helper)
        beacon = (await client.get('/v1/buddy/me/beacon', headers=helper)).json()['beaconId']
        request = await search(client, owner)
        path = '/v1/buddy/requests/' + request['id']
        assert (await client.post(path + '/nearby/helper', json={'beaconId': beacon})).status_code == 401
        assert (await client.post(path + '/nearby/helper', headers=stranger, json={'beaconId': beacon})).status_code == 403
        selected = await client.post(path + '/nearby/helper', headers=owner, json={'beaconId': beacon})
        assert selected.status_code == 200, selected.text
        session = selected.json()
        assert session['id'] == request['id'] and session['status'] == 'WAITING' and session['helperUserId'] is None
        attempt = session['attempts'][0]
        assert attempt['helperUserId'] == helper_id and attempt['status'] == 'PENDING' and attempt['source'] == 'BLE'
        assert session['selectedAttemptId'] == attempt['id']
        retry = await client.post(path + '/nearby/helper', headers=owner, json={'beaconId': beacon})
        assert retry.status_code == 200 and retry.json()['attempts'] == session['attempts']
        assert retry.json()['selectedAttemptId'] == attempt['id']
        inbox = (await dbSession.execute(select(BuddyInbox).where(BuddyInbox.request_id == uuid.UUID(request['id']), BuddyInbox.user_id == uuid.UUID(helper_id), BuddyInbox.kind == 'OFFER'))).scalars().all()
        assert len(inbox) == 1
        assert (await client.get('/v1/buddy/requests/current', headers=helper)).json()['id'] == request['id']
        assert (await client.post(path + '/nearby/helper', headers=helper, json={'beaconId': beacon})).status_code == 403
        accepted = await client.post(path + '/accept', headers=helper, json={'attemptId': attempt['id'], 'sharingConsent': True})
        assert accepted.status_code == 200, accepted.text
        assert accepted.json()['helperUserId'] == helper_id and accepted.json()['status'] == 'ACCEPTED'
        assert (await dbSession.execute(select(BuddyRelationship.id))).first() is None


@pytest.mark.asyncio
@pytest.mark.parametrize('condition', ['self', 'unknown', 'missing_availability', 'not_opted_in', 'stale', 'occupied', 'not_nearby', 'closed', 'assigned', 'expired_request', 'no_consent'])
async def test_requester_bluetooth_helper_selection_requires_open_request_and_eligible_helper(dbSession, condition):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        owner_id, owner = await guest(client)
        helper_id, helper = await guest(client)
        await opt_in(client, helper)
        beacon = (await client.get('/v1/buddy/me/beacon', headers=helper)).json()['beaconId']
        request = await search(client, owner)
        row = await dbSession.get(BuddyRequest, uuid.UUID(request['id']))
        availability = await dbSession.get(BuddyAvailability, uuid.UUID(helper_id))
        if condition == 'self':
            beacon = (await client.get('/v1/buddy/me/beacon', headers=owner)).json()['beaconId']
        elif condition == 'unknown':
            used = set((await dbSession.execute(select(User.beacon_id).where(User.beacon_id.is_not(None)))).scalars())
            beacon = next(value for value in range(1, 11) if value not in used)
        elif condition == 'missing_availability':
            await dbSession.delete(availability)
        elif condition == 'not_opted_in':
            availability.opted_in = False
        elif condition == 'stale':
            availability.observed_at = service.now() - timedelta(minutes=2)
        elif condition == 'occupied':
            dbSession.add(BuddyRequest(requester_id=uuid.UUID(helper_id), status='FALLBACK_REQUIRED', buddy_flow=True))
        elif condition == 'not_nearby':
            row.nearby = False
        elif condition == 'closed':
            row.status = 'UNANSWERED'
        elif condition == 'assigned':
            row.helper_id = uuid.UUID(helper_id)
        elif condition == 'expired_request':
            row.nearby_started_at = service.now() - timedelta(minutes=10)
        else:
            row.sharing_consent = False
        await dbSession.commit()
        rejected = await client.post('/v1/buddy/requests/' + request['id'] + '/nearby/helper', headers=owner, json={'beaconId': beacon})
        assert rejected.status_code == 409, rejected.text
        assert (await dbSession.execute(select(BuddyAttempt).where(BuddyAttempt.request_id == uuid.UUID(request['id'])))).first() is None
        assert row.requester_id == uuid.UUID(owner_id)


@pytest.mark.asyncio
async def test_requester_bluetooth_selection_preserves_competing_gps_offer(dbSession):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        _, owner = await guest(client)
        gps_id, gps = await guest(client)
        ble_id, ble = await guest(client)
        await opt_in(client, gps, 0)
        await opt_in(client, ble)
        request = await search(client, owner)
        path = '/v1/buddy/requests/' + request['id']
        gps_beacon = (await client.get('/v1/buddy/me/beacon', headers=gps)).json()['beaconId']
        reused = await client.post(path + '/nearby/helper', headers=owner, json={'beaconId': gps_beacon})
        assert reused.status_code == 200 and reused.json()['attempts'] == request['attempts']
        assert reused.json()['selectedAttemptId'] == request['attempts'][0]['id']
        ble_beacon = (await client.get('/v1/buddy/me/beacon', headers=ble)).json()['beaconId']
        selected = await client.post(path + '/nearby/helper', headers=owner, json={'beaconId': ble_beacon})
        assert selected.status_code == 200, selected.text
        assert {item['helperUserId']: item['status'] for item in selected.json()['attempts']} == {gps_id: 'PENDING', ble_id: 'PENDING'}
        assert selected.json()['selectedAttemptId'] == next(item['id'] for item in selected.json()['attempts'] if item['helperUserId'] == ble_id)
        accepted = await client.post(path + '/accept', headers=gps, json={'attemptId': request['attempts'][0]['id'], 'sharingConsent': True})
        assert accepted.status_code == 200, accepted.text
        assert {item['helperUserId']: item['status'] for item in accepted.json()['attempts']} == {gps_id: 'ACCEPTED', ble_id: 'CANCELLED'}
        assert (await client.get('/v1/buddy/requests/current', headers=ble)).json() is None


@pytest.mark.asyncio
@pytest.mark.parametrize('condition', ['declined', 'expired'])
async def test_requester_bluetooth_helper_selection_does_not_repeat_closed_offer(dbSession, condition):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        _, owner = await guest(client)
        helper_id, helper = await guest(client)
        await opt_in(client, helper)
        beacon = (await client.get('/v1/buddy/me/beacon', headers=helper)).json()['beaconId']
        request = await search(client, owner)
        path = '/v1/buddy/requests/' + request['id']
        selected = (await client.post(path + '/nearby/helper', headers=owner, json={'beaconId': beacon})).json()
        attempt = await dbSession.get(BuddyAttempt, uuid.UUID(selected['attempts'][0]['id']))
        if condition == 'declined':
            declined = await client.post(path + '/decline', headers=helper, json={'attemptId': str(attempt.id)})
            assert declined.status_code == 200, declined.text
        else:
            attempt.expires_at = service.now() - timedelta(seconds=1)
            await dbSession.commit()
        rejected = await client.post(path + '/nearby/helper', headers=owner, json={'beaconId': beacon})
        assert rejected.status_code == 409, rejected.text
        attempts = (await dbSession.execute(select(BuddyAttempt).where(BuddyAttempt.request_id == uuid.UUID(request['id']), BuddyAttempt.helper_id == uuid.UUID(helper_id)))).scalars().all()
        assert len(attempts) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('beacon', [0, -1, 4294967296, True, 1.5, '12', None])
async def test_requester_bluetooth_helper_selection_validates_strict_uint32(dbSession, beacon):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        _, owner = await guest(client)
        request = await search(client, owner)
        response = await client.post('/v1/buddy/requests/' + request['id'] + '/nearby/helper', headers=owner, json={'beaconId': beacon})
        assert response.status_code == 422, response.text


@pytest.mark.asyncio
async def test_nearby_search_waits_ten_minutes_without_gps_candidates(dbSession, monkeypatch):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        _, owner = await guest(client)
        created = (await client.post('/v1/buddy/requests', headers=owner, json={'sharingConsent': True, 'idempotencyKey': 'synthetic-window-request'})).json()
        row = await dbSession.get(BuddyRequest, uuid.UUID(created['id']))
        row.created_at = service.now() - timedelta(hours=1)
        await dbSession.commit()
        response = await client.post('/v1/buddy/requests/' + created['id'] + '/nearby', headers=owner, json=point())
        assert response.status_code == 200, response.text
        assert response.json()['status'] == 'WAITING' and response.json()['attempts'] == []
        started = row.nearby_started_at
        monkeypatch.setattr(service, 'now', lambda: started + timedelta(minutes=9, seconds=59))
        await service.expire(dbSession)
        await dbSession.commit()
        assert row.status == 'WAITING'
        monkeypatch.setattr(service, 'now', lambda: started + timedelta(minutes=10))
        await service.expire(dbSession)
        await dbSession.commit()
        assert row.status == 'UNANSWERED'
        assert row.latitude is None and row.longitude is None and row.sharing_consent is False


@pytest.mark.asyncio
async def test_declined_bluetooth_offer_does_not_replace_parallel_pending_offer(dbSession):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        _, owner = await guest(client)
        _, gps = await guest(client)
        _, ble = await guest(client)
        await trusted(client, owner, gps)
        await trusted(client, owner, ble)
        await opt_in(client, gps, 0)
        await opt_in(client, ble)
        request = await search(client, owner)
        beacon = (await client.get('/v1/buddy/me/beacon', headers=owner)).json()['beaconId']
        body = {'beaconIds': [beacon]}
        offer = (await client.post('/v1/buddy/nearby/beacons', headers=ble, json=body)).json()[0]
        declined = await client.post('/v1/buddy/requests/' + request['id'] + '/decline', headers=ble, json={'attemptId': offer['attempts'][0]['id']})
        assert declined.status_code == 200 and declined.json()['status'] == 'WAITING'
        assert (await client.post('/v1/buddy/nearby/beacons', headers=ble, json=body)).json() == []
        pending = (await dbSession.execute(select(BuddyAttempt).where(BuddyAttempt.request_id == uuid.UUID(request['id']), BuddyAttempt.status == 'PENDING'))).scalars().all()
        assert len(pending) == 1 and str(pending[0].id) == request['attempts'][0]['id']


@pytest.mark.asyncio
async def test_nearby_window_closes_pending_offer_before_acceptance(dbSession):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        _, owner = await guest(client)
        _, helper = await guest(client)
        await trusted(client, owner, helper)
        await opt_in(client, helper)
        request = await search(client, owner)
        beacon = (await client.get('/v1/buddy/me/beacon', headers=owner)).json()['beaconId']
        offer = (await client.post('/v1/buddy/nearby/beacons', headers=helper, json={'beaconIds': [beacon]})).json()[0]
        row = await dbSession.get(BuddyRequest, uuid.UUID(request['id']))
        row.nearby_started_at = service.now() - timedelta(minutes=10)
        await dbSession.commit()
        rejected = await client.post('/v1/buddy/requests/' + request['id'] + '/accept', headers=helper, json={'attemptId': offer['attempts'][0]['id'], 'sharingConsent': True})
        assert rejected.status_code == 409 and rejected.json()['detail'] == 'nearby request expired'
        await service.expire(dbSession)
        await dbSession.commit()
        assert row.status == 'UNANSWERED'
        attempt = await dbSession.get(BuddyAttempt, uuid.UUID(offer['attempts'][0]['id']))
        assert attempt.status == 'CANCELLED'


@pytest.mark.asyncio
async def test_parallel_bluetooth_acceptance_uses_independent_database_sessions(dbSession):
    import asyncio
    from fastapi import FastAPI
    from app.routers.buddy import router
    from app.routers.sessions import router as sessions

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api(dbSession)), base_url='http://test') as client:
        _, owner = await guest(client)
        helpers = [await guest(client), await guest(client)]
        for helper_id, headers in helpers:
            await trusted(client, owner, headers)
            await opt_in(client, headers)
        request = await search(client, owner)
        beacon = (await client.get('/v1/buddy/me/beacon', headers=owner)).json()['beaconId']
        attempts = []
        for helper_id, headers in helpers:
            offer = (await client.post('/v1/buddy/nearby/beacons', headers=headers, json={'beaconIds': [beacon]})).json()[0]
            attempts.append(offer['attempts'][0]['id'])
    application = FastAPI()
    application.include_router(router, prefix='/v1/buddy')
    application.include_router(sessions)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application), base_url='http://test') as client:
        responses = await asyncio.wait_for(asyncio.gather(*[client.post('/v1/buddy/requests/' + request['id'] + '/accept', headers=headers, json={'attemptId': attempt, 'sharingConsent': True}) for (helper_id, headers), attempt in zip(helpers, attempts)]), timeout=20)
        assert sorted(response.status_code for response in responses) == [200, 403]
        final = (await client.get('/v1/buddy/requests/' + request['id'], headers=owner)).json()
        assert final['status'] == 'ACCEPTED'
        assert sorted(attempt['status'] for attempt in final['attempts']) == ['ACCEPTED', 'CANCELLED']
