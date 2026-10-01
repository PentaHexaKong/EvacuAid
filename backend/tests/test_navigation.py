from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi import FastAPI
from pydantic import ValidationError

from app.db.session import get_session
from app.models.navigation import HazardStatus, NavigationCreate, NavigationOrigin, NavigationStatus
from app.models.shelter import ShelterCreate
from app.models.user import LocationUpdate, UserCreate
from app.services import navigationService, shelterService, user_service
from app.routers.navigation import router as navigationRouter
from app.routers.sessions import router as sessionsRouter
from app.services import valhallaProvider
from app.services.valhallaProvider import NoRoute, RouteData, RoutingUnavailable, ValhallaRoutingProvider


class WorkingProvider:
    async def route(self, origin, destination):
        return RouteData(distanceM=1200, durationSec=900, geometry={'type': 'LineString', 'coordinates': [[origin[1], origin[0]], [destination[1], destination[0]] ]})


class BrokenProvider:
    async def route(self, origin, destination):
        raise RoutingUnavailable('offline')


class FakeResponse:
    status_code = 200
    is_success = True

    def json(self):
        return {'trip': {'summary': {'length': 0.1, 'time': 60}, 'legs': [{'shape': '??_ibE_ibE'}]}}


class FakeClient:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def post(self, *args, **kwargs):
        return FakeResponse()


async def shelter(dbSession, name, status='OPEN', wheelchairAccessible=None, capacity=None, currentOccupancy=None, latitude=-6.2, longitude=106.81):
    return await shelterService.createShelter(dbSession, ShelterCreate(name=name, latitude=latitude, longitude=longitude, shelterType='TEST', status=status, wheelchairAccessible=wheelchairAccessible, capacity=capacity, currentOccupancy=currentOccupancy, source='TEST_FIXTURE'))


@pytest.mark.asyncio
async def testNearbySheltersAndSuitability(dbSession):
    openShelter = await shelter(dbSession, 'Open')
    closedShelter = await shelter(dbSession, 'Closed', status='CLOSED', longitude=106.805)
    nearby = await shelterService.nearbyShelters(dbSession, -6.2, 106.8, 5000, 10)
    assert {item.id for item in nearby} == {openShelter.id, closedShelter.id}
    assert shelterService.suitabilityReasons(closedShelter, False)[0] is False
    assert shelterService.suitabilityReasons(openShelter, True)[1][-1] == 'ACCESSIBILITY_UNKNOWN'


@pytest.mark.asyncio
async def testNavigationSelectsSuitableShelterAndRoutes(dbSession, monkeypatch):
    user = await user_service.create_user(dbSession, UserCreate(name='Route User'))
    await user_service.update_location(dbSession, user.id, LocationUpdate(latitude=-6.2, longitude=106.8, observed_at=datetime.now(timezone.utc)))
    await shelter(dbSession, 'Full', status='FULL', latitude=-6.2001, longitude=106.8001)
    selected = await shelter(dbSession, 'Open', latitude=-6.201, longitude=106.801)
    async def emptyReports():
        from app.services.petabencana_service import PetaBencanaFetchResult
        return PetaBencanaFetchResult([])
    monkeypatch.setattr(navigationService, 'fetch_reports', emptyReports)
    response = await navigationService.navigationForUser(dbSession, NavigationCreate(userId=user.id), WorkingProvider())
    assert response.routeStatus == NavigationStatus.READY
    assert response.destination.shelterId == selected.id
    assert response.route.geometry['type'] == 'LineString'
    assert any(item.reasonCodes == ['SHELTER_FULL'] for item in response.rejectedCandidates)


@pytest.mark.asyncio
async def testNavigationProviderFailureIsUnavailable(dbSession):
    user = await user_service.create_user(dbSession, UserCreate(name='No Route'))
    await user_service.update_location(dbSession, user.id, LocationUpdate(latitude=-6.2, longitude=106.8, observed_at=datetime.now(timezone.utc)))
    await shelter(dbSession, 'Open')
    response = await navigationService.navigationForUser(dbSession, NavigationCreate(userId=user.id), BrokenProvider())
    assert response.routeStatus == NavigationStatus.UNAVAILABLE
    assert response.selectionReasonCodes == ['ROUTING_PROVIDER_UNAVAILABLE']


@pytest.mark.asyncio
async def testValhallaProviderDecodesEncodedRouteGeometry(monkeypatch):
    monkeypatch.setattr(valhallaProvider.httpx, 'AsyncClient', FakeClient)
    route = await ValhallaRoutingProvider().route((0, 0), (0.1, 0.1))
    assert route.geometry == {'type': 'LineString', 'coordinates': [[0.0, 0.0], [0.1, 0.1]]}
    assert route.distanceM == 100
    assert route.durationSec == 60


class EmptyLegsResponse(FakeResponse):
    def json(self):
        return {'trip': {'summary': {'length': 0.1, 'time': 60}, 'legs': []}}


class EmptyLegsClient(FakeClient):
    async def post(self, *args, **kwargs):
        return EmptyLegsResponse()


