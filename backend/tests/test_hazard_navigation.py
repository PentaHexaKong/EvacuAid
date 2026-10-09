from datetime import datetime, timezone

import pytest

from app.models.navigation import NavigationCreate, NavigationPreviewCreate, NavigationStatus
from app.models.shelter import ShelterCreate
from app.models.user import LocationUpdate, UserCreate
from app.repositories import hazardRepository
from app.services import navigationService, shelterService, user_service
from app.services.valhallaProvider import RouteData
from tests.test_hazards import SyntheticRoutingProvider, syntheticEvidence, syntheticRoute


async def noReports(session):
    return []


@pytest.mark.asyncio
async def testPreviewPersistedHazardCanGenerateFeasibleDetour(dbSession, monkeypatch):
    await hazardRepository.saveEvidence(dbSession, [syntheticEvidence()])
    await dbSession.commit()
    monkeypatch.setattr(navigationService.externalDataService, 'storedReports', noReports)
    provider = SyntheticRoutingProvider()
    response = await navigationService.previewNavigation(dbSession, NavigationPreviewCreate(originLatitude=0, originLongitude=0, destinationLatitude=0, destinationLongitude=0.01), provider)
    assert response.routeStatus == NavigationStatus.READY
    assert provider.attempts > 0
    assert 'HAZARD_DETOUR_GENERATED' in response.evaluation.reasonCodes
    assert any(not item.feasible for item in response.evaluatedCandidates)
    assert response.route.durationSec > 100


@pytest.mark.asyncio
async def testPreviewNoDetourReturnsNoFeasibleRouteAndNoHazardousRecommendation(dbSession, monkeypatch):
    await hazardRepository.saveEvidence(dbSession, [syntheticEvidence()])
    await dbSession.commit()
    monkeypatch.setattr(navigationService.externalDataService, 'storedReports', noReports)
    response = await navigationService.previewNavigation(dbSession, NavigationPreviewCreate(originLatitude=0, originLongitude=0, destinationLatitude=0, destinationLongitude=0.01), SyntheticRoutingProvider(False))
    assert response.routeStatus == NavigationStatus.UNAVAILABLE
    assert 'NO_FEASIBLE_ROUTE' in response.selectionReasonCodes
    assert response.route is None
    assert all(not item.feasible for item in response.evaluatedCandidates)


@pytest.mark.asyncio
async def testShelterInsideCriticalZoneRejectedAndFartherFeasibleShelterSelected(dbSession, monkeypatch):
    user = await user_service.create_user(dbSession, UserCreate(name='SYNTHETIC_TEST_USER'))
    await user_service.update_location(dbSession, user.id, LocationUpdate(latitude=0, longitude=0, observed_at=datetime.now(timezone.utc)))
    unsafe = await shelterService.createShelter(dbSession, ShelterCreate(name='SYNTHETIC_TEST_UNSAFE', latitude=0, longitude=0.005, shelterType='TEST', status='OPEN', source='SYNTHETIC_TEST'))
    safe = await shelterService.createShelter(dbSession, ShelterCreate(name='SYNTHETIC_TEST_SAFE', latitude=0.01, longitude=0, shelterType='TEST', status='OPEN', source='SYNTHETIC_TEST'))
    await hazardRepository.saveEvidence(dbSession, [syntheticEvidence()])
    await dbSession.commit()
    monkeypatch.setattr(navigationService.externalDataService, 'storedReports', noReports)
    class Provider:
        async def route(self, origin, destination, profile='WALKING'):
            return syntheticRoute([[origin[1], origin[0]], [destination[1], destination[0]]])
    response = await navigationService.navigationForUser(dbSession, NavigationCreate(userId=user.id), Provider())
    assert response.destination.shelterId == safe.id
    assert any(item.shelterId == unsafe.id and 'SHELTER_IN_CRITICAL_HAZARD' in item.reasonCodes for item in response.rejectedCandidates)


