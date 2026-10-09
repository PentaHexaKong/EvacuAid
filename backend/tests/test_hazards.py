from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError
from shapely.geometry import Point, shape
from shapely.ops import transform

from app.models.hazard import Authority, EvidenceType, HazardEvidence, HazardType
from app.services.elevationProvider import ElevationProfile, ElevationProvider
from app.services.hazardEvaluator import destinationExcluded, evaluateHazards
from app.services.routeCandidateService import detourWaypoints, evaluatedCandidates
from app.services.routeEvaluationService import applyRanking, evaluateRoute, rankingKey
from app.services.valhallaProvider import RouteData
from app.utils.hazardGeometry import projection, sampleSegments, validGeometry


def syntheticEvidence(hazard=HazardType.FLOOD, kind=EvidenceType.CRITICAL_HAZARD, geometry=None, authority=Authority.OFFICIAL, **kwargs):
    return HazardEvidence(sourceId='SYNTHETIC_TEST', source='SYNTHETIC_TEST', hazardType=hazard, authority=authority, evidenceType=kind, geometry=geometry or {'type': 'Polygon', 'coordinates': [[[0.004, -0.001], [0.006, -0.001], [0.006, 0.001], [0.004, 0.001], [0.004, -0.001]]]}, validUntil=datetime.now(timezone.utc) + timedelta(hours=1), metadata={'fixture': 'SYNTHETIC_TEST'}, **kwargs)


def syntheticRoute(coordinates=None, duration=100):
    return RouteData(1113, duration, {'type': 'LineString', 'coordinates': coordinates or [[0, 0], [0.01, 0]]})


def testCriticalPolygonRejectsShortestAndLongerAlternativeWins():
    evidence = [syntheticEvidence()]
    short = evaluateRoute('short', syntheticRoute(), evidence, False)
    long = evaluateRoute('long', syntheticRoute([[0, 0], [0, 0.002], [0.01, 0.002], [0.01, 0]], 180), evidence, False)
    applyRanking([short, long])
    assert not short.feasible
    assert long.feasible
    assert 'AUTHORITATIVE_HAZARD_INTERSECTION' in short.reasons
    assert 'ROUTE_REJECTED_CRITICAL_HAZARD' in short.reasons
    assert min([item for item in [short, long] if item.feasible], key=rankingKey) is long


def testFloodIntersectionRatioUsesActualMetricLength():
    metrics, feasible, _, _, _, _ = evaluateHazards(syntheticRoute(), [syntheticEvidence(kind=EvidenceType.BASELINE_HAZARD)])
    assert feasible
    assert metrics['flood'].intersectionRatio == pytest.approx(0.2, abs=0.001)
    assert metrics['flood'].state == 'EXPOSED'
    assert 'BASELINE_HAZARD_EXPOSURE' in metrics['flood'].reasonCodes


@pytest.mark.parametrize('authority', [Authority.COMMUNITY, Authority.SATELLITE_OBSERVATION])
def testObservationsCannotCreateOfficialExclusions(authority):
    with pytest.raises(ValidationError):
        syntheticEvidence(authority=authority)


def testCommunityPointRemainsPotentialAndFeasible():
    item = syntheticEvidence(kind=EvidenceType.OBSERVATION, authority=Authority.COMMUNITY, geometry={'type': 'Point', 'coordinates': [0.005, 0]})
    result = evaluateRoute('community', syntheticRoute(), [item], False)
    assert result.feasible
    assert result.hazardStatus.value == 'POTENTIALLY_EXPOSED'
    assert result.hazards['flood'].communityContribution <= 0.25
    assert 'COMMUNITY_REPORT_NEAR_ROUTE' in result.reasons
    assert not item.hard()


def testNearbyEarthquakeDoesNotCloseRoad():
    item = syntheticEvidence(hazard=HazardType.EARTHQUAKE, kind=EvidenceType.OBSERVATION, geometry={'type': 'Point', 'coordinates': [0.005, 0]})
    result = evaluateRoute('earthquake', syntheticRoute(), [item], False)
    assert result.feasible
    assert 'EARTHQUAKE_EVENT_NEAR_ROUTE' in result.reasons
    assert 'EARTHQUAKE_DAMAGE_STATUS_UNKNOWN' in result.reasons


