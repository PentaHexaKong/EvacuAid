from datetime import datetime, timezone
import uuid

import httpx
import pytest
from sqlalchemy import select

from app.db.models.pilot import PilotAttempt
from app.routers.pilot_dev import router as dev_router
from tests.test_pilot import api, guest


def dev_api(db, enabled):
    app = api(db)
    if enabled:
        app.include_router(dev_router)
    return app


async def opt_in(client, helper):
    point = {'optedIn': True, 'latitude': -6.2, 'longitude': 106.8, 'accuracyM': 5, 'observedAt': datetime.now(timezone.utc).isoformat()}
    assert (await client.put('/v1/buddy-pilot/availability', headers=helper, json=point)).status_code == 200


@pytest.mark.asyncio
async def test_simulate_nearby_absent_without_flag(dbSession):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=dev_api(dbSession, False)), base_url='http://test') as client:
        _, helper = await guest(client)
        assert (await client.post('/v1/buddy-pilot/dev/simulate-nearby', headers=helper)).status_code == 404


@pytest.mark.asyncio
async def test_simulate_nearby_offers_to_opted_in_helper(dbSession):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=dev_api(dbSession, True)), base_url='http://test') as client:
        helper_id, helper = await guest(client)
        await opt_in(client, helper)
        response = await client.post('/v1/buddy-pilot/dev/simulate-nearby', headers=helper)
        assert response.status_code == 201, response.text
        session = response.json()
        assert session['requesterName'] == 'Nina Rahma' and session['supportNeeds'] == ['VISUAL_IMPAIRMENT'] and session['nearby'] is True
        attempts = (await dbSession.execute(select(PilotAttempt).where(PilotAttempt.request_id == uuid.UUID(session['id']), PilotAttempt.helper_id == uuid.UUID(helper_id)))).scalars().all()
        statuses = [a.status for a in attempts]
        await dbSession.rollback()
        assert statuses == ['PENDING']


@pytest.mark.asyncio
async def test_simulate_nearby_requires_opt_in(dbSession):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=dev_api(dbSession, True)), base_url='http://test') as client:
        _, helper = await guest(client)
        response = await client.post('/v1/buddy-pilot/dev/simulate-nearby', headers=helper)
        assert response.status_code == 409 and response.json()['detail'] == 'opt in to Nearby first'
