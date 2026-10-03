from dataclasses import dataclass, field
from math import cos, exp, radians

from app.config import ROUTE_ACCESSIBILITY_TOLERANCE, ROUTE_ACCESSIBILITY_UNKNOWN_PENALTY, ROUTE_CRITICAL_GEOMETRY_BUFFER_METERS, ROUTE_CROWDSOURCED_UNCERTAINTY, ROUTE_DETOUR_POLICY, ROUTE_HAZARD_PROXIMITY_SIGMA_METERS, ROUTE_HAZARD_RADIUS_METERS, ROUTE_MAX_DETOUR_RATIO, ROUTE_MAX_DETOUR_SECONDS, ROUTE_RISK_TOLERANCE, ROUTE_RISK_WEIGHT_ACCESSIBILITY, ROUTE_RISK_WEIGHT_EXPOSURE, ROUTE_RISK_WEIGHT_PROXIMITY, ROUTE_RISK_WEIGHT_TIME, ROUTE_RISK_WEIGHT_UNCERTAINTY, ROUTE_UNKNOWN_UNCERTAINTY
from app.models.hazard import HazardEvidence, HazardMetrics
from app.services.hazardEvaluator import evaluateHazards
from app.config import HAZARD_UNCERTAINTY_TOLERANCE, ROUTE_OPERATIONAL_MAX_SECONDS
from app.models.navigation import AccessibilityStatus, HazardStatus, NormalizedRouteMetrics, RouteCandidateEvaluation, RouteEvidence, RouteEvidenceKind
from app.services.valhallaProvider import RouteData
from app.utils.geo import calculate_distance_meters


@dataclass
class EvaluatedRoute:
    routeId: str
    route: RouteData
    mobilityRequired: bool
    evidence: list[RouteEvidence]
    feasible: bool = True
    hazardExposure: float = 0
    hazardProximity: float = 0
    accessibilityPenalty: float = 0
    uncertainty: float = ROUTE_UNKNOWN_UNCERTAINTY
    hazardStatus: HazardStatus = HazardStatus.UNKNOWN
    accessibilityStatus: AccessibilityStatus = AccessibilityStatus.COMPATIBLE
    closestHazardDistanceM: float | None = None
    flags: list[str] = field(default_factory=list)
    reasons: list[str] = field(default_factory=list)
    normalized: NormalizedRouteMetrics | None = None
    weightedScore: float | None = None
    hazards: dict[str, HazardMetrics] = field(default_factory=dict)


def routeSegments(geometry: dict) -> list[tuple[list[float], list[float], float]]:
    from app.utils.hazardGeometry import validGeometry
    parsed = validGeometry(geometry)
    if parsed is None or parsed.geom_type != 'LineString':
        return []
    coordinates = geometry.get('coordinates', []) if geometry.get('type') == 'LineString' else []
    segments = []
    for start, end in zip(coordinates, coordinates[1:]):
        if len(start) < 2 or len(end) < 2:
            continue
        lengthM = calculate_distance_meters(start[1], start[0], end[1], end[0])
        if lengthM > 0:
            segments.append((start, end, lengthM))
    return segments


def pointToSegmentDistanceM(point: list[float], start: list[float], end: list[float]) -> float:
    latitudeScale = 111_320
    longitudeScale = latitudeScale * cos(radians(point[1]))
    pointX, pointY = point[0] * longitudeScale, point[1] * latitudeScale
    startX, startY = start[0] * longitudeScale, start[1] * latitudeScale
    endX, endY = end[0] * longitudeScale, end[1] * latitudeScale
    deltaX, deltaY = endX - startX, endY - startY
    lengthSquared = deltaX * deltaX + deltaY * deltaY
    if lengthSquared == 0:
        return ((pointX - startX) ** 2 + (pointY - startY) ** 2) ** 0.5
    projection = max(0, min(1, ((pointX - startX) * deltaX + (pointY - startY) * deltaY) / lengthSquared))
    nearestX, nearestY = startX + projection * deltaX, startY + projection * deltaY
    return ((pointX - nearestX) ** 2 + (pointY - nearestY) ** 2) ** 0.5


def orientation(first: list[float], second: list[float], third: list[float]) -> float:
    return (second[0] - first[0]) * (third[1] - first[1]) - (second[1] - first[1]) * (third[0] - first[0])