def testEarthquakeCriticalRequiresConfirmedDamage():
    item = syntheticEvidence(hazard=HazardType.EARTHQUAKE)
    assert evaluateRoute('noDamage', syntheticRoute(), [item], False).feasible
    item.metadata['confirmedDamage'] = True
    assert not evaluateRoute('damage', syntheticRoute(), [item], False).feasible


def testConfirmedInfrastructureClosureRejectsRoute():
    item = syntheticEvidence(hazard=HazardType.EARTHQUAKE, kind=EvidenceType.CONFIRMED_CLOSURE)
    result = evaluateRoute('closure', syntheticRoute(), [item], False)
    assert not result.feasible
    assert 'CONFIRMED_INFRASTRUCTURE_CLOSURE' in result.reasons


def tsunamiZone():
    return syntheticEvidence(hazard=HazardType.TSUNAMI, geometry={'type': 'Polygon', 'coordinates': [[[-0.001, -0.001], [0.004, -0.001], [0.004, 0.001], [-0.001, 0.001], [-0.001, -0.001]]]})


def testTsunamiStartInsideCanExitWithoutElevation():
    result = evaluateRoute('escape', syntheticRoute(), [tsunamiZone()], False)
    assert result.feasible
    assert 'TSUNAMI_ZONE_EXIT' in result.reasons
    assert 'ELEVATION_DATA_UNKNOWN' in result.reasons
    assert result.hazards['tsunami'].firstExitDistanceM == pytest.approx(445.3, abs=2)
    assert result.hazards['tsunami'].firstExitTimeSec == pytest.approx(40, abs=1)
    assert result.hazards['tsunami'].elevationGainM is None


def testSoonerTsunamiExitBeatsFasterTotalTravel():
    early = evaluateRoute('early', syntheticRoute([[0, 0], [0, 0.002], [0.01, 0.002], [0.01, 0]], 140), [tsunamiZone()], False)
    late = evaluateRoute('late', syntheticRoute(duration=100), [tsunamiZone()], False)
    applyRanking([early, late])
    assert early.feasible and late.feasible
    assert min([early, late], key=rankingKey) is early


def testTsunamiReentryRejected():
    route = syntheticRoute([[0, 0], [0, 0.002], [0.003, 0.002], [0.003, 0], [0.01, 0]])
    result = evaluateRoute('reentry', route, [tsunamiZone()], False)
    assert not result.feasible
    assert 'TSUNAMI_ZONE_REENTRY' in result.reasons
    assert result.hazards['tsunami'].reentered


def testTsunamiDestinationStillInsideRejected():
    result = evaluateRoute('trapped', syntheticRoute([[0, 0], [0.003, 0]]), [tsunamiZone()], False)
    assert not result.feasible
    assert 'TSUNAMI_ZONE_NOT_EXITED' in result.reasons


def testTsunamiZoneCannotBeCrossedFromOutside():
    result = evaluateRoute('cross', syntheticRoute([[-0.002, 0], [0.01, 0]]), [tsunamiZone()], False)
    assert not result.feasible


def testTsunamiElevationUsesRealRelativeGain():
    profile = ElevationProfile([10, 25], 'SYNTHETIC_TEST', 'TEST', (30, 30))
    result = evaluateRoute('uphill', syntheticRoute(), [tsunamiZone()], False, profile)
    assert result.hazards['tsunami'].elevationGainM == 15
    assert 'ELEVATION_DATA_UNKNOWN' not in result.hazards['tsunami'].reasonCodes


def testMissingElevationCannotImplicitlyClaimBestTsunamiGain():
    unknown = evaluateRoute('unknownElevation', syntheticRoute(), [tsunamiZone()], False)
    known = evaluateRoute('knownElevation', syntheticRoute(), [tsunamiZone()], False, ElevationProfile([10, 10], 'SYNTHETIC_TEST', 'TEST'))
    assert unknown.hazards['tsunami'].elevationGainM is None
    assert unknown.hazards['tsunami'].elevationPenalty is None
    assert unknown.hazards['tsunami'].unknownElevationPenalty > 0
    assert unknown.hazardExposure >= known.hazardExposure
    assert rankingKey(known) < rankingKey(unknown)