class RecordingProvider:
    def __init__(self):
        self.origins = []

    async def route(self, origin, destination):
        self.origins.append(origin)
        return RouteData(distanceM=10, durationSec=5, geometry={'type': 'LineString', 'coordinates': [[origin[1], origin[0]], [destination[1], destination[0]]]})


class BadGeometryProvider:
    async def route(self, origin, destination):
        return RouteData(distanceM=10, durationSec=5, geometry={'type': 'Point', 'coordinates': [0, 0]})


def originAt(offset):
    return NavigationOrigin(latitude=-6.2, longitude=106.8, observedAt=datetime.now(timezone.utc) - offset)


async def emptyReports():
    from app.services.petabencana_service import PetaBencanaFetchResult
    return PetaBencanaFetchResult([])


def createApi(dbSession):
    api = FastAPI()
    api.include_router(sessionsRouter)
    api.include_router(navigationRouter)

    async def getTestSession():
        yield dbSession

    api.dependency_overrides[get_session] = getTestSession
    return api


@pytest.mark.asyncio
async def testRouteEndpointRequiresOwnerSession(dbSession):
    transport = httpx.ASGITransport(app=createApi(dbSession))
    async with httpx.AsyncClient(transport=transport, base_url='http://test') as client:
        guest = (await client.post('/v1/guest-sessions')).json()
        other = (await client.post('/v1/guest-sessions')).json()
        body = {'userId': guest['user']['id']}
        assert (await client.post('/v1/navigation/routes', json=body)).status_code == 401
        assert (await client.post('/v1/navigation/routes', json=body, headers={'Authorization': 'Bearer invalid'})).status_code == 401
        assert (await client.post('/v1/navigation/routes', json=body, headers={'Authorization': f"Bearer {other['access_token']}"})).status_code == 403


def testOriginOlderThanTwoMinutesIsRejected():
    with pytest.raises(ValidationError):
        originAt(timedelta(minutes=3))
    assert originAt(timedelta(seconds=30)).latitude == -6.2


@pytest.mark.asyncio
async def testStaleOriginReturns422(dbSession):
    transport = httpx.ASGITransport(app=createApi(dbSession))
    async with httpx.AsyncClient(transport=transport, base_url='http://test') as client:
        guest = (await client.post('/v1/guest-sessions')).json()
        stale = (datetime.now(timezone.utc) - timedelta(minutes=3)).isoformat()
        response = await client.post('/v1/navigation/routes', json={'userId': guest['user']['id'], 'origin': {'latitude': -6.2, 'longitude': 106.8, 'observedAt': stale}}, headers={'Authorization': f"Bearer {guest['access_token']}"})
        assert response.status_code == 422


@pytest.mark.asyncio
async def testNavigationRoutesFromOriginWithoutPersistingLocation(dbSession, monkeypatch):
    user = await user_service.create_user(dbSession, UserCreate(name='Origin User'))
    await shelter(dbSession, 'Open', latitude=-6.201, longitude=106.801)
    monkeypatch.setattr(navigationService, 'fetch_reports', emptyReports)
    provider = RecordingProvider()
    response = await navigationService.navigationForUser(dbSession, NavigationCreate(userId=user.id, origin=originAt(timedelta(seconds=5))), provider)
    assert response.routeStatus == NavigationStatus.READY
    assert response.destination.source == 'TEST_FIXTURE'
    assert provider.origins == [(-6.2, 106.8)]
    await dbSession.refresh(user)
    assert user.latitude is None and user.longitude is None


@pytest.mark.asyncio
async def testValhallaEmptyLegsIsNoRoute(monkeypatch):
    monkeypatch.setattr(valhallaProvider.httpx, 'AsyncClient', EmptyLegsClient)
    with pytest.raises(NoRoute):
        await ValhallaRoutingProvider().route((0, 0), (0.1, 0.1))


@pytest.mark.asyncio
async def testInvalidGeometryYieldsUnknownSafety(dbSession, monkeypatch):
    user = await user_service.create_user(dbSession, UserCreate(name='Bad Geometry'))
    await shelter(dbSession, 'Open', latitude=-6.201, longitude=106.801)
    monkeypatch.setattr(navigationService, 'fetch_reports', emptyReports)
    response = await navigationService.navigationForUser(dbSession, NavigationCreate(userId=user.id, origin=originAt(timedelta(seconds=5))), BadGeometryProvider())
    assert response.evaluation.safetyStatus == HazardStatus.UNKNOWN


@pytest.mark.asyncio
async def testStaleSavedLocationIsRejected(dbSession):
    from fastapi import HTTPException
    user = await user_service.create_user(dbSession, UserCreate(name='Stale User'))
    await user_service.update_location(dbSession, user.id, LocationUpdate(latitude=-6.2, longitude=106.8, observed_at=datetime.now(timezone.utc) - timedelta(minutes=20)))
    with pytest.raises(HTTPException) as error:
        await navigationService.navigationForUser(dbSession, NavigationCreate(userId=user.id), RecordingProvider())
    assert error.value.status_code == 409