def segmentsIntersect(firstStart: list[float], firstEnd: list[float], secondStart: list[float], secondEnd: list[float]) -> bool:
    first = orientation(firstStart, firstEnd, secondStart)
    second = orientation(firstStart, firstEnd, secondEnd)
    third = orientation(secondStart, secondEnd, firstStart)
    fourth = orientation(secondStart, secondEnd, firstEnd)
    if first * second < 0 and third * fourth < 0:
        return True
    return (
        first == 0 and min(firstStart[0], firstEnd[0]) <= secondStart[0] <= max(firstStart[0], firstEnd[0]) and min(firstStart[1], firstEnd[1]) <= secondStart[1] <= max(firstStart[1], firstEnd[1])
    ) or (
        second == 0 and min(firstStart[0], firstEnd[0]) <= secondEnd[0] <= max(firstStart[0], firstEnd[0]) and min(firstStart[1], firstEnd[1]) <= secondEnd[1] <= max(firstStart[1], firstEnd[1])
    ) or (
        third == 0 and min(secondStart[0], secondEnd[0]) <= firstStart[0] <= max(secondStart[0], secondEnd[0]) and min(secondStart[1], secondEnd[1]) <= firstStart[1] <= max(secondStart[1], secondEnd[1])
    ) or (
        fourth == 0 and min(secondStart[0], secondEnd[0]) <= firstEnd[0] <= max(secondStart[0], secondEnd[0]) and min(secondStart[1], secondEnd[1]) <= firstEnd[1] <= max(secondStart[1], secondEnd[1])
    )


def pointInPolygon(point: list[float], polygon: list[list[float]]) -> bool:
    inside = False
    for start, end in zip(polygon, polygon[1:] + polygon[:1]):
        if (start[1] > point[1]) != (end[1] > point[1]):
            intersectionX = (end[0] - start[0]) * (point[1] - start[1]) / (end[1] - start[1]) + start[0]
            if point[0] < intersectionX:
                inside = not inside
    return inside


def intersectsGeometry(segments: list[tuple[list[float], list[float], float]], geometry: dict) -> bool:
    from shapely.geometry import LineString
    from shapely.ops import transform
    from app.utils.hazardGeometry import validGeometry, projection
    hazard = validGeometry(geometry)
    if hazard is None:
        return False
    if not segments:
        return False
    line = LineString([segments[0][0]] + [end for _, end, _ in segments])
    forward, _ = projection(line)
    hazard = transform(forward, hazard)
    if hazard.geom_type == 'Point':
        hazard = hazard.buffer(ROUTE_CRITICAL_GEOMETRY_BUFFER_METERS)
    return transform(forward, line).intersects(hazard)


def pointGeometry(geometry: dict) -> list[float] | None:
    coordinates = geometry.get('coordinates', [])
    if geometry.get('type') == 'Point' and len(coordinates) >= 2:
        return coordinates
    return None


