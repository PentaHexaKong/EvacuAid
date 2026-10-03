import httpx
import pytest
from datetime import datetime, timezone
from fastapi import FastAPI

from app.db.session import get_session
from app.routers.assistance import router as assistance_router
from app.routers.buddies import router as buddies_router
from app.routers.sessions import router as sessions_router
from app.routers.users import router as users_router


def createApi(dbSession):
    api = FastAPI()
    api.include_router(sessions_router)
    api.include_router(users_router)
    api.include_router(buddies_router)
    api.include_router(assistance_router)

    async def getTestSession():
        yield dbSession

    api.dependency_overrides[get_session] = getTestSession
    return api


@pytest.mark.asyncio
async def testGuestProfileRequiresPrivateTokenAndSupportsProfileLocationAndDeletion(dbSession):
    api = createApi(dbSession)
    transport = httpx.ASGITransport(app=api)
    async with httpx.AsyncClient(transport=transport, base_url='http://test') as client:
        created = await client.post('/v1/guest-sessions')
        assert created.status_code == 201
        guest = created.json()
        assert len(guest['access_token']) > 40
        assert guest['user']['name'] is None
        user_id = guest['user']['id']
        token = guest['access_token']

        assert (await client.get('/v1/me')).status_code == 401
        headers = {'Authorization': f'Bearer {token}'}
        assert (await client.get('/v1/me', headers={'Authorization': 'Bearer invalid'})).status_code == 401
        assert (await client.get(f'/v1/users/{user_id}', headers=headers)).status_code == 200

        other = await client.post('/v1/guest-sessions')
        assert (await client.get(f"/v1/users/{other.json()['user']['id']}", headers=headers)).status_code == 403

        updated = await client.patch(f'/v1/users/{user_id}', headers=headers, json={
            'name': '  Dwi  ', 'phone': '08123', 'needs_assistance': True,
            'accessibility': [{'type': 'MOBILITY_LIMITATION'}],
        })
        assert updated.status_code == 200
        assert updated.json()['name'] == 'Dwi'
        assert updated.json()['phone'] == '08123'
        assert updated.json()['needs_assistance'] is True
        accessibility = await client.get(f'/v1/users/{user_id}/accessibility', headers=headers)
        assert accessibility.json() == [{'type': 'MOBILITY_LIMITATION', 'severity': None}]

        location = await client.put(f'/v1/users/{user_id}/location', headers=headers, json={
            'latitude': -6.2, 'longitude': 106.8, 'accuracy_m': 18.5,
            'observed_at': datetime.now(timezone.utc).isoformat(),
        })
        assert location.status_code == 200
        assert location.json()['location_observed_at'] is not None
        assert location.json()['location_accuracy_m'] == 18.5
        removed = await client.delete(f'/v1/users/{user_id}/location', headers=headers)
        assert removed.status_code == 200
        assert removed.json()['latitude'] is None
        assert removed.json()['share_location_with_buddies'] is False

        assert (await client.delete('/v1/guest-sessions/current', headers=headers)).status_code == 204
        assert (await client.get('/v1/me', headers=headers)).status_code == 401


@pytest.mark.asyncio
async def testAssistanceOwnerComesFromTokenNotRequestBody(dbSession):
    api = createApi(dbSession)
    transport = httpx.ASGITransport(app=api)
    async with httpx.AsyncClient(transport=transport, base_url='http://test') as client:
        first = (await client.post('/v1/guest-sessions')).json()
        second = (await client.post('/v1/guest-sessions')).json()
        first_headers = {'Authorization': f"Bearer {first['access_token']}"}
        second_headers = {'Authorization': f"Bearer {second['access_token']}"}
        created = await client.post('/v1/assistance/requests', headers=first_headers, json={
            'userId': second['user']['id'], 'eventId': 'test-event',
        })
        assert created.status_code == 201
        assert created.json()['userId'] == first['user']['id']
        request_id = created.json()['id']
        assert (await client.get(f'/v1/assistance/requests/{request_id}')).status_code == 401
        assert (await client.get(f'/v1/assistance/requests/{request_id}', headers=second_headers)).status_code == 403
