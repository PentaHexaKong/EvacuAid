import httpx
import pytest
from fastapi import FastAPI

from app.db.session import get_session
from app.routers.users import router


@pytest.mark.asyncio
async def testUserProfileApi(dbSession):
    api = FastAPI()
    api.include_router(router)

    async def getTestSession():
        yield dbSession

    api.dependency_overrides[get_session] = getTestSession
    transport = httpx.ASGITransport(app=api)
    async with httpx.AsyncClient(transport=transport, base_url='http://test') as client:
        created = await client.post('/v1/users', json={'name': 'Dewi', 'latitude': -6.2, 'longitude': 106.8})
        assert created.status_code == 201
        userId = created.json()['id']
        updated = await client.patch(f'/v1/users/{userId}', json={'needs_assistance': True})
        accessibility = await client.put(f'/v1/users/{userId}/accessibility', json={'items': [{'type': 'VISUAL_IMPAIRMENT'}, {'type': 'HEARING_IMPAIRMENT'}]})
        preferences = await client.put(f'/v1/users/{userId}/preferences', json={'voice_enabled': False, 'language': 'en'})
    assert updated.json()['needs_assistance'] is True
    assert len(accessibility.json()) == 2
    assert preferences.json()['voice_enabled'] is False