@pytest.mark.asyncio
async def testFullReturnedRouteLoadsCriticalEvidenceOutsideOriginSearch(dbSession, monkeypatch):
    item = syntheticEvidence(geometry={'type': 'Polygon', 'coordinates': [[[0.294, -0.001], [0.296, -0.001], [0.296, 0.001], [0.294, 0.001], [0.294, -0.001]]]})
    await hazardRepository.saveEvidence(dbSession, [item])
    await dbSession.commit()
    monkeypatch.setattr(navigationService.externalDataService, 'storedReports', noReports)
    class Provider:
        async def routes(self, origin, destination, waypoints=None, maxCandidates=3):
            return [syntheticRoute([[0, 0], [0.3, 0]], 100)]
    response = await navigationService.previewNavigation(dbSession, NavigationPreviewCreate(originLatitude=0, originLongitude=0, destinationLatitude=0, destinationLongitude=0.3), Provider())
    assert response.routeStatus == NavigationStatus.UNAVAILABLE
    assert 'NO_FEASIBLE_ROUTE' in response.selectionReasonCodes


@pytest.mark.asyncio
async def testNoUpstreamHazardFetchDuringNavigation(dbSession, monkeypatch):
    from app.services import hazardProviders
    async def forbidden(*args, **kwargs):
        raise AssertionError('navigation must use stored hazard state')
    monkeypatch.setattr(hazardProviders, 'fetchProvider', forbidden)
    monkeypatch.setattr(navigationService.externalDataService, 'storedReports', noReports)
    response = await navigationService.previewNavigation(dbSession, NavigationPreviewCreate(originLatitude=0, originLongitude=0, destinationLatitude=0, destinationLongitude=0.01), SyntheticRoutingProvider())
    assert response.routeStatus == NavigationStatus.READY


@pytest.mark.asyncio
async def testValhallaCombinesEveryDetourLegAndAlternative(monkeypatch):
    from app.services import valhallaProvider
    class Response:
        is_success = True
        status_code = 200
        def json(self):
            trip = {'summary': {'length': 2, 'time': 200}, 'legs': [{'shape': {'type': 'LineString', 'coordinates': [[0, 0], [0.01, 0.01]]}}, {'shape': {'type': 'LineString', 'coordinates': [[0.01, 0.01], [0.02, 0]]}}]}
            return {'trip': trip, 'alternates': [{'trip': trip}]}
    class Client:
        def __init__(self, **kwargs):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            pass
        async def post(self, url, json):
            return Response()
    monkeypatch.setattr(valhallaProvider.httpx, 'AsyncClient', Client)
    routes = await valhallaProvider.ValhallaRoutingProvider().routes((0, 0), (0, 0.02))
    assert len(routes) == 2
    assert routes[0].geometry['coordinates'] == [[0, 0], [0.01, 0.01], [0.02, 0]]
    assert routes[0].durationSec == 200


@pytest.mark.asyncio
async def testOfficialEvacuationContextDelegatesToHazardAwareNavigation(dbSession, monkeypatch):
    from app.models.navigation import NavigationResponse
    from app.routers import context as contextRouter
    from app.services.bmkg_service import BmkgFetchResult
    from app.services.petabencana_service import PetaBencanaFetchResult
    item = syntheticEvidence()
    item.metadata['officialStatus'] = 'AWAS'
    await hazardRepository.saveEvidence(dbSession, [item])
    await dbSession.commit()
    user = await user_service.create_user(dbSession, UserCreate(name='SYNTHETIC_TEST_CONTEXT'))
    await user_service.update_location(dbSession, user.id, LocationUpdate(latitude=0, longitude=0.005, observed_at=datetime.now(timezone.utc)))
    calls = []
    async def weather(adm4):
        return BmkgFetchResult(None, 'SYNTHETIC_TEST_UNAVAILABLE')
    async def reports():
        return PetaBencanaFetchResult([])
    async def navigation(session, payload):
        calls.append(payload.userId)
        return NavigationResponse(routeStatus=NavigationStatus.UNAVAILABLE, selectionReasonCodes=['NO_FEASIBLE_ROUTE'])
    monkeypatch.setattr(contextRouter, 'fetch_weather', weather)
    monkeypatch.setattr(contextRouter, 'fetch_reports', reports)
    monkeypatch.setattr(navigationService, 'navigationForUser', navigation)
    response = await contextRouter.getContext(user.id, dbSession)
    assert response.action.recommended_action.value == 'EVACUATE'
    assert response.event.hazard_type == 'FLOOD'
    assert response.navigation.routeStatus == NavigationStatus.UNAVAILABLE
    assert calls == [user.id]


