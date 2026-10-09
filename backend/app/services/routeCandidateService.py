import asyncio
import logging
from math import hypot

from shapely.geometry import LineString, Point
from shapely.ops import transform, unary_union

from app.config import DETOUR_CLEARANCE_METERS, DETOUR_MAX_WAYPOINT_CANDIDATES, ROUTE_MAX_ALTERNATIVES, ROUTE_OPERATIONAL_MAX_SECONDS
from app.models.hazard import HazardEvidence
from app.models.navigation import RouteEvidence, RouteEvidenceKind
from app.services.elevationProvider import ElevationProvider
from app.services.hazardEvaluator import hardGeometry
from app.models.hazard import EvidenceType
from app.services.routeEvaluationService import evaluateRoute
from app.services.valhallaProvider import NoRoute, RouteData, RoutingUnavailable
from app.utils.hazardGeometry import projection, sampleSegments, validGeometry


logger = logging.getLogger(__name__)


def detourWaypoints(origin, destination, evidence, routes=None) -> list[list[tuple[float, float]]]:
    direct = LineString([(origin[1], origin[0]), (destination[1], destination[0])])
    forward, reverse = projection(direct)
    line = transform(forward, direct)
    zones = []
    for item in evidence:
        if isinstance(item, HazardEvidence) and item.active() and item.hard():
            zone = hardGeometry(item, forward)
        elif isinstance(item, RouteEvidence) and item.evidenceKind in {RouteEvidenceKind.AUTHORITATIVE_CRITICAL, RouteEvidenceKind.CONFIRMED_CLOSURE}:
            from app.utils.hazardGeometry import metricGeometry
            zone = metricGeometry(item.geometry, forward)
            if zone is not None and zone.geom_type in {'Point', 'LineString'}:
                from app.config import ROUTE_CRITICAL_GEOMETRY_BUFFER_METERS
                zone = zone.buffer(ROUTE_CRITICAL_GEOMETRY_BUFFER_METERS)
        else:
            continue
        if zone is not None:
            zones.append(zone)
    if not zones or line.length == 0:
        return []
    blocked = unary_union(zones)
    clearance = blocked.buffer(DETOUR_CLEARANCE_METERS)
    start, end = Point(line.coords[0]), Point(line.coords[-1])
    dx, dy = end.x - start.x, end.y - start.y
    length = hypot(dx, dy)
    ux, uy = dx / length, dy / length
    vx, vy = -uy, ux
    candidates = []
    components = list(clearance.geoms) if hasattr(clearance, 'geoms') else [clearance]
    routeLines = [transform(forward, parsed) for route in routes or [] if (parsed := validGeometry(route.geometry)) is not None]
    reference = unary_union(routeLines) if routeLines else line
    relevant = [zone for zone in components if reference.intersects(zone)]
    if not relevant:
        return []
    obstacle = unary_union(relevant)
    boundary = []
    for zone in (list(obstacle.geoms) if hasattr(obstacle, 'geoms') else [obstacle]):
        boundary.extend(zone.exterior.coords)
    along = [(x - start.x) * ux + (y - start.y) * uy for x, y in boundary]
    across = [(x - start.x) * vx + (y - start.y) * vy for x, y in boundary]
    margin = DETOUR_CLEARANCE_METERS
    for multiplier in (1, 2, 3, 4):
        for side in (-1, 1):
            offset = (max(across) + multiplier * margin) if side == 1 else (min(across) - multiplier * margin)
            low, high = max(0, min(along) - margin), min(length, max(along) + margin)
            points = [Point(start.x + value * ux + offset * vx, start.y + value * uy + offset * vy) for value in (low, high)]
            if any(clearance.covers(point) for point in points):
                continue
            geographic = [transform(reverse, point) for point in points]
            candidates.append([(point.y, point.x) for point in geographic])
            if len(candidates) >= DETOUR_MAX_WAYPOINT_CANDIDATES:
                return candidates
    return candidates


def equivalent(route, others) -> bool:
    geometry = validGeometry(route.geometry)
    if geometry is None:
        return False
    forward, _ = projection(geometry)
    projected = transform(forward, geometry)
    for other in others:
        comparison = validGeometry(other.route.geometry)
        if comparison is not None and projected.hausdorff_distance(transform(forward, comparison)) < 5:
            return True
    return False