def testHotspotsAreBoundedPointsAndNotFirePerimeters():
    items = [syntheticEvidence(hazard=HazardType.WILDFIRE, kind=EvidenceType.OBSERVATION, authority=Authority.SATELLITE_OBSERVATION, geometry={'type': 'Point', 'coordinates': [0.005, 0]}, confidence=0.8) for _ in range(100)]
    result = evaluateRoute('fire', syntheticRoute(), items, False)
    assert result.feasible
    assert 0 < result.hazards['wildfire'].exposure <= 1
    assert result.hazards['wildfire'].intersectionRatio == 0
    assert 'FIRMS_HOTSPOT_NEAR_ROUTE' in result.reasons
    assert all(item.geometry['type'] == 'Point' for item in items)


def testLandslideBaselineIsExposureWithoutActiveDisaster():
    item = syntheticEvidence(hazard=HazardType.LANDSLIDE, kind=EvidenceType.BASELINE_HAZARD, severity=0.6, confidence=0.8)
    result = evaluateRoute('slide', syntheticRoute(), [item], False)
    assert result.feasible
    assert result.hazards['landslide'].severityExposure == pytest.approx(0.096, abs=0.001)
    assert 'LANDSLIDE_SUSCEPTIBILITY_EXPOSURE' in result.reasons
    assert 'ACTIVE_WARNING_INTERSECTION' not in result.reasons
    assert result.hazards['landslide'].slopeMeanDegrees is None


def testEmptyEvidenceAllHazardsUnknownAndRouteAvailable():
    result = evaluateRoute('empty', syntheticRoute(), [], False)
    assert result.feasible
    assert len(result.hazards) == 5
    assert all(metric.state == 'UNKNOWN' for metric in result.hazards.values())


def testExpiredEvidenceDoesNotRejectRoute():
    item = syntheticEvidence()
    item.validUntil = datetime.now(timezone.utc) - timedelta(seconds=1)
    assert evaluateRoute('expired', syntheticRoute(), [item], False).feasible


def testFutureEvidenceDoesNotRejectRoute():
    item = syntheticEvidence()
    item.validFrom = datetime.now(timezone.utc) + timedelta(minutes=10)
    assert evaluateRoute('future', syntheticRoute(), [item], False).feasible


def testMultiPolygonWorksAndPolygonHolesArePreserved():
    polygon = syntheticEvidence().geometry['coordinates']
    item = syntheticEvidence(geometry={'type': 'MultiPolygon', 'coordinates': [polygon]})
    assert not evaluateRoute('multi', syntheticRoute(), [item], False).feasible
    outer = [[-0.01, -0.01], [0.02, -0.01], [0.02, 0.01], [-0.01, 0.01], [-0.01, -0.01]]
    hole = [[-0.001, -0.001], [0.011, -0.001], [0.011, 0.001], [-0.001, 0.001], [-0.001, -0.001]]
    item = syntheticEvidence(geometry={'type': 'Polygon', 'coordinates': [outer, hole]})
    assert evaluateRoute('hole', syntheticRoute(), [item], False).feasible


@pytest.mark.parametrize('geometry', [{}, {'type': 'Polygon', 'coordinates': []}, {'type': 'Point', 'coordinates': [999, 0]}])
def testInvalidCriticalGeometryFailsClosedWithoutCrash(geometry):
    item = syntheticEvidence()
    item.geometry = geometry
    result = evaluateRoute('invalidEvidence', syntheticRoute(), [item], False)
    assert not result.feasible


def testInvalidPolygonRepairDoesNotLoseCriticalGeometry():
    item = syntheticEvidence(geometry={'type': 'Polygon', 'coordinates': [[[0.004, -0.001], [0.006, 0.001], [0.004, 0.001], [0.006, -0.001], [0.004, -0.001]]]})
    assert validGeometry(item.geometry).is_valid
    assert not evaluateRoute('repaired', syntheticRoute(), [item], False).feasible


