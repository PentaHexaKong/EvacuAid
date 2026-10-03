from app.models.navigation import RouteEvidence, RouteEvidenceKind
from app.services import routeEvaluationService
from app.services.valhallaProvider import RouteData


def route(routeId: str, coordinates: list[list[float]], durationSec: float = 100) -> tuple[str, RouteData]:
    return routeId, RouteData(distanceM=1000, durationSec=durationSec, geometry={'type': 'LineString', 'coordinates': coordinates})


def evidence(kind: RouteEvidenceKind, geometry: dict, confidence: float = 1) -> RouteEvidence:
    return RouteEvidence(evidenceKind=kind, geometry=geometry, probability=1, severity=1, confidence=confidence, source='TEST')


def testCriticalGeometryMakesShortRouteInfeasibleWhileLongRouteRemainsAvailable():
    shortId, shortRoute = route('short', [[0, 0], [0.01, 0]])
    longId, longRoute = route('long', [[0, 0.01], [0.01, 0.01]], 150)
    critical = evidence(RouteEvidenceKind.AUTHORITATIVE_CRITICAL, {'type': 'Point', 'coordinates': [0.005, 0]})
    evaluated = routeEvaluationService.applyRanking([
        routeEvaluationService.evaluateRoute(shortId, shortRoute, [critical], False),
        routeEvaluationService.evaluateRoute(longId, longRoute, [critical], False),
    ])
    assert evaluated[0].feasible is False
    assert evaluated[1].feasible is True
    assert min((item for item in evaluated if item.feasible), key=routeEvaluationService.rankingKey).routeId == 'long'


def testClosureIntersectionIsInfeasible():
    routeId, routeData = route('closed', [[0, 0], [0.01, 0]])
    closure = evidence(RouteEvidenceKind.CONFIRMED_CLOSURE, {'type': 'LineString', 'coordinates': [[0.005, -0.001], [0.005, 0.001]]})
    evaluated = routeEvaluationService.evaluateRoute(routeId, routeData, [closure], False)
    assert evaluated.feasible is False
    assert 'CONFIRMED_CLOSURE' in evaluated.flags


def testNearbyCrowdsourcedReportRemainsFeasibleButPotentiallyExposed():
    routeId, routeData = route('reported', [[0, 0], [0.01, 0]])
    report = evidence(RouteEvidenceKind.CROWDSOURCED_REPORT, {'type': 'Point', 'coordinates': [0.005, 0]}, 0.5)
    evaluated = routeEvaluationService.evaluateRoute(routeId, routeData, [report], False)
    assert evaluated.feasible is True
    assert evaluated.hazardStatus.value == 'POTENTIALLY_EXPOSED'
    assert evaluated.uncertainty == routeEvaluationService.ROUTE_CROWDSOURCED_UNCERTAINTY


def testLongerRouteWinsWhenShorterRouteHasGreaterCrowdsourcedExposure():
    shortId, shortRoute = route('short', [[0, 0], [0.01, 0]], 100)
    longId, longRoute = route('long', [[0, 0.01], [0.01, 0.01]], 150)
    report = evidence(RouteEvidenceKind.CROWDSOURCED_REPORT, {'type': 'Point', 'coordinates': [0.005, 0]}, 0.5)
    evaluated = routeEvaluationService.applyRanking([
        routeEvaluationService.evaluateRoute(shortId, shortRoute, [report], False),
        routeEvaluationService.evaluateRoute(longId, longRoute, [report], False),
    ])
    assert min(evaluated, key=routeEvaluationService.rankingKey).routeId == 'long'


def testMultipleCrowdsourcedReportsIncreaseExposure():
    routeId, routeData = route('reported', [[0, 0], [0.01, 0]])
    first = evidence(RouteEvidenceKind.CROWDSOURCED_REPORT, {'type': 'Point', 'coordinates': [0.003, 0]}, 0.5)
    second = evidence(RouteEvidenceKind.CROWDSOURCED_REPORT, {'type': 'Point', 'coordinates': [0.007, 0]}, 0.5)
    oneReport = routeEvaluationService.evaluateRoute(routeId, routeData, [first], False)
    twoReports = routeEvaluationService.evaluateRoute(routeId, routeData, [first, second], False)
    assert twoReports.hazardExposure > oneReport.hazardExposure


