from datetime import datetime, timezone
from math import exp, prod

from shapely.geometry import Point
from shapely.ops import transform, unary_union

from app.config import ROUTE_CROWDSOURCED_PROBABILITY, ROUTE_CROWDSOURCED_SEVERITY, ROUTE_CROWDSOURCED_CONFIDENCE, HAZARD_COEFFICIENTS, HAZARD_SIGMAS, HAZARD_WEIGHTS, ROUTE_CRITICAL_GEOMETRY_BUFFER_METERS, ROUTE_HAZARD_RADIUS_METERS, TSUNAMI_GAIN_REFERENCE_METERS
from app.models.hazard import Authority, EvidenceType, HazardEvidence, HazardMetrics, HazardType
from app.utils.hazardGeometry import metricGeometry, projection, sampleSegments, validGeometry
from app.config import FIRMS_UNKNOWN_QUALITY


def hardGeometry(item: HazardEvidence, forward):
    geometry = metricGeometry(item.geometry, forward)
    if geometry is not None and geometry.geom_type in {'Point', 'LineString', 'MultiLineString'}:
        geometry = geometry.buffer(ROUTE_CRITICAL_GEOMETRY_BUFFER_METERS)
    return geometry


def escapeProgress(line, zone) -> tuple[float | None, bool]:
    intersection = line.intersection(zone)
    parts = list(intersection.geoms) if hasattr(intersection, 'geoms') else [intersection]
    intervals = []
    for part in parts:
        if part.geom_type == 'LineString' and part.length > 1e-6:
            positions = [line.project(Point(coordinate)) for coordinate in part.coords]
            intervals.append((min(positions), max(positions)))
    merged = []
    for start, end in sorted(intervals):
        if merged and start <= merged[-1][1] + 0.01:
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    if not merged:
        return 0, False
    firstExit = merged[0][1]
    if firstExit >= line.length - 0.01:
        return None, False
    return firstExit, len(merged) > 1


def evaluateFlood(result, evidence, elevation, fireKernels):
    alpha, beta, gamma = HAZARD_COEFFICIENTS['FLOOD']
    result.exposure = alpha * result.intersectionRatio + beta * result.proximity + gamma * result.communityContribution


def evaluateEarthquake(result, evidence, elevation, fireKernels):
    alpha, beta, _ = HAZARD_COEFFICIENTS['EARTHQUAKE']
    result.exposure = alpha * result.intersectionRatio + beta * result.proximity
    if not any(item.evidenceType == EvidenceType.CONFIRMED_CLOSURE or item.metadata.get('confirmedDamage') is True for item in evidence):
        result.reasonCodes.append('EARTHQUAKE_DAMAGE_STATUS_UNKNOWN')


def evaluateTsunami(result, evidence, elevation, fireKernels):
    alpha, beta, gamma = HAZARD_COEFFICIENTS['TSUNAMI']
    result.exposure = alpha * result.intersectionRatio + beta * result.proximity
    if elevation is not None and elevation.elevations and elevation.elevations[0] is not None and elevation.elevations[-1] is not None:
        result.elevationGainM = max(0, elevation.elevations[-1] - elevation.elevations[0])
        result.elevationPenalty = gamma * (1 - min(1, result.elevationGainM / TSUNAMI_GAIN_REFERENCE_METERS))
        result.exposure += result.elevationPenalty
    else:
        result.reasonCodes.append('ELEVATION_DATA_UNKNOWN')
        result.unknownElevationPenalty = gamma
        result.exposure += result.unknownElevationPenalty
    if result.intersectionRatio > 0:
        result.reasonCodes.append('TSUNAMI_ZONE_EXPOSURE')


def evaluateWildfire(result, evidence, elevation, fireKernels):
    alpha, _, _ = HAZARD_COEFFICIENTS['WILDFIRE']
    result.exposure = 1 - prod(1 - kernel for kernel in fireKernels) if fireKernels else (result.severityExposure if result.severityExposure is not None else alpha * result.intersectionRatio)
    result.exposure = max(result.exposure, alpha * result.intersectionRatio)


def evaluateLandslide(result, evidence, elevation, fireKernels):
    alpha, _, _ = HAZARD_COEFFICIENTS['LANDSLIDE']
    result.exposure = result.severityExposure if result.severityExposure is not None else alpha * result.intersectionRatio
    if elevation is not None:
        result.slopeMeanDegrees = elevation.slopeMeanDegrees
    else:
        result.reasonCodes.append('ELEVATION_DATA_UNKNOWN')