def evaluateRoute(routeId: str, route: RouteData, evidence: list[RouteEvidence | HazardEvidence], mobilityRequired: bool, elevation=None) -> EvaluatedRoute:
    normalizedEvidence = [item for item in evidence if isinstance(item, HazardEvidence)]
    evidence = [item for item in evidence if isinstance(item, RouteEvidence)]
    result = EvaluatedRoute(routeId=routeId, route=route, mobilityRequired=mobilityRequired, evidence=evidence)
    segments = routeSegments(route.geometry)
    if not segments:
        result.feasible = False
        result.flags.append('INVALID_ROUTE_GEOMETRY')
        result.reasons.append('ROUTE_HAS_NO_EVALUABLE_SEGMENTS')
        return result
    for item in evidence:
        if item.evidenceKind in {RouteEvidenceKind.AUTHORITATIVE_CRITICAL, RouteEvidenceKind.CONFIRMED_CLOSURE} and intersectsGeometry(segments, item.geometry):
            result.feasible = False
            flag = 'AUTHORITATIVE_CRITICAL_HAZARD' if item.evidenceKind == RouteEvidenceKind.AUTHORITATIVE_CRITICAL else 'CONFIRMED_CLOSURE'
            result.flags.append(flag)
            result.reasons.append(f'INFEASIBLE_{flag}')
    if mobilityRequired:
        result.accessibilityStatus = AccessibilityStatus.UNKNOWN
        result.accessibilityPenalty = ROUTE_ACCESSIBILITY_UNKNOWN_PENALTY
        result.flags.append('ROUTE_ACCESSIBILITY_UNKNOWN')
        result.reasons.append('ACCESSIBILITY_DATA_UNAVAILABLE')
        for item in route.accessibilityEvidence:
            if item.get('traversable') is False and intersectsGeometry(segments, item.get('geometry', {})):
                result.feasible = False
                result.accessibilityStatus = AccessibilityStatus.POTENTIALLY_INCOMPATIBLE
                result.flags.append('HARD_ACCESSIBILITY_IMPOSSIBILITY')
                result.reasons.append('ROUTE_REJECTED_ACCESSIBILITY')
    totalLengthM = sum(lengthM for _, _, lengthM in segments)
    pointEvidence = [(item, pointGeometry(item.geometry)) for item in evidence]
    pointEvidence = [(item, point) for item, point in pointEvidence if point is not None]
    nearbyCrowdsourced = False
    closestDistanceM = None
    for start, end, lengthM in segments:
        for item, point in pointEvidence:
            distanceM = pointToSegmentDistanceM(point, start, end)
            closestDistanceM = distanceM if closestDistanceM is None else min(closestDistanceM, distanceM)
            influence = item.probability * item.severity * item.confidence
            if distanceM <= ROUTE_HAZARD_RADIUS_METERS:
                result.hazardExposure += lengthM / totalLengthM * influence
                if item.evidenceKind == RouteEvidenceKind.CROWDSOURCED_REPORT:
                    nearbyCrowdsourced = True
            result.hazardProximity += lengthM / totalLengthM * influence * exp(-distanceM / ROUTE_HAZARD_PROXIMITY_SIGMA_METERS)
    result.closestHazardDistanceM = round(closestDistanceM, 2) if closestDistanceM is not None else None
    if nearbyCrowdsourced:
        result.hazardStatus = HazardStatus.POTENTIALLY_EXPOSED
        result.flags.append('POTENTIALLY_EXPOSED')
        result.reasons.append('NEARBY_CROWDSOURCED_HAZARD_REPORT')
    else:
        result.hazardStatus = HazardStatus.UNKNOWN
        result.flags.append('HAZARD_STATE_UNKNOWN')
        result.reasons.append('ABSENCE_OF_EVIDENCE_IS_NOT_SAFETY')
    if not evidence:
        result.uncertainty = ROUTE_UNKNOWN_UNCERTAINTY
    elif all(item.evidenceKind == RouteEvidenceKind.CROWDSOURCED_REPORT for item in evidence):
        result.uncertainty = ROUTE_CROWDSOURCED_UNCERTAINTY
    else:
        result.uncertainty = max(0, 1 - max(item.confidence for item in evidence))
    result.hazards, hazardFeasible, hazardReasons, exposure, proximity, closest = evaluateHazards(route, normalizedEvidence, elevation)
    result.feasible = result.feasible and hazardFeasible
    result.reasons.extend(hazardReasons)
    result.hazardExposure += exposure
    result.hazardProximity += proximity
    if closest is not None:
        result.closestHazardDistanceM = min(result.closestHazardDistanceM, closest) if result.closestHazardDistanceM is not None else closest
    if normalizedEvidence:
        result.uncertainty = sum(1 if metric.exposure is None or (name == 'tsunami' and 'ELEVATION_DATA_UNKNOWN' in metric.reasonCodes) else 0.5 if metric.severityExposure is None else 0 for name, metric in result.hazards.items()) / len(result.hazards)
        if any(metric.state == 'EXPOSED' for metric in result.hazards.values()):
            result.hazardStatus = HazardStatus.EXPOSED
        elif any(metric.state == 'POTENTIALLY_EXPOSED' for metric in result.hazards.values()):
            result.hazardStatus = HazardStatus.POTENTIALLY_EXPOSED
    if not hazardFeasible and 'ROUTE_REJECTED_CRITICAL_HAZARD' in hazardReasons:
        result.flags.append('AUTHORITATIVE_CRITICAL_HAZARD')
    if 'INVALID_ROUTE_GEOMETRY' in hazardReasons:
        result.flags.append('INVALID_ROUTE_GEOMETRY')
    if any(reason.startswith('INFEASIBLE_AUTHORITATIVE') or reason == 'INFEASIBLE_CONFIRMED_CLOSURE' for reason in result.reasons):
        result.reasons.extend(['AUTHORITATIVE_HAZARD_INTERSECTION', 'ROUTE_REJECTED_CRITICAL_HAZARD'])
    result.reasons = list(dict.fromkeys(result.reasons))
    result.hazardExposure = round(result.hazardExposure, 6)
    result.hazardProximity = round(result.hazardProximity, 6)
    return result


