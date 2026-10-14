from datetime import datetime, timezone
import uuid

import httpx
import pytest
from sqlalchemy import select

from app.db.models.buddySession import BuddyAttempt
from app.routers.buddy_dev import router as dev_router
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