def testMetricProjectionAndBoundedSampling():
    line = shape(syntheticRoute().geometry)
    forward, _ = projection(line)
    metric = transform(forward, line)
    assert metric.length == pytest.approx(1113.2, abs=1)
    assert len(sampleSegments(metric)) == 23


def testInvalidRouteDoesNotInventAuthoritativeHazardReason():
    route = syntheticRoute([[0, 0], [0.01, 0.01], [0, 0.01], [0.01, 0]])
    result = evaluateRoute('selfIntersection', route, [], False)
    assert not result.feasible
    assert 'INVALID_ROUTE_GEOMETRY' in result.flags
    assert 'AUTHORITATIVE_CRITICAL_HAZARD' not in result.flags


def testCriticalShelterRejectedAndBaselineShelterNotRejected():
    assert destinationExcluded(0, 0.005, [syntheticEvidence()])
    assert not destinationExcluded(0, 0.005, [syntheticEvidence(kind=EvidenceType.BASELINE_HAZARD)])


def testDetourWaypointsOutsideBufferedHazardAndBounded():
    from app.config import DETOUR_CLEARANCE_METERS, DETOUR_MAX_WAYPOINT_CANDIDATES
    item = syntheticEvidence()
    candidates = detourWaypoints((0, 0), (0, 0.01), [item])
    assert 0 < len(candidates) <= DETOUR_MAX_WAYPOINT_CANDIDATES
    forward, _ = projection(shape(syntheticRoute().geometry))
    zone = transform(forward, shape(item.geometry))
    assert all(transform(forward, Point(lon, lat)).distance(zone) >= DETOUR_CLEARANCE_METERS - 0.01 for waypoints in candidates for lat, lon in waypoints)


class SyntheticRoutingProvider:
    def __init__(self, detourWorks=True):
        self.attempts = 0
        self.detourWorks = detourWorks

    async def routes(self, origin, destination, waypoints=None, maxCandidates=3):
        if waypoints:
            self.attempts += 1
            if self.detourWorks:
                return [syntheticRoute([[origin[1], origin[0]], *[[lon, lat] for lat, lon in waypoints], [destination[1], destination[0]]], 150)]
        return [syntheticRoute()]


@pytest.mark.asyncio
async def testAllOrdinaryCandidatesCrossAttemptsAndSelectsValidDetour():
    provider = SyntheticRoutingProvider()
    results = await evaluatedCandidates(provider, (0, 0), (0, 0.01), [syntheticEvidence()], False, 'TEST')
    assert provider.attempts > 0
    assert not results[0].feasible
    feasible = [item for item in results if item.feasible]
    assert feasible
    assert 'HAZARD_DETOUR_GENERATED' in feasible[0].reasons


@pytest.mark.asyncio
async def testNoPossibleDetourLeavesAllCandidatesInfeasible():
    provider = SyntheticRoutingProvider(False)
    results = await evaluatedCandidates(provider, (0, 0), (0, 0.01), [syntheticEvidence()], False, 'TEST')
    assert provider.attempts > 0
    assert not any(item.feasible for item in results)


def testMissingDemReturnsOnlyUnknown():
    result = ElevationProvider('missing-SYNTHETIC_TEST.tif', 'TEST', 'TEST').sample([[0, 0], [0.01, 0]])
    assert result.elevations == [None, None]
    assert result.source == 'UNKNOWN'
    assert result.slopeMeanDegrees is None


def testUncertaintyRanksBeforeTravelTime():
    first = evaluateRoute('lessUnknown', syntheticRoute(duration=110), [], False)
    second = evaluateRoute('fastUnknown', syntheticRoute(), [], False)
    first.uncertainty = 0.2
    assert rankingKey(first) < rankingKey(second)