def normalize(values: list[float]) -> list[float]:
    minimum, maximum = min(values), max(values)
    if maximum - minimum <= 1e-12:
        return [0 for _ in values]
    return [(value - minimum) / (maximum - minimum) for value in values]


def detourAllowed(durationSec: float, fastestDurationSec: float) -> bool:
    if ROUTE_DETOUR_POLICY == 'disabled':
        return True
    if ROUTE_DETOUR_POLICY == 'ratio':
        return durationSec <= fastestDurationSec * (1 + ROUTE_MAX_DETOUR_RATIO)
    return durationSec - fastestDurationSec <= ROUTE_MAX_DETOUR_SECONDS


def applyRanking(evaluated: list[EvaluatedRoute], enforcePreference: bool = True) -> list[EvaluatedRoute]:
    feasible = [item for item in evaluated if item.feasible]
    if not feasible:
        return evaluated
    fastestDurationSec = min(item.route.durationSec for item in feasible)
    for item in feasible:
        if not enforcePreference and not detourAllowed(item.route.durationSec, fastestDurationSec):
            item.flags.append('PREFERRED_DETOUR_BOUND_EXCEEDED')
        if item.route.durationSec > ROUTE_OPERATIONAL_MAX_SECONDS:
            item.feasible = False
            item.flags.append('HARD_OPERATIONAL_LIMIT_EXCEEDED')
            item.reasons.append('HARD_OPERATIONAL_LIMIT_EXCEEDED')
        elif enforcePreference and not detourAllowed(item.route.durationSec, fastestDurationSec):
            item.feasible = False
            item.flags.append('DETOUR_POLICY_EXCEEDED')
            item.reasons.append('INFEASIBLE_DETOUR_POLICY')
    feasible = [item for item in evaluated if item.feasible]
    if not feasible:
        return evaluated
    exposureValues = normalize([item.hazardExposure for item in feasible])
    proximityValues = normalize([item.hazardProximity for item in feasible])
    accessibilityValues = normalize([item.accessibilityPenalty for item in feasible])
    uncertaintyValues = normalize([item.uncertainty for item in feasible])
    durationValues = normalize([item.route.durationSec for item in feasible])
    for item, exposure, proximity, accessibility, uncertainty, duration in zip(feasible, exposureValues, proximityValues, accessibilityValues, uncertaintyValues, durationValues):
        item.normalized = NormalizedRouteMetrics(hazardExposure=round(exposure, 6), hazardProximity=round(proximity, 6), accessibility=round(accessibility, 6), uncertainty=round(uncertainty, 6), travelTime=round(duration, 6))
        item.weightedScore = round(ROUTE_RISK_WEIGHT_EXPOSURE * exposure + ROUTE_RISK_WEIGHT_PROXIMITY * proximity + ROUTE_RISK_WEIGHT_ACCESSIBILITY * accessibility + ROUTE_RISK_WEIGHT_UNCERTAINTY * uncertainty + ROUTE_RISK_WEIGHT_TIME * duration, 6)
    return evaluated


def rankingKey(item: EvaluatedRoute) -> tuple:
    tsunami = item.hazards.get('tsunami')
    escapeRank = round(tsunami.firstExitDistanceM / 10) if tsunami and tsunami.firstExitDistanceM is not None else 0
    return (
        escapeRank,
        round(item.hazardExposure / ROUTE_RISK_TOLERANCE),
        round(item.hazardProximity / ROUTE_RISK_TOLERANCE),
        round(item.accessibilityPenalty / ROUTE_ACCESSIBILITY_TOLERANCE),
        round(item.uncertainty / HAZARD_UNCERTAINTY_TOLERANCE),
        item.route.durationSec,
        item.routeId,
    )


def candidateResponse(item: EvaluatedRoute) -> RouteCandidateEvaluation:
    riskClass = 'INFEASIBLE' if not item.feasible else 'POTENTIALLY_EXPOSED' if item.hazardStatus == HazardStatus.POTENTIALLY_EXPOSED else 'EXPOSED' if item.hazardStatus == HazardStatus.EXPOSED else 'UNKNOWN'
    return RouteCandidateEvaluation(routeId=item.routeId, distanceM=item.route.distanceM, durationSec=item.route.durationSec, feasible=item.feasible, hazardExposure=item.hazardExposure, hazardProximity=item.hazardProximity, accessibilityPenalty=item.accessibilityPenalty, uncertainty=item.uncertainty, normalized=item.normalized, weightedScore=item.weightedScore, riskClass=riskClass, flags=item.flags, reasons=item.reasons, reasonCodes=item.reasons, hazards=item.hazards)