@pytest.mark.asyncio
async def testHazardQueryLimitFailsClosedWithoutTruncatingEvidence(dbSession, monkeypatch):
    first = syntheticEvidence()
    second = syntheticEvidence()
    second.sourceId = 'SYNTHETIC_TEST_SECOND'
    await hazardRepository.saveEvidence(dbSession, [first, second])
    await dbSession.commit()
    monkeypatch.setattr(hazardRepository, 'HAZARD_MAX_EVIDENCE', 1)
    monkeypatch.setattr(navigationService.externalDataService, 'storedReports', noReports)
    response = await navigationService.previewNavigation(dbSession, NavigationPreviewCreate(originLatitude=0, originLongitude=0, destinationLatitude=0, destinationLongitude=0.01), SyntheticRoutingProvider())
    assert response.routeStatus == NavigationStatus.UNAVAILABLE
    assert 'HAZARD_EVIDENCE_LIMIT_EXCEEDED' in response.selectionReasonCodes
    assert response.route is None


@pytest.mark.asyncio
async def testOneDestinationProviderFailureDoesNotDiscardFeasibleShelter(dbSession, monkeypatch):
    from app.services.valhallaProvider import RoutingUnavailable
    user = await user_service.create_user(dbSession, UserCreate(name='SYNTHETIC_TEST_PARTIAL_FAILURE'))
    await user_service.update_location(dbSession, user.id, LocationUpdate(latitude=0, longitude=0, observed_at=datetime.now(timezone.utc)))
    for index in (1, 2):
        await shelterService.createShelter(dbSession, ShelterCreate(name=f'SYNTHETIC_TEST_{index}', latitude=0, longitude=0.001 * index, shelterType='TEST', status='OPEN', source='SYNTHETIC_TEST'))
    monkeypatch.setattr(navigationService.externalDataService, 'storedReports', noReports)
    class Provider:
        async def route(self, origin, destination, profile='WALKING'):
            if destination[1] > 0.0015:
                raise RoutingUnavailable('SYNTHETIC_TEST_UNAVAILABLE')
            return syntheticRoute([[origin[1], origin[0]], [destination[1], destination[0]]])
    response = await navigationService.navigationForUser(dbSession, NavigationCreate(userId=user.id), Provider())
    assert response.routeStatus == NavigationStatus.READY
    assert response.destination.name == 'SYNTHETIC_TEST_1'
    assert any('ROUTING_PROVIDER_UNAVAILABLE' in item.reasonCodes for item in response.rejectedCandidates)


@pytest.mark.asyncio
async def testNavigationEndpointReturnsFloodEscapeRoute(dbSession, monkeypatch):
    import httpx
    from tests.test_navigation import WorkingProvider, createApi
    item = syntheticEvidence(geometry={'type': 'Polygon', 'coordinates': [[[106.799, -6.201], [106.804, -6.201], [106.804, -6.199], [106.799, -6.199], [106.799, -6.201]]]})
    item.metadata['officialStatus'] = 'AWAS'
    await hazardRepository.saveEvidence(dbSession, [item])
    shelter = await shelterService.createShelter(dbSession, ShelterCreate(name='SYNTHETIC_TEST_OUTSIDE', latitude=-6.2, longitude=106.81, shelterType='TEST', status='OPEN', source='SYNTHETIC_TEST'))
    await dbSession.commit()
    monkeypatch.setattr(navigationService.externalDataService, 'storedReports', noReports)
    monkeypatch.setattr(navigationService, 'ValhallaRoutingProvider', WorkingProvider)
    transport = httpx.ASGITransport(app=createApi(dbSession))
    async with httpx.AsyncClient(transport=transport, base_url='http://test') as client:
        guest = (await client.post('/v1/guest-sessions')).json()
        response = await client.post('/v1/navigation/routes', json={'userId': guest['user']['id'], 'origin': {'latitude': -6.2, 'longitude': 106.8, 'observedAt': datetime.now(timezone.utc).isoformat()}}, headers={'Authorization': f"Bearer {guest['access_token']}"})
    assert response.status_code == 200
    body = response.json()
    assert body['routeStatus'] == 'READY'
    assert body['destination']['shelterId'] == str(shelter.id)
    assert body['route'] is not None
    assert body['evaluation']['safetyStatus'] == 'EXPOSED'
    assert 'HAZARD_ZONE_EXIT' in body['evaluation']['reasonCodes']
    assert 'NO_KNOWN_HAZARD_INTERSECTION' not in body['evaluation']['reasonCodes']
    assert 'NO_FEASIBLE_ROUTE' not in body['selectionReasonCodes']