def testHazardAndAccessibilityRemainSeparate():
    item = syntheticEvidence(kind=EvidenceType.BASELINE_HAZARD)
    ordinary = evaluateRoute('ordinary', syntheticRoute(), [item], False)
    mobility = evaluateRoute('mobility', syntheticRoute(), [item], True)
    assert ordinary.hazardExposure == mobility.hazardExposure
    assert mobility.accessibilityPenalty > ordinary.accessibilityPenalty


def testExplicitAccessibilityImpossibilityRejectsOnlyRequiredProfile():
    route = syntheticRoute()
    route.accessibilityEvidence = [{'geometry': {'type': 'LineString', 'coordinates': [[0.005, -0.001], [0.005, 0.001]]}, 'traversable': False, 'source': 'SYNTHETIC_TEST'}]
    result = evaluateRoute('blockedMobility', route, [], True)
    assert not result.feasible
    assert 'ROUTE_REJECTED_ACCESSIBILITY' in result.reasons
    assert evaluateRoute('ordinary', route, [], False).feasible


def testPreferredDetourLimitDoesNotOverrideLowerHazardExposure():
    fast = evaluateRoute('fast', syntheticRoute(duration=100), [], False)
    safer = evaluateRoute('safer', syntheticRoute(duration=500), [], False)
    fast.hazardExposure = 0.6
    safer.hazardExposure = 0.1
    applyRanking([fast, safer], enforcePreference=False)
    assert safer.feasible
    assert 'PREFERRED_DETOUR_BOUND_EXCEEDED' in safer.flags
    assert min([fast, safer], key=rankingKey) is safer


def testHardOperationalLimitRejectsOtherwiseSafeRoute():
    from app.config import ROUTE_OPERATIONAL_MAX_SECONDS
    route = evaluateRoute('tooLong', syntheticRoute(duration=ROUTE_OPERATIONAL_MAX_SECONDS + 1), [], False)
    applyRanking([route], enforcePreference=False)
    assert not route.feasible


@pytest.mark.asyncio
async def testRouteSnappingCannotSkipCriticalOriginConnector():
    item = syntheticEvidence(geometry={'type': 'Polygon', 'coordinates': [[[0, -0.001], [0.0002, -0.001], [0.0002, 0.001], [0, 0.001], [0, -0.001]]]})
    class Provider:
        async def routes(self, origin, destination, waypoints=None, maxCandidates=3):
            return [syntheticRoute([[0.0003, 0], [0.01, 0]])]
    candidates = await evaluatedCandidates(Provider(), (0, 0.0001), (0, 0.01), [item], False, 'SYNTHETIC_TEST')
    assert not any(item.feasible for item in candidates)
    assert 'ENDPOINT_HAZARD_CONNECTION_UNKNOWN' in candidates[0].reasons


@pytest.mark.parametrize('hazard', list(HazardType))
def testCriticalOriginZoneCanExit(hazard):
    item = syntheticEvidence(hazard=hazard, geometry=tsunamiZone().geometry)
    if hazard == HazardType.EARTHQUAKE:
        item.metadata['confirmedDamage'] = True
    result = evaluateRoute('escape', syntheticRoute(), [item], False)
    assert result.feasible
    assert 'HAZARD_ZONE_EXIT' in result.reasons
    assert 'ROUTE_REJECTED_CRITICAL_HAZARD' not in result.reasons
    assert result.hazardStatus.value == 'EXPOSED'
    if hazard.value.lower() in result.hazards:
        metrics = result.hazards[hazard.value.lower()]
        assert metrics.firstExitDistanceM == pytest.approx(445.3, abs=2)
        assert metrics.firstExitTimeSec == pytest.approx(40, abs=1)
        assert metrics.reentered is False
        assert metrics.intersectionRatio == pytest.approx(0.4, abs=0.001)


def testFloodOriginZoneDestinationInsideRejected():
    item = syntheticEvidence(geometry=tsunamiZone().geometry)
    result = evaluateRoute('trapped', syntheticRoute([[0, 0], [0.003, 0]]), [item], False)
    assert not result.feasible
    assert 'DESTINATION_IN_CRITICAL_HAZARD' in result.reasons
    assert 'HAZARD_ZONE_NOT_EXITED' in result.reasons
    assert destinationExcluded(0, 0.003, [item])


