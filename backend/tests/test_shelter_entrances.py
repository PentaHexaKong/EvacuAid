import asyncio
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.db.session import get_session
from app.models.navigation import NavigationCreate, NavigationOrigin
from app.models.shelter import ShelterCreate
from app.models.user import UserCreate
from app.repositories import shelterRepository
from app.routers.shelters import router as sheltersRouter
from app.services import navigationService, buddyNavigation, shelterService, user_service
from tests.test_buddy_navigation import sessionFixture, routeWithManeuvers


ENTRANCE = {'entranceLatitude': 0.00005, 'entranceLongitude': 0.01, 'entranceNote': 'North gate, ramp on the left'}


def shelterPayload(**values):
    return ShelterCreate(name='SYNTHETIC_TEST_ENTRANCE', latitude=0, longitude=0.01, shelterType='TEST', status='OPEN', source='SYNTHETIC_TEST', **values)


COMMAND_KEY = {'X-Command-Key': 'test-command-key'}


def createApi(db, dashboard=False):
    api = FastAPI()
    api.include_router(sheltersRouter)
    if dashboard:
        api.include_router(pytest.importorskip('command.safeHouses').router)

    @api.post('/test/shelters', status_code=201)
    async def create(payload: ShelterCreate):
        return shelterService.shelterResponse(await shelterService.createShelter(db, payload))

    async def session():
        yield db

    api.dependency_overrides[get_session] = session
    return api


@pytest.mark.asyncio
@pytest.mark.parametrize('entrance', [{}, ENTRANCE])
async def testCreateAndNearbyIncludeEntrance(dbSession, entrance):
    transport = httpx.ASGITransport(app=createApi(dbSession))
    async with httpx.AsyncClient(transport=transport, base_url='http://test') as client:
        payload = shelterPayload(**entrance).model_dump(mode='json')
        if entrance:
            payload['entranceNote'] = '  North gate, ramp on the left  '
        created = await client.post('/test/shelters', json=payload)
        assert created.status_code == 201
        nearby = await client.get('/v1/shelters/nearby', params={'latitude': 0, 'longitude': 0})
        assert nearby.status_code == 200
        for body in (created.json(), nearby.json()[0]):
            for key in ENTRANCE:
                assert body[key] == entrance.get(key)
        stored = await shelterRepository.getShelter(dbSession, created.json()['id'])
        assert stored.entranceLatitude == entrance.get('entranceLatitude')
        assert stored.entranceLongitude == entrance.get('entranceLongitude')
        assert stored.entranceNote == entrance.get('entranceNote')


@pytest.mark.asyncio
@pytest.mark.parametrize('path', ['/test/shelters', '/v1/command/safe-houses'])
@pytest.mark.parametrize('invalid', [
    {'entranceLatitude': 0},
    {'entranceLongitude': 0},
    {'entranceLatitude': 91, 'entranceLongitude': 0},
    {'entranceLatitude': 0, 'entranceLongitude': -181},
    {'entranceNote': 'x' * 201},
    {'entranceNote': 'North gate\nRamp'},
    {'entranceNote': 'North gate\rRamp'},
])
async def testInvalidEntranceReturns422(dbSession, path, invalid, monkeypatch):
    monkeypatch.setenv('COMMAND_API_KEY', 'test-command-key')
    payload = shelterPayload().model_dump(mode='json')
    if path.endswith('safe-houses'):
        payload = {'id': '00000000-0000-4000-8000-000000000007', 'name': 'SYNTHETIC_TEST_ENTRANCE', 'latitude': 0, 'longitude': 0.01}
    payload.update(invalid)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=createApi(dbSession, dashboard=path.endswith('safe-houses'))), base_url='http://test', headers=COMMAND_KEY) as client:
        assert (await client.post(path, json=payload)).status_code == 422


@pytest.mark.asyncio
async def testDashboardPassesEntranceThrough(dbSession, monkeypatch):
    monkeypatch.setenv('COMMAND_API_KEY', 'test-command-key')
    payload = {'id': '00000000-0000-4000-8000-000000000007', 'name': 'SYNTHETIC_TEST_ENTRANCE', 'latitude': 0, 'longitude': 0.01, **ENTRANCE}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=createApi(dbSession, dashboard=True)), base_url='http://test', headers=COMMAND_KEY) as client:
        response = await client.post('/v1/command/safe-houses', json=payload)
        assert response.status_code == 201
        for key, value in ENTRANCE.items():
            assert response.json()[key] == value
        assert (await client.post('/v1/command/safe-houses', json=payload)).status_code == 201


