from datetime import datetime, timezone

import pytest

from app.db.models.pilot import PilotLocation, PilotRequest
from app.models.hazard import EvidenceType
from app.models.pilot import SessionRoute
from app.models.shelter import ShelterCreate
from app.models.user import UserCreate
from app.repositories import hazardRepository
from app.services import navigationService, pilotNavigation, shelterService, user_service
from tests.test_hazard_navigation import noReports
from tests.test_hazards import syntheticEvidence, syntheticRoute


async def sessionFixture(db, leg):
    requester = await user_service.create_user(db, UserCreate(name='SYNTHETIC_TEST_REQUESTER'))
    helper = await user_service.create_user(db, UserCreate(name='SYNTHETIC_TEST_HELPER'))
    request = PilotRequest(requester_id=requester.id, helper_id=helper.id, status='ACCEPTED' if leg == 'TO_REQUESTER' else 'ARRIVED', pilot=True, idempotency_key='SYNTHETIC_TEST_ROUTE', sharing_consent=True, meeting_confirmed=leg == 'TO_SHELTER')
    db.add(request)
    await db.flush()
    for user, longitude in ((helper, 0), (requester, 0.01)):
        db.add(PilotLocation(request_id=request.id, user_id=user.id, latitude=0, longitude=longitude, accuracy_m=5, observed_at=datetime.now(timezone.utc)))
    if leg == 'TO_SHELTER':
        await shelterService.createShelter(db, ShelterCreate(name='SYNTHETIC_TEST_SHELTER', latitude=0, longitude=0.01, shelterType='TEST', status='OPEN', source='SYNTHETIC_TEST'))
    await db.commit()
    return request, helper.id, SessionRoute(leg=leg, profile='WALKING')


def routeWithManeuvers(coordinates, duration=100):
    route = syntheticRoute(coordinates, duration)
    route.maneuvers = [{'instruction': 'Continue', 'beginShapeIndex': 0, 'endShapeIndex': len(coordinates) - 1, 'distanceM': route.distanceM, 'durationSec': duration, 'type': 1}]
    return route


class Provider:
    def __init__(self, allowDetour=True, maneuvers=True):
        self.allowDetour = allowDetour
        self.maneuvers = maneuvers
        self.attempts = 0
        self.plainCalls = 0

    async def route(self, origin, destination, profile):
        self.plainCalls += 1
        return routeWithManeuvers([[origin[1], origin[0]], [destination[1], destination[0]]])

    async def routes(self, origin, destination, profile, waypoints=None, maxCandidates=3):
        coordinates = [[origin[1], origin[0]], [destination[1], destination[0]]]
        if waypoints:
            self.attempts += 1
            if self.allowDetour:
                coordinates = [[origin[1], origin[0]], [0, 0.003], [destination[1], 0.003], [destination[1], destination[0]]]
        route = routeWithManeuvers(coordinates, 180 if waypoints else 100)
        if not self.maneuvers:
            route.maneuvers = []
        return [route]


@pytest.mark.asyncio
@pytest.mark.parametrize('leg', ['TO_REQUESTER', 'TO_SHELTER'])
@pytest.mark.parametrize('kind', [EvidenceType.CRITICAL_HAZARD, EvidenceType.CONFIRMED_CLOSURE])
async def testSessionRouteSelectsGeneratedDetour(dbSession, monkeypatch, leg, kind):
    request, actor, payload = await sessionFixture(dbSession, leg)
    await hazardRepository.saveEvidence(dbSession, [syntheticEvidence(kind=kind)])
    await dbSession.commit()
    monkeypatch.setattr(navigationService.externalDataService, 'storedReports', noReports)
    provider = Provider()
    monkeypatch.setattr(pilotNavigation, 'ValhallaRoutingProvider', lambda: provider)
    response = await pilotNavigation.session_route(dbSession, request, actor, payload)
    assert response['routeStatus'] == 'READY'
    assert response['route']['geometry']['coordinates'][1] == [0, 0.003]
    assert 'HAZARD_DETOUR_GENERATED' in response['evaluation']['reasonCodes']
    assert response['route']['maneuvers']
    assert provider.attempts > 0
    assert provider.plainCalls == 0
    if leg == 'TO_SHELTER':
        assert str(request.selected_shelter_id) == str(response['destination']['shelterId'])