def testFloodOriginZoneReentryRejected():
    item = syntheticEvidence(geometry=tsunamiZone().geometry)
    route = syntheticRoute([[0, 0], [0, 0.002], [0.003, 0.002], [0.003, 0], [0.01, 0]])
    result = evaluateRoute('reentry', route, [item], False)
    assert not result.feasible
    assert 'HAZARD_ZONE_REENTRY' in result.reasons
    assert 'HAZARD_ZONE_EXIT' not in result.reasons
    assert result.hazards['flood'].reentered


@pytest.mark.parametrize('hazard', [HazardType.FLOOD, HazardType.TSUNAMI])
def testEscapeCannotCrossSeparateHardZone(hazard):
    first = syntheticEvidence(hazard=hazard, geometry=tsunamiZone().geometry)
    second = syntheticEvidence(hazard=hazard, geometry={'type': 'Polygon', 'coordinates': [[[0.006, -0.001], [0.008, -0.001], [0.008, 0.001], [0.006, 0.001], [0.006, -0.001]]]})
    result = evaluateRoute('secondZone', syntheticRoute(), [first, second], False)
    assert not result.feasible
    assert 'AUTHORITATIVE_HAZARD_INTERSECTION' in result.reasons
    assert 'ROUTE_REJECTED_CRITICAL_HAZARD' in result.reasons


def testFloodZoneCannotBeCrossedFromOutside():
    result = evaluateRoute('cross', syntheticRoute(), [syntheticEvidence()], False)
    assert not result.feasible
    assert 'AUTHORITATIVE_HAZARD_INTERSECTION' in result.reasons
    assert 'ROUTE_REJECTED_CRITICAL_HAZARD' in result.reasons
    assert not any(reason.startswith('HAZARD_ZONE_') for reason in result.reasons)


@pytest.mark.parametrize('hazard', [HazardType.FLOOD, HazardType.TSUNAMI])
def testConfirmedClosureAtOriginCannotEscape(hazard):
    item = syntheticEvidence(hazard=hazard, kind=EvidenceType.CONFIRMED_CLOSURE, geometry=tsunamiZone().geometry)
    result = evaluateRoute('closureOrigin', syntheticRoute(), [item], False)
    assert not result.feasible
    assert 'CONFIRMED_INFRASTRUCTURE_CLOSURE' in result.reasons
    assert 'HAZARD_ZONE_EXIT' not in result.reasons


def testOverlappingOriginHazardsExitTheirUnion():
    flood = syntheticEvidence(geometry=tsunamiZone().geometry)
    fire = syntheticEvidence(hazard=HazardType.WILDFIRE, geometry={'type': 'Polygon', 'coordinates': [[[-0.001, -0.001], [0.006, -0.001], [0.006, 0.001], [-0.001, 0.001], [-0.001, -0.001]]]})
    result = evaluateRoute('union', syntheticRoute(), [flood, fire], False)
    assert result.feasible
    assert 'HAZARD_ZONE_EXIT' in result.reasons
    for name in ('flood', 'wildfire'):
        assert result.hazards[name].firstExitTimeSec == pytest.approx(60, abs=1)
        assert result.hazards[name].intersectionRatio == pytest.approx(0.6, abs=0.001)


@pytest.mark.asyncio
async def testFloodEscapeAllowsSnappedStartInsideOriginZone():
    item = syntheticEvidence(geometry=tsunamiZone().geometry)
    class Provider:
        async def routes(self, origin, destination, waypoints=None, maxCandidates=3):
            return [syntheticRoute([[0.0001, 0], [0.01, 0]])]
    candidates = await evaluatedCandidates(Provider(), (0, 0), (0, 0.01), [item], False, 'SYNTHETIC_TEST')
    assert candidates[0].feasible
    assert 'HAZARD_ZONE_EXIT' in candidates[0].reasons
    assert 'ENDPOINT_HAZARD_CONNECTION_UNKNOWN' not in candidates[0].reasons
