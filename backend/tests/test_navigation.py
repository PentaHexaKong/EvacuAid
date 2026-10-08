from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from pydantic import ValidationError

from app.db.session import get_session
from app.models.navigation import NavigationCreate, NavigationOrigin, NavigationPreviewCreate, NavigationStatus
from app.models.shelter import ShelterCreate
from app.models.user import LocationUpdate, UserCreate
from app.routers.navigation import router as navigationRouter
from app.routers.sessions import router as sessionsRouter
from app.routers.users import router as usersRouter
from app.services import navigationService, shelterService, user_service
from app.services import valhallaProvider
from app.services.valhallaProvider import RouteData, RoutingUnavailable, ValhallaRoutingProvider


class WorkingProvider:
    async def route(self, origin, destination, profile='WALKING'):
        return RouteData(distanceM=1200, durationSec=900, geometry={'type': 'LineString', 'coordinates': [[origin[1], origin[0]], [destination[1], destination[0]] ]})


class BrokenProvider:
    async def route(self, origin, destination, profile='WALKING'):
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
    async def emptyReports(session):
        return []
    monkeypatch.setattr(navigationService.externalDataService, 'storedReports', emptyReports)
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


@pytest.mark.asyncio
async def testNavigationKeepsCrowdsourcedHazardsAsPotentialExposure(dbSession, monkeypatch):
    user = await user_service.create_user(dbSession, UserCreate(name='Safety Route User'))
    await user_service.update_location(dbSession, user.id, LocationUpdate(latitude=-6.2, longitude=106.8, observed_at=datetime.now(timezone.utc)))
    exposed = await shelter(dbSession, 'Exposed', latitude=-6.201, longitude=106.801)
    safer = await shelter(dbSession, 'Safer', latitude=-6.21, longitude=106.81)

    async def reports(session):
        return [{'latitude': exposed.latitude, 'longitude': exposed.longitude, 'source': 'PetaBencana'}]

    monkeypatch.setattr(navigationService.externalDataService, 'storedReports', reports)
    response = await navigationService.navigationForUser(dbSession, NavigationCreate(userId=user.id), WorkingProvider())
    assert response.routeStatus == NavigationStatus.READY
    assert response.evaluation.safetyStatus.value == 'POTENTIALLY_EXPOSED'
    assert all(item.riskClass == 'POTENTIALLY_EXPOSED' for item in response.evaluatedCandidates)


@pytest.mark.asyncio
async def testPreviewMarksScenarioHazardAndDestinationUnverified(dbSession, monkeypatch):
    async def noReports(session):
        return []

    monkeypatch.setattr(navigationService.externalDataService, 'storedReports', noReports)
    response = await navigationService.previewNavigation(dbSession, NavigationPreviewCreate(originLatitude=-6.2, originLongitude=106.8, destinationLatitude=-6.201, destinationLongitude=106.801, scenarioHazards=[{'latitude': -6.201, 'longitude': 106.801}]), WorkingProvider())
    assert response.evaluation.safetyStatus.value == 'POTENTIALLY_EXPOSED'
    assert response.route.routeScore == 0
    assert response.destinationVerificationStatus == 'UNVERIFIED'


class RecordingProvider:
    def __init__(self):
        self.origins = []
        self.profiles = []

    async def route(self, origin, destination, profile='WALKING'):
        self.origins.append(origin)
        self.profiles.append(profile)
        return RouteData(distanceM=10, durationSec=5, geometry={'type': 'LineString', 'coordinates': [[origin[1], origin[0]], [destination[1], destination[0]]]})


def originAt(offset):
    return NavigationOrigin(latitude=-6.2, longitude=106.8, observedAt=datetime.now(timezone.utc) - offset)


def createApi(dbSession):
    api = FastAPI()
    api.include_router(sessionsRouter)
    api.include_router(usersRouter)
    api.include_router(navigationRouter)

    async def getTestSession():
        yield dbSession

    api.dependency_overrides[get_session] = getTestSession
    return api


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
    selected = await shelter(dbSession, 'Open', latitude=-6.201, longitude=106.801)

    async def emptyReports(session):
        return []

    monkeypatch.setattr(navigationService.externalDataService, 'storedReports', emptyReports)
    provider = RecordingProvider()
    response = await navigationService.navigationForUser(dbSession, NavigationCreate(userId=user.id, origin=originAt(timedelta(seconds=5))), provider)
    assert response.routeStatus == NavigationStatus.READY
    assert response.destination.shelterId == selected.id
    assert provider.origins == [(-6.2, 106.8)]
    await dbSession.refresh(user)
    assert user.latitude is None and user.longitude is None


