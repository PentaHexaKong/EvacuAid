import math
from dataclasses import dataclass, field

import httpx

from app.config import VALHALLA_TIMEOUT_SECONDS, VALHALLA_URL
from app.config import ROUTE_MAX_ALTERNATIVES


class RoutingUnavailable(Exception):
    pass


class NoRoute(Exception):
    pass


@dataclass
class RouteData:
    distanceM: float
    durationSec: float
    geometry: dict
    maneuvers: list = field(default_factory=list)
    accessibilityEvidence: list[dict] = field(default_factory=list)


def isFiniteNumber(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def isValidLineString(geometry) -> bool:
    if not isinstance(geometry, dict) or geometry.get('type') != 'LineString':
        return False
    coordinates = geometry.get('coordinates')
    if not isinstance(coordinates, list) or len(coordinates) < 2:
        return False
    return all(isinstance(point, (list, tuple)) and len(point) >= 2 and all(isFiniteNumber(item) for item in point) for point in coordinates)


def decodePolyline(shape: str) -> dict:
    coordinates = []
    latitude = 0
    longitude = 0
    index = 0
    while index < len(shape):
        values = []
        for _ in range(2):
            shift = 0
            value = 0
            while True:
                if index >= len(shape):
                    raise ValueError('invalid encoded route geometry')
                encoded = ord(shape[index]) - 63
                index += 1
                value |= (encoded & 0x1F) << shift
                shift += 5
                if encoded < 0x20:
                    break
            values.append(~(value >> 1) if value & 1 else value >> 1)
        latitude += values[0]
        longitude += values[1]
        coordinates.append([longitude / 1_000_000, latitude / 1_000_000])
    if len(coordinates) < 2:
        raise ValueError('route geometry has fewer than two points')
    return {'type': 'LineString', 'coordinates': coordinates}


def parseManeuvers(leg: dict, coordinateCount: int, offset: int = 0) -> list:
    maneuvers = []
    for maneuver in leg.get('maneuvers', []):
        begin, end = int(maneuver['begin_shape_index']), int(maneuver['end_shape_index'])
        if not 0 <= begin <= end < coordinateCount:
            raise ValueError('invalid maneuver shape indices')
        maneuver_distance = float(maneuver.get('length', 0)) * 1000
        maneuver_time = float(maneuver.get('time', 0))
        if not isFiniteNumber(maneuver_distance) or not isFiniteNumber(maneuver_time) or maneuver_distance < 0 or maneuver_time < 0:
            raise ValueError('invalid maneuver summary')
        maneuvers.append({'instruction': str(maneuver['instruction']), 'beginShapeIndex': begin + offset, 'endShapeIndex': end + offset, 'distanceM': maneuver_distance, 'durationSec': maneuver_time, 'type': int(maneuver.get('type', 0))})
    return maneuvers


class ValhallaRoutingProvider:
    def __init__(self, baseUrl: str = VALHALLA_URL, timeoutSeconds: float = VALHALLA_TIMEOUT_SECONDS):
        self.baseUrl = baseUrl
        self.timeoutSeconds = timeoutSeconds

    async def health(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=self.timeoutSeconds) as client:
                response = await client.get(f'{self.baseUrl}/status')
                return response.is_success
        except httpx.HTTPError:
            return False

    async def route(self, origin: tuple[float, float], destination: tuple[float, float], profile: str = 'WALKING') -> RouteData:
        return (await self.routes(origin, destination, maxCandidates=1, profile=profile))[0]

    async def routes(self, origin: tuple[float, float], destination: tuple[float, float], waypoints: list[tuple[float, float]] | None = None, maxCandidates: int = ROUTE_MAX_ALTERNATIVES, profile: str = 'WALKING') -> list[RouteData]:
        locations = [origin, *(waypoints or []), destination]
        payload = {'locations': [{'lat': point[0], 'lon': point[1], 'type': 'break'} for point in locations], 'costing': 'pedestrian', 'units': 'kilometers', 'shape_format': 'geojson'}
        if profile == 'WHEELCHAIR':
            payload['costing_options'] = {'pedestrian': {'type': 'wheelchair', 'step_penalty': 100000, 'max_hiking_difficulty': 0}}
        if not waypoints and maxCandidates > 1:
            payload['alternates'] = min(maxCandidates - 1, ROUTE_MAX_ALTERNATIVES - 1)
        try:
            async with httpx.AsyncClient(timeout=self.timeoutSeconds) as client:
                response = await client.post(f'{self.baseUrl}/route', json=payload)
        except httpx.HTTPError as error:
            raise RoutingUnavailable(str(error))
        if response.status_code in (400, 404):
            raise NoRoute('no route available')
        if not response.is_success:
            raise RoutingUnavailable(f'valhalla returned {response.status_code}')
        try:
            body = response.json()
            trips = [body['trip']] + [item['trip'] for item in body.get('alternates', [])]
            routes = []
            for trip in trips[:maxCandidates]:
                summary = trip['summary']
                coordinates = []
                maneuvers = []
                if trip.get('geometry'):
                    shapes = [trip['geometry']]
                else:
                    shapes = [leg['shape'] for leg in trip['legs']]
                for geometry, leg in zip(shapes, trip.get('legs') or [{}]):
                    geometry = decodePolyline(geometry) if isinstance(geometry, str) else geometry
                    if not isValidLineString(geometry):
                        raise ValueError('route geometry is not a GeoJSON LineString')
                    legCoordinates = geometry['coordinates']
                    if coordinates and coordinates[-1] != legCoordinates[0]:
                        raise ValueError('disconnected Valhalla legs')
                    maneuvers.extend(parseManeuvers(leg, len(legCoordinates), len(coordinates) - 1 if coordinates else 0))
                    coordinates.extend(legCoordinates[1:] if coordinates else legCoordinates)
                distance, duration = float(summary['length']) * 1000, float(summary['time'])
                from math import isfinite
                if not isfinite(distance) or not isfinite(duration) or distance <= 0 or duration <= 0:
                    raise ValueError('invalid route summary')
                routes.append(RouteData(distanceM=distance, durationSec=duration, geometry={'type': 'LineString', 'coordinates': coordinates}, maneuvers=maneuvers))
            return routes
        except (KeyError, TypeError, ValueError, IndexError, AttributeError, OverflowError) as error:
            raise NoRoute(str(error))