class RecordingProvider:
    def __init__(self):
        self.destinations = []

    async def route(self, origin, destination, profile='WALKING'):
        self.destinations.append(destination)
        return routeWithManeuvers([[origin[1], origin[0]], [destination[1], destination[0]]])


async def noEvidence(*args, **kwargs):
    return []


@pytest.mark.asyncio
@pytest.mark.parametrize('entrance', [{}, ENTRANCE])
@pytest.mark.parametrize('pilot', [False, True])
async def testRoutingUsesEntranceOrCentre(dbSession, monkeypatch, entrance, pilot):
    provider = RecordingProvider()
    monkeypatch.setattr(navigationService, 'routeEvidence', noEvidence)
    monkeypatch.setattr(navigationService.hazardRepository, 'activeEvidence', noEvidence)
    checked = []

    def excluded(latitude, longitude, evidence):
        checked.append((latitude, longitude))
        return False

    monkeypatch.setattr(navigationService, 'destinationExcluded', excluded)
    if pilot:
        request, actor, payload = await sessionFixture(dbSession, 'TO_SHELTER')
        shelter = (await shelterRepository.nearbyShelters(dbSession, 0, 0, 10000, 1))[0][0]
        for key, value in entrance.items():
            setattr(shelter, key, value)
        await dbSession.commit()
        monkeypatch.setattr(buddyNavigation, 'ValhallaRoutingProvider', lambda: provider)
        response = await buddyNavigation.session_route(dbSession, request, actor, payload)
    else:
        shelter = await shelterService.createShelter(dbSession, shelterPayload(**entrance))
        user = await user_service.create_user(dbSession, UserCreate(name='SYNTHETIC_TEST_USER'))
        payload = NavigationCreate(userId=user.id, destinationShelterId=shelter.id, origin=NavigationOrigin(latitude=0, longitude=0, observedAt=datetime.now(timezone.utc)))
        response = (await navigationService.navigationForUser(dbSession, payload, provider)).model_dump()
    assert response['routeStatus'] == 'READY'
    destination = (entrance['entranceLatitude'], entrance['entranceLongitude']) if entrance else (0, 0.01)
    assert provider.destinations == [destination]
    assert checked == [(0, 0.01)]
    for key in ENTRANCE:
        assert response['destination'][key] == entrance.get(key)
    assert response['route']['geometry']['coordinates'][-1] == [destination[1], destination[0]]
    assert response['route']['distanceM'] > 0
    assert response['route']['durationSec'] == 100


@pytest.mark.asyncio
@pytest.mark.parametrize('values', [{'entranceLatitude': 0}, {'entranceLatitude': 91, 'entranceLongitude': 0}, {'entranceLatitude': 0, 'entranceLongitude': 181}])
async def testDatabaseEntranceConstraints(dbSession, values):
    shelter = await shelterService.createShelter(dbSession, shelterPayload())
    for key, value in values.items():
        setattr(shelter, key, value)
    with pytest.raises(IntegrityError):
        await dbSession.commit()
    await dbSession.rollback()


@pytest.mark.asyncio
async def testEntranceMigrationRoundTrip(dbSession):
    combined = Path('/testocando/alembic.ini')
    if not combined.exists():
        combined = Path(__file__).parents[2] / 'testocando' / 'alembic.ini'
    if not combined.exists():
        pytest.skip('command migrations are not mounted next to the backend')
    assert os.environ['DATABASE_URL'].endswith('_test')
    shelter = await shelterService.createShelter(dbSession, shelterPayload(**ENTRANCE))
    shelterId = shelter.id
    await dbSession.commit()

    async def migrate(target):
        result = await asyncio.to_thread(subprocess.run, [sys.executable, '-m', 'alembic', '-c', str(combined), target[0], target[1]], capture_output=True, text=True)
        assert result.returncode == 0, result.stdout + result.stderr

    try:
        await migrate(('downgrade', '20261009_10'))
        columns = (await dbSession.execute(text("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'shelters' AND column_name LIKE 'entrance_%'"))).scalars().all()
        assert columns == []
        assert (await dbSession.execute(text('SELECT name FROM shelters WHERE id = :id'), {'id': shelterId})).scalar_one() == 'SYNTHETIC_TEST_ENTRANCE'
    finally:
        await dbSession.commit()
        await migrate(('upgrade', 'head'))
    dbSession.expire_all()
    stored = await shelterRepository.getShelter(dbSession, shelterId)
    assert stored.entranceLatitude is None and stored.entranceLongitude is None and stored.entranceNote is None
    await dbSession.commit()
    created = await shelterService.createShelter(dbSession, shelterPayload(**ENTRANCE))
    assert created.entranceNote == ENTRANCE['entranceNote']
