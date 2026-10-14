from datetime import datetime, timezone
import uuid

import httpx
import pytest
from sqlalchemy import select

from app.db.models.buddySession import BuddyAttempt
from app.routers.buddy_dev import router as dev_router
from app.services.valhallaProvider import RoutingUnavailable, ValhallaRoutingProvider
from tests.test_buddy import api, guest


def dev_api(db, enabled):
    app = api(db)
    if enabled:
        app.include_router(dev_router, prefix='/v1/buddy')
    return app


async def opt_in(client, helper):
    point = {'optedIn': True, 'latitude': -6.2, 'longitude': 106.8, 'accuracyM': 5, 'observedAt': datetime.now(timezone.utc).isoformat()}
    assert (await client.put('/v1/buddy/availability', headers=helper, json=point)).status_code == 200


@pytest.mark.asyncio
async def test_simulate_nearby_absent_without_flag(dbSession):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=dev_api(dbSession, False)), base_url='http://test') as client:
        _, helper = await guest(client)
        assert (await client.post('/v1/buddy/dev/simulate-nearby', headers=helper)).status_code == 404


@pytest.mark.asyncio
async def test_simulate_nearby_offers_to_opted_in_helper(dbSession):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=dev_api(dbSession, True)), base_url='http://test') as client:
        helper_id, helper = await guest(client)
        await opt_in(client, helper)
        assert (await client.get('/v1/buddy/availability', headers=helper)).json()['enrolled'] is False
        response = await client.post('/v1/buddy/dev/simulate-nearby', headers=helper)
        assert response.status_code == 201, response.text
        session = response.json()
        assert session['requesterName'] == 'Nina Rahma' and session['supportNeeds'] == ['VISUAL_IMPAIRMENT'] and session['nearby'] is True
        attempts = (await dbSession.execute(select(BuddyAttempt).where(BuddyAttempt.request_id == uuid.UUID(session['id']), BuddyAttempt.helper_id == uuid.UUID(helper_id)))).scalars().all()
        statuses = [a.status for a in attempts]
        await dbSession.rollback()
        assert statuses == ['PENDING']
        accepted = await client.post('/v1/buddy/requests/' + session['id'] + '/accept', headers=helper, json={'attemptId': session['attempts'][0]['id'], 'sharingConsent': True})
        assert accepted.status_code == 200, accepted.text
        assert accepted.json()['helperUserId'] == helper_id and accepted.json()['status'] == 'ACCEPTED'


@pytest.mark.asyncio
async def test_simulate_nearby_requires_opt_in(dbSession):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=dev_api(dbSession, True)), base_url='http://test') as client:
        _, helper = await guest(client)
        response = await client.post('/v1/buddy/dev/simulate-nearby', headers=helper)
        assert response.status_code == 409 and response.json()['detail'] == 'opt in to Nearby first'


@pytest.mark.asyncio
async def test_simulate_safe_completes_the_session_after_the_walk(dbSession, monkeypatch):
    async def offline(*args, **kwargs):
        raise RoutingUnavailable('offline')
    monkeypatch.setattr(ValhallaRoutingProvider, 'route', offline)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=dev_api(dbSession, True)), base_url='http://test') as client:
        _, helper = await guest(client)
        await opt_in(client, helper)
        session = (await client.post('/v1/buddy/dev/simulate-nearby', headers=helper)).json()
        path = '/v1/buddy/dev/requests/' + session['id']
        assert (await client.post(path + '/simulate-safe', headers=helper)).status_code == 403
        await client.post('/v1/buddy/requests/' + session['id'] + '/accept', headers=helper, json={'attemptId': session['attempts'][0]['id'], 'sharingConsent': True})
        assert (await client.post(path + '/simulate-safe', headers=helper)).status_code == 409
        arrived = await client.post(path + '/simulate-walk', headers=helper, json={'progress': 1})
        assert arrived.status_code == 200, arrived.text
        assert arrived.json()['status'] == 'COMPLETION_PENDING' and arrived.json()['meetingConfirmed'] is True
        safe = await client.post(path + '/simulate-safe', headers=helper)
        assert safe.status_code == 200 and safe.json()['status'] == 'COMPLETED'
        assert (await client.post(path + '/simulate-walk', headers=helper, json={'progress': 1})).status_code == 409


@pytest.mark.asyncio
async def test_simulate_walk_moves_both_people_to_the_safe_house(dbSession, monkeypatch):
    async def offline(*args, **kwargs):
        raise RoutingUnavailable('offline')
    monkeypatch.setattr(ValhallaRoutingProvider, 'route', offline)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=dev_api(dbSession, True)), base_url='http://test') as client:
        _, helper = await guest(client)
        await opt_in(client, helper)
        session = (await client.post('/v1/buddy/dev/simulate-nearby', headers=helper)).json()
        path = '/v1/buddy/dev/requests/' + session['id'] + '/simulate-walk'
        assert (await client.post(path, headers=helper, json={'progress': 0})).status_code == 403
        await client.post('/v1/buddy/requests/' + session['id'] + '/accept', headers=helper, json={'attemptId': session['attempts'][0]['id'], 'sharingConsent': True})
        half = await client.post(path, headers=helper, json={'progress': 0.5})
        assert half.status_code == 200, half.text
        walk = half.json()['walk']
        assert half.json()['status'] == 'EVACUATING' and half.json()['meetingConfirmed'] is True
        assert 295 <= walk['distanceM'] <= 305
        positions = (await client.get('/v1/buddy/requests/' + session['id'] + '/location', headers=helper)).json()['locations']
        assert len(positions) == 2 and all(abs(item['latitude'] - walk['latitude']) < 1e-9 for item in positions)
        done = await client.post(path, headers=helper, json={'progress': 1, **walk['origin']})
        assert done.json()['walk']['geometry'] == walk['geometry']
        assert done.json()['status'] == 'COMPLETION_PENDING'
        assert done.json()['walk']['longitude'] == done.json()['walk']['destination']['longitude']
        assert (await client.post(path, headers=helper, json={'progress': 1})).status_code == 409
        assert (await client.post(path, headers=helper, json={'progress': 2})).status_code == 422