async def evaluatedCandidates(provider, origin, destination, evidence, mobilityRequired, prefix, session=None, profile=None):
    routingOptions = {'profile': profile} if profile is not None else {}
    async def loadEvidence(routes):
        nonlocal evidence
        if session is None or not routes:
            return
        from app.config import HAZARD_SEARCH_METERS
        from app.repositories import hazardRepository
        geometries = [route.geometry['coordinates'] for route in routes if validGeometry(route.geometry) is not None and route.geometry.get('type') == 'LineString']
        if not geometries:
            return
        loaded = await hazardRepository.activeEvidence(session, origin, HAZARD_SEARCH_METERS, {'type': 'MultiLineString', 'coordinates': geometries})
        identifiers = {(item.source, item.sourceId) for item in evidence if isinstance(item, HazardEvidence)}
        evidence = evidence + [item for item in loaded if (item.source, item.sourceId) not in identifiers]
    async def evaluate(route, routeId):
        geometry = validGeometry(route.geometry)
        elevation = None
        if geometry is not None and geometry.geom_type == 'LineString':
            forward, reverse = projection(geometry)
            line = transform(forward, geometry)
            samples = sampleSegments(line)
            points = [transform(reverse, Point(line.coords[0]))] + [transform(reverse, Point(segment.coords[-1])) for segment in samples]
            profile = await asyncio.to_thread(ElevationProvider().sample, [[point.x, point.y] for point in points])
            if any(value is not None for value in profile.elevations):
                elevation = profile
        result = evaluateRoute(routeId, route, evidence, mobilityRequired, elevation)
        if geometry is not None and geometry.geom_type == 'LineString':
            from app.config import ROUTE_ENDPOINT_TOLERANCE_METERS
            metricLine = transform(forward, geometry)
            actualStart = transform(forward, Point(origin[1], origin[0]))
            actualEnd = transform(forward, Point(destination[1], destination[0]))
            snappedStart, snappedEnd = Point(metricLine.coords[0]), Point(metricLine.coords[-1])
            if actualStart.distance(snappedStart) > ROUTE_ENDPOINT_TOLERANCE_METERS or actualEnd.distance(snappedEnd) > ROUTE_ENDPOINT_TOLERANCE_METERS:
                result.feasible = False
                result.reasons.append('ROUTE_ENDPOINT_MISMATCH')
            for item in evidence:
                if not isinstance(item, HazardEvidence) or not item.active() or not item.hard():
                    continue
                zone = hardGeometry(item, forward)
                if zone is None:
                    continue
                startConnector = LineString([actualStart, snappedStart])
                endConnector = LineString([snappedEnd, actualEnd])
                escapeConnector = item.evidenceType != EvidenceType.CONFIRMED_CLOSURE and zone.covers(actualStart) and zone.covers(snappedStart)
                if (startConnector.length > 0.01 and startConnector.intersects(zone) and not escapeConnector) or (endConnector.length > 0.01 and endConnector.intersects(zone)):
                    result.feasible = False
                    result.reasons.extend(['ENDPOINT_HAZARD_CONNECTION_UNKNOWN', 'AUTHORITATIVE_HAZARD_INTERSECTION', 'ROUTE_REJECTED_CRITICAL_HAZARD'])
        if route.durationSec > ROUTE_OPERATIONAL_MAX_SECONDS:
            result.feasible = False
            result.reasons.append('HARD_OPERATIONAL_LIMIT_EXCEEDED')
        return result

    routes = await provider.routes(origin, destination, maxCandidates=ROUTE_MAX_ALTERNATIVES, **routingOptions) if hasattr(provider, 'routes') else [await provider.route(origin, destination, **routingOptions)]
    await loadEvidence(routes)
    evaluated = []
    for index, route in enumerate(routes[:ROUTE_MAX_ALTERNATIVES]):
        if not equivalent(route, evaluated):
            evaluated.append(await evaluate(route, f'{prefix}-{index + 1}'))
    if any(item.feasible for item in evaluated):
        return evaluated
    attempts = detourWaypoints(origin, destination, evidence, [item.route for item in evaluated])
    logger.info('hazardDetour result=attempt candidateSets=%s rejected=%s', len(attempts), len(evaluated))
    detourRoutes = []
    for index, waypoints in enumerate(attempts):
        try:
            if hasattr(provider, 'routes'):
                detours = await provider.routes(origin, destination, waypoints=waypoints, maxCandidates=1, **routingOptions)
            else:
                legs = []
                points = [origin, *waypoints, destination]
                for first, second in zip(points, points[1:]):
                    legs.append(await provider.route(first, second, **routingOptions))
                coordinates = []
                for leg in legs:
                    points = leg.geometry.get('coordinates', [])
                    if not points or (coordinates and coordinates[-1] != points[0]):
                        raise NoRoute('disconnected detour legs')
                    coordinates.extend(points[1:] if coordinates else points)
                detours = [RouteData(sum(leg.distanceM for leg in legs), sum(leg.durationSec for leg in legs), {'type': 'LineString', 'coordinates': coordinates})]
            for route in detours[:1]:
                if equivalent(route, evaluated):
                    continue
                detourRoutes.append((route, f'{prefix}-detour-{index + 1}'))
        except (NoRoute, RoutingUnavailable):
            continue
    await loadEvidence([route for route, _ in detourRoutes])
    for route, routeId in detourRoutes:
        if equivalent(route, evaluated):
            continue
        result = await evaluate(route, routeId)
        result.reasons.append('HAZARD_DETOUR_GENERATED')
        evaluated.append(result)
    logger.info('hazardDetour result=%s generated=%s', 'success' if any(item.feasible for item in evaluated) else 'failure', len(evaluated))
    return evaluated