def testNoEvidencePreservesUnknownRiskState():
    routeId, routeData = route('unknown', [[0, 0], [0.01, 0]])
    evaluated = routeEvaluationService.evaluateRoute(routeId, routeData, [], False)
    assert evaluated.hazardStatus.value == 'UNKNOWN'
    assert evaluated.uncertainty == routeEvaluationService.ROUTE_UNKNOWN_UNCERTAINTY


def testAccessibilityUnknownAddsPenaltyWhenMobilityIsRequired():
    routeId, routeData = route('mobility', [[0, 0], [0.01, 0]])
    evaluated = routeEvaluationService.evaluateRoute(routeId, routeData, [], True)
    assert evaluated.accessibilityStatus.value == 'UNKNOWN'
    assert evaluated.accessibilityPenalty == routeEvaluationService.ROUTE_ACCESSIBILITY_UNKNOWN_PENALTY


def testAccessibilityPenaltyBreaksOtherwiseEqualSafetyTie():
    firstId, firstRoute = route('accessible', [[0, 0], [0.01, 0]], 100)
    secondId, secondRoute = route('unknownAccess', [[0, 0], [0.01, 0]], 100)
    first = routeEvaluationService.evaluateRoute(firstId, firstRoute, [], False)
    second = routeEvaluationService.evaluateRoute(secondId, secondRoute, [], False)
    second.accessibilityPenalty = 1
    evaluated = routeEvaluationService.applyRanking([first, second])
    assert min(evaluated, key=routeEvaluationService.rankingKey).routeId == 'accessible'


def testTravelTimeBreaksSafetyAndAccessibilityTie():
    firstId, firstRoute = route('fast', [[0, 0], [0.01, 0]], 100)
    secondId, secondRoute = route('slow', [[0, 0], [0.01, 0]], 120)
    evaluated = routeEvaluationService.applyRanking([
        routeEvaluationService.evaluateRoute(firstId, firstRoute, [], False),
        routeEvaluationService.evaluateRoute(secondId, secondRoute, [], False),
    ])
    assert min(evaluated, key=routeEvaluationService.rankingKey).routeId == 'fast'


def testNormalizationHandlesIdenticalCandidateMetrics():
    firstId, firstRoute = route('a', [[0, 0], [0.01, 0]])
    secondId, secondRoute = route('b', [[0, 0], [0.01, 0]])
    evaluated = routeEvaluationService.applyRanking([
        routeEvaluationService.evaluateRoute(firstId, firstRoute, [], False),
        routeEvaluationService.evaluateRoute(secondId, secondRoute, [], False),
    ])
    assert all(item.weightedScore == 0 for item in evaluated)
    assert min(evaluated, key=routeEvaluationService.rankingKey).routeId == 'a'


def testDetourPolicyCanRejectARouteOutsideConfiguredLimit(monkeypatch):
    monkeypatch.setattr(routeEvaluationService, 'ROUTE_DETOUR_POLICY', 'ratio')
    monkeypatch.setattr(routeEvaluationService, 'ROUTE_MAX_DETOUR_RATIO', 0.1)
    fastId, fastRoute = route('fast', [[0, 0], [0.01, 0]], 100)
    slowId, slowRoute = route('slow', [[0, 0.01], [0.01, 0.01]], 120)
    evaluated = routeEvaluationService.applyRanking([
        routeEvaluationService.evaluateRoute(fastId, fastRoute, [], False),
        routeEvaluationService.evaluateRoute(slowId, slowRoute, [], False),
    ])
    assert evaluated[0].feasible is True
    assert evaluated[1].feasible is False
    assert 'DETOUR_POLICY_EXCEEDED' in evaluated[1].flags
