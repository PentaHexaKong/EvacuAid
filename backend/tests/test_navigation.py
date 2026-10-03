import pytest

from app.models.navigation import NavigationCreate, NavigationPreviewCreate, NavigationStatus
from app.models.shelter import ShelterCreate
from app.models.user import LocationUpdate, UserCreate
from app.services import navigationService, shelterService, user_service
from app.services import valhallaProvider
from app.services.valhallaProvider import RouteData, RoutingUnavailable, ValhallaRoutingProvider


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
    await user_service.update_location(dbSession, user.id, LocationUpdate(latitude=-6.2, longitude=106.8))
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
    await user_service.update_location(dbSession, user.id, LocationUpdate(latitude=-6.2, longitude=106.8))
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
    await user_service.update_location(dbSession, user.id, LocationUpdate(latitude=-6.2, longitude=106.8))
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