EVALUATORS = {'FLOOD': evaluateFlood, 'EARTHQUAKE': evaluateEarthquake, 'TSUNAMI': evaluateTsunami, 'WILDFIRE': evaluateWildfire, 'LANDSLIDE': evaluateLandslide}


def evaluateHazards(route, evidence: list[HazardEvidence], elevation=None) -> tuple[dict[str, HazardMetrics], bool, list[str], float, float, float | None]:
    metrics = {name.lower(): HazardMetrics() for name in HAZARD_SIGMAS}
    geometry = validGeometry(route.geometry)
    if geometry is None or geometry.geom_type != 'LineString' or not geometry.is_simple:
        return metrics, False, ['INVALID_ROUTE_GEOMETRY'], 0, 0, None
    forward, _ = projection(geometry)
    line = transform(forward, geometry)
    if line.length <= 0:
        return metrics, False, ['INVALID_ROUTE_GEOMETRY'], 0, 0, None
    segments = sampleSegments(line)
    now = datetime.now(timezone.utc)
    items = [item for item in evidence if item.active(now)]
    reasons = []
    feasible = True
    closest = None
    tsunamiHard = [hardGeometry(item, forward) for item in items if item.hazardType == HazardType.TSUNAMI and item.hard() and item.evidenceType != EvidenceType.CONFIRMED_CLOSURE]
    tsunamiHard = [zone for zone in tsunamiHard if zone is not None]
    tsunamiZone = unary_union(tsunamiHard) if tsunamiHard else None
    escape = tsunamiZone is not None and tsunamiZone.covers(Point(line.coords[0]))
    if destinationExcluded(geometry.coords[-1][1], geometry.coords[-1][0], items):
        feasible = False
        reasons.extend(['DESTINATION_IN_CRITICAL_HAZARD', 'AUTHORITATIVE_HAZARD_INTERSECTION', 'ROUTE_REJECTED_CRITICAL_HAZARD'])
    for item in items:
        projected = metricGeometry(item.geometry, forward)
        if projected is None:
            reasons.append('HAZARD_GEOMETRY_INVALID')
            if item.hard():
                feasible = False
            continue
        if item.hard() and line.intersects(hardGeometry(item, forward)):
            special = escape and item.hazardType == HazardType.TSUNAMI and item.evidenceType != EvidenceType.CONFIRMED_CLOSURE
            if not special:
                feasible = False
                reasons.extend(['AUTHORITATIVE_HAZARD_INTERSECTION', 'ROUTE_REJECTED_CRITICAL_HAZARD'])
                if item.evidenceType == EvidenceType.CONFIRMED_CLOSURE:
                    reasons.append('CONFIRMED_INFRASTRUCTURE_CLOSURE')
    for name in HAZARD_SIGMAS:
        result = metrics[name.lower()]
        relevant = [item for item in items if item.hazardType.value == name]
        supporting = [item for item in items if item.hazardType == HazardType.EXTREME_WEATHER and name in {'FLOOD', 'LANDSLIDE'}]
        projected = [(item, metricGeometry(item.geometry, forward)) for item in relevant + supporting]
        projected = [(item, zone) for item, zone in projected if zone is not None]
        if not projected:
            if name == 'EARTHQUAKE':
                result.reasonCodes.append('EARTHQUAKE_DAMAGE_STATUS_UNKNOWN')
            if name in {'TSUNAMI', 'LANDSLIDE'} and elevation is None:
                result.reasonCodes.append('ELEVATION_DATA_UNKNOWN')
            continue
        result.sources = sorted({item.source for item, _ in projected})
        zones = [zone for item, zone in projected if item.authority == Authority.OFFICIAL and zone.geom_type in {'Polygon', 'MultiPolygon'} and item.hazardType.value == name]
        result.intersectionRatio = min(1, line.intersection(unary_union(zones)).length / line.length) if zones else 0
        proximity = 0
        generic = 0
        hasGeneric = False
        community = 0
        fireKernels = []
        for item, zone in projected:
            distance = line.distance(zone)
            closest = distance if closest is None else min(closest, distance)
            decay = sum(segment.length * exp(-segment.distance(zone) / HAZARD_SIGMAS[name]) for segment in segments) / line.length
            proximity = 1 - (1 - proximity) * (1 - decay)
            if item.severity is not None and item.confidence is not None:
                fraction = line.intersection(zone).length / line.length if zone.geom_type in {'Polygon', 'MultiPolygon'} else decay
                generic += fraction * item.severity * item.confidence
                hasGeneric = True
            if item.authority == Authority.COMMUNITY:
                influence = ROUTE_CROWDSOURCED_PROBABILITY * (item.severity if item.severity is not None else ROUTE_CROWDSOURCED_SEVERITY) * (item.confidence if item.confidence is not None else ROUTE_CROWDSOURCED_CONFIDENCE)
                community = 1 - (1 - community) * (1 - min(0.25, influence * decay))
                if distance <= ROUTE_HAZARD_RADIUS_METERS:
                    result.reasonCodes.append('COMMUNITY_REPORT_NEAR_ROUTE')
            if item.evidenceType == EvidenceType.BASELINE_HAZARD and line.intersects(zone):
                result.reasonCodes.append('BASELINE_HAZARD_EXPOSURE')
                if name == 'EARTHQUAKE':
                    result.reasonCodes.append('EARTHQUAKE_BASELINE_EXPOSURE')
                if name == 'LANDSLIDE':
                    result.reasonCodes.append('LANDSLIDE_SUSCEPTIBILITY_EXPOSURE')
            if item.evidenceType == EvidenceType.ACTIVE_WARNING and line.intersects(zone):
                result.reasonCodes.append('ACTIVE_WARNING_INTERSECTION')
            if name == 'EARTHQUAKE' and item.evidenceType == EvidenceType.OBSERVATION:
                if distance <= HAZARD_SIGMAS[name]:
                    result.reasonCodes.append('EARTHQUAKE_EVENT_NEAR_ROUTE')
            if name == 'WILDFIRE' and item.authority == Authority.SATELLITE_OBSERVATION:
                q = item.confidence if item.confidence is not None else item.metadata.get('qualityWeight')
                q = q if isinstance(q, (int, float)) else FIRMS_UNKNOWN_QUALITY
                fireKernels.append(min(1, max(0, q * exp(-distance / HAZARD_SIGMAS[name]))))
                if distance <= HAZARD_SIGMAS[name]:
                    result.reasonCodes.append('FIRMS_HOTSPOT_NEAR_ROUTE')
        result.proximity = min(1, proximity)
        result.communityContribution = min(0.25, community)
        result.severityExposure = min(1, generic) if hasGeneric else None
        EVALUATORS[name](result, relevant, elevation, fireKernels)
        result.exposure = min(1, max(0, result.exposure))
        result.state = 'POTENTIALLY_EXPOSED' if any(item.authority != Authority.OFFICIAL for item in relevant) else 'EXPOSED' if result.intersectionRatio > 0 else 'UNKNOWN'
    if escape:
        result = metrics['tsunami']
        exitDistance, reentered = escapeProgress(line, tsunamiZone)
        result.firstExitDistanceM = exitDistance
        result.firstExitTimeSec = route.durationSec * exitDistance / line.length if exitDistance is not None else None
        result.reentered = reentered
        result.intersectionRatio = line.intersection(tsunamiZone).length / line.length
        if exitDistance is None or tsunamiZone.covers(Point(line.coords[-1])):
            feasible = False
            result.reasonCodes.append('TSUNAMI_ZONE_NOT_EXITED')
        else:
            result.reasonCodes.append('TSUNAMI_ZONE_EXIT')
        if reentered:
            feasible = False
            result.reasonCodes.append('TSUNAMI_ZONE_REENTRY')
        if not feasible:
            reasons.extend(['AUTHORITATIVE_HAZARD_INTERSECTION', 'ROUTE_REJECTED_CRITICAL_HAZARD'])
    for result in metrics.values():
        result.reasonCodes = list(dict.fromkeys(result.reasonCodes))
        reasons.extend(result.reasonCodes)
    exposure = sum(HAZARD_WEIGHTS[name] * (metrics[name.lower()].exposure or 0) for name in HAZARD_SIGMAS)
    proximity = sum(HAZARD_WEIGHTS[name] * (metrics[name.lower()].proximity or 0) for name in HAZARD_SIGMAS)
    return metrics, feasible, list(dict.fromkeys(reasons)), exposure, proximity, closest


def destinationExcluded(latitude: float, longitude: float, evidence: list[HazardEvidence]) -> bool:
    point = Point(longitude, latitude)
    forward, _ = projection(point)
    metricPoint = transform(forward, point)
    for item in evidence:
        if item.active() and item.hard():
            zone = hardGeometry(item, forward)
            if zone is None or zone.covers(metricPoint):
                return True
    return False