@pytest.mark.asyncio
@pytest.mark.parametrize('leg', ['TO_REQUESTER', 'TO_SHELTER'])
async def testSessionRouteAllCandidatesBlocked(dbSession, monkeypatch, leg):
    request, actor, payload = await sessionFixture(dbSession, leg)
    await hazardRepository.saveEvidence(dbSession, [syntheticEvidence()])
    await dbSession.commit()
    monkeypatch.setattr(navigationService.externalDataService, 'storedReports', noReports)
    monkeypatch.setattr(pilotNavigation, 'ValhallaRoutingProvider', lambda: Provider(False))
    response = await pilotNavigation.session_route(dbSession, request, actor, payload)
    assert response['routeStatus'] == 'UNAVAILABLE'
    assert response['leg'] == leg
    assert 'NO_FEASIBLE_ROUTE' in response['selectionReasonCodes']
    assert 'ROUTE_REJECTED_CRITICAL_HAZARD' in response['selectionReasonCodes']
    assert 'route' not in response
    assert request.selected_shelter_id is None


@pytest.mark.asyncio
@pytest.mark.parametrize('leg', ['TO_REQUESTER', 'TO_SHELTER'])
@pytest.mark.parametrize('failureStage', ['initial', 'corridor'])
async def testSessionRouteHazardStateUnavailableFallsBack(dbSession, monkeypatch, leg, failureStage):
    request, actor, payload = await sessionFixture(dbSession, leg)
    calls = []

    async def evidence(db, center):
        calls.append(center)
        if failureStage == 'initial':
            raise hazardRepository.HazardStateUnavailable('SYNTHETIC_TEST_UNAVAILABLE')
        return []

    async def unavailable(*args, **kwargs):
        raise hazardRepository.HazardStateUnavailable('SYNTHETIC_TEST_UNAVAILABLE')

    async def hazards(geometry):
        return 'UNKNOWN', ['HAZARD_DATA_UNAVAILABLE']

    monkeypatch.setattr(navigationService, 'routeEvidence', evidence)
    if failureStage == 'corridor':
        monkeypatch.setattr(hazardRepository, 'activeEvidence', unavailable)
    monkeypatch.setattr(pilotNavigation, 'routeHazards', hazards)
    provider = Provider()
    monkeypatch.setattr(pilotNavigation, 'ValhallaRoutingProvider', lambda: provider)
    response = await pilotNavigation.session_route(dbSession, request, actor, payload)
    assert response['routeStatus'] == 'READY'
    assert 'HAZARD_STATE_UNAVAILABLE' in response['evaluation']['reasonCodes']
    assert response['evaluation']['safetyStatus'] == 'UNKNOWN'
    assert response['route']['maneuvers']
    assert calls == [(0, 0)]
    assert provider.plainCalls == 1


@pytest.mark.asyncio
async def testSessionRouteSkipsCriticalShelterAndBlockedDestination(dbSession, monkeypatch):
    request, actor, payload = await sessionFixture(dbSession, 'TO_SHELTER')
    await shelterService.createShelter(dbSession, ShelterCreate(name='SYNTHETIC_TEST_UNSAFE', latitude=0, longitude=0.005, shelterType='TEST', status='OPEN', source='SYNTHETIC_TEST'))
    safe = await shelterService.createShelter(dbSession, ShelterCreate(name='SYNTHETIC_TEST_SAFE', latitude=0.02, longitude=0, shelterType='TEST', status='OPEN', source='SYNTHETIC_TEST'))
    await hazardRepository.saveEvidence(dbSession, [syntheticEvidence()])
    await dbSession.commit()
    monkeypatch.setattr(navigationService.externalDataService, 'storedReports', noReports)
    destinations = []
    provider = Provider(False)
    original = provider.routes

    async def routes(origin, destination, **kwargs):
        destinations.append(destination)
        return await original(origin, destination, **kwargs)

    monkeypatch.setattr(provider, 'routes', routes)
    monkeypatch.setattr(pilotNavigation, 'ValhallaRoutingProvider', lambda: provider)
    response = await pilotNavigation.session_route(dbSession, request, actor, payload)
    assert response['routeStatus'] == 'READY'
    assert response['destination']['shelterId'] == safe.id
    assert (0, 0.005) not in destinations
    assert (0, 0.01) in destinations
    assert request.selected_shelter_id == safe.id


@pytest.mark.asyncio
async def testSessionRouteRetainsManeuversRequirement(dbSession, monkeypatch):
    request, actor, payload = await sessionFixture(dbSession, 'TO_REQUESTER')
    monkeypatch.setattr(navigationService.externalDataService, 'storedReports', noReports)
    monkeypatch.setattr(pilotNavigation, 'ValhallaRoutingProvider', lambda: Provider(maneuvers=False))
    response = await pilotNavigation.session_route(dbSession, request, actor, payload)
    assert response['routeStatus'] == 'UNAVAILABLE'
    assert response['selectionReasonCodes'] == ['MANEUVERS_UNAVAILABLE']