@pytest.mark.asyncio
async def testStaleSavedLocationIsRejected(dbSession):
    user = await user_service.create_user(dbSession, UserCreate(name='Stale User'))
    await user_service.update_location(dbSession, user.id, LocationUpdate(latitude=-6.2, longitude=106.8, observed_at=datetime.now(timezone.utc) - timedelta(minutes=20)))
    with pytest.raises(HTTPException) as error:
        await navigationService.navigationForUser(dbSession, NavigationCreate(userId=user.id), RecordingProvider())
    assert error.value.status_code == 409
    assert error.value.detail == 'user location is stale; update location'


class RecordingAlternativesProvider(RecordingProvider):
    async def routes(self, origin, destination, waypoints=None, maxCandidates=3, profile='WALKING'):
        first = await self.route(origin, destination, profile=profile)
        second = await self.route(origin, destination, profile=profile)
        second.geometry['coordinates'].insert(1, [(origin[1] + destination[1]) / 2, (origin[0] + destination[0]) / 2 + 0.001])
        return [first, second][:maxCandidates]


@pytest.mark.asyncio
@pytest.mark.parametrize('profile,expectedProfile', [(None, 'PEDESTRIAN'), ('WHEELCHAIR', 'WHEELCHAIR')])
@pytest.mark.parametrize('providerClass,candidateCount', [(RecordingProvider, 2), (RecordingAlternativesProvider, 4)])
async def testNavigationRequestProfileReachesEveryCandidate(dbSession, monkeypatch, profile, expectedProfile, providerClass, candidateCount):
    await shelter(dbSession, 'First', latitude=-6.201, longitude=106.801)
    await shelter(dbSession, 'Second', latitude=-6.202, longitude=106.802)

    async def emptyReports(session):
        return []

    monkeypatch.setattr(navigationService.externalDataService, 'storedReports', emptyReports)
    provider = providerClass()
    monkeypatch.setattr(navigationService, 'ValhallaRoutingProvider', lambda: provider)
    transport = httpx.ASGITransport(app=createApi(dbSession))
    async with httpx.AsyncClient(transport=transport, base_url='http://test') as client:
        guest = (await client.post('/v1/guest-sessions')).json()
        payload = {'userId': guest['user']['id'], 'origin': {'latitude': -6.2, 'longitude': 106.8, 'observedAt': datetime.now(timezone.utc).isoformat()}}
        if profile is not None:
            payload['profile'] = profile
        response = await client.post('/v1/navigation/routes', json=payload, headers={'Authorization': f"Bearer {guest['access_token']}"})
    assert response.status_code == 200
    body = response.json()
    assert body['routeStatus'] == 'READY'
    assert body['route']['profile'] == expectedProfile
    assert len(body['evaluatedCandidates']) == candidateCount
    assert provider.profiles == [profile or 'WALKING'] * candidateCount


@pytest.mark.asyncio
@pytest.mark.parametrize('providerClass,candidateCount', [(RecordingProvider, 2), (RecordingAlternativesProvider, 4)])
async def testSavedMobilityNeedUsesWheelchairProfileForEveryCandidate(dbSession, monkeypatch, providerClass, candidateCount):
    await shelter(dbSession, 'First', wheelchairAccessible=True, latitude=-6.201, longitude=106.801)
    await shelter(dbSession, 'Second', wheelchairAccessible=True, latitude=-6.202, longitude=106.802)

    async def emptyReports(session):
        return []

    monkeypatch.setattr(navigationService.externalDataService, 'storedReports', emptyReports)
    provider = providerClass()
    monkeypatch.setattr(navigationService, 'ValhallaRoutingProvider', lambda: provider)
    transport = httpx.ASGITransport(app=createApi(dbSession))
    async with httpx.AsyncClient(transport=transport, base_url='http://test') as client:
        guest = (await client.post('/v1/guest-sessions')).json()
        headers = {'Authorization': f"Bearer {guest['access_token']}"}
        saved = await client.patch(f"/v1/users/{guest['user']['id']}", json={'accessibility': [{'type': 'MOBILITY_LIMITATION'}]}, headers=headers)
        assert saved.status_code == 200
        response = await client.post('/v1/navigation/routes', json={'userId': guest['user']['id'], 'origin': {'latitude': -6.2, 'longitude': 106.8, 'observedAt': datetime.now(timezone.utc).isoformat()}}, headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body['routeStatus'] == 'READY'
    assert body['route']['profile'] == 'WHEELCHAIR'
    assert len(body['evaluatedCandidates']) == candidateCount
    assert provider.profiles == ['WHEELCHAIR'] * candidateCount


@pytest.mark.asyncio
async def testExplicitWheelchairProfileRejectsInaccessibleShelterWithoutSavedNeed(dbSession, monkeypatch):
    inaccessible = await shelter(dbSession, 'Inaccessible', wheelchairAccessible=False, latitude=-6.201, longitude=106.801)
    accessible = await shelter(dbSession, 'Accessible', wheelchairAccessible=True, latitude=-6.202, longitude=106.802)

    async def emptyReports(session):
        return []

    monkeypatch.setattr(navigationService.externalDataService, 'storedReports', emptyReports)
    provider = RecordingProvider()
    monkeypatch.setattr(navigationService, 'ValhallaRoutingProvider', lambda: provider)
    transport = httpx.ASGITransport(app=createApi(dbSession))
    async with httpx.AsyncClient(transport=transport, base_url='http://test') as client:
        guest = (await client.post('/v1/guest-sessions')).json()
        headers = {'Authorization': f"Bearer {guest['access_token']}"}
        needs = await client.get(f"/v1/users/{guest['user']['id']}/accessibility", headers=headers)
        assert needs.status_code == 200 and needs.json() == []
        response = await client.post('/v1/navigation/routes', json={'userId': guest['user']['id'], 'profile': 'WHEELCHAIR', 'origin': {'latitude': -6.2, 'longitude': 106.8, 'observedAt': datetime.now(timezone.utc).isoformat()}}, headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body['routeStatus'] == 'READY'
    assert body['destination']['shelterId'] == str(accessible.id)
    assert body['rejectedCandidates'] == [{'shelterId': str(inaccessible.id), 'reasonCodes': ['WHEELCHAIR_INACCESSIBLE']}]
    assert body['route']['profile'] == 'WHEELCHAIR'
    assert provider.profiles == ['WHEELCHAIR']


@pytest.mark.asyncio
async def testNavigationInvalidProfileReturns422(dbSession):
    transport = httpx.ASGITransport(app=createApi(dbSession))
    async with httpx.AsyncClient(transport=transport, base_url='http://test') as client:
        guest = (await client.post('/v1/guest-sessions')).json()
        response = await client.post('/v1/navigation/routes', json={'userId': guest['user']['id'], 'profile': 'CAR'}, headers={'Authorization': f"Bearer {guest['access_token']}"})
    assert response.status_code == 422
    assert any(error['loc'] == ['body', 'profile'] and error['type'] == 'literal_error' for error in response.json()['detail'])


@pytest.mark.asyncio
@pytest.mark.parametrize('useAlternatives', [False, True])
async def testWheelchairProfileReachesEveryDetourCall(monkeypatch, useAlternatives):
    from app.services import routeCandidateService
    from tests.test_hazards import SyntheticRoutingProvider, syntheticEvidence

    provider = RecordingProvider()
    if useAlternatives:
        synthetic = SyntheticRoutingProvider()
        async def routes(origin, destination, waypoints=None, maxCandidates=3, profile='WALKING'):
            provider.profiles.append(profile)
            return await synthetic.routes(origin, destination, waypoints=waypoints, maxCandidates=maxCandidates)
        provider.routes = routes
    waypoints = [[(0.002, 0.003), (0.002, 0.007)]]
    monkeypatch.setattr(routeCandidateService, 'detourWaypoints', lambda *args: waypoints)
    candidates = await routeCandidateService.evaluatedCandidates(provider, (0, 0), (0, 0.01), [syntheticEvidence()], False, 'TEST', profile='WHEELCHAIR')
    assert not candidates[0].feasible
    assert any(item.feasible and 'HAZARD_DETOUR_GENERATED' in item.reasons for item in candidates)
    assert provider.profiles == ['WHEELCHAIR'] * (2 if useAlternatives else 4)


def test_maneuvers_carry_up_to_two_street_names():
    from app.services.valhallaProvider import parseManeuvers

    step = {'instruction': 'Turn right.', 'begin_shape_index': 0, 'end_shape_index': 1, 'length': 0.1, 'time': 60, 'type': 10}
    named, unnamed = parseManeuvers({'maneuvers': [{**step, 'street_names': ['Jalan Melati', 'Jalan Mawar', 'Jalan Anggrek']}, step]}, 2)
    assert named['streetNames'] == ['Jalan Melati', 'Jalan Mawar']
    assert unnamed['streetNames'] == []
