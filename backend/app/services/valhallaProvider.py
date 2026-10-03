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
    accessibilityEvidence: list[dict] = field(default_factory=list)


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

    async def route(self, origin: tuple[float, float], destination: tuple[float, float]) -> RouteData:
        return (await self.routes(origin, destination, maxCandidates=1))[0]

    async def routes(self, origin: tuple[float, float], destination: tuple[float, float], waypoints: list[tuple[float, float]] | None = None, maxCandidates: int = ROUTE_MAX_ALTERNATIVES) -> list[RouteData]:
        locations = [origin, *(waypoints or []), destination]
        payload = {'locations': [{'lat': point[0], 'lon': point[1], 'type': 'break'} for point in locations], 'costing': 'pedestrian', 'units': 'kilometers', 'shape_format': 'geojson'}
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
                if trip.get('geometry'):
                    shapes = [trip['geometry']]
                else:
                    shapes = [leg['shape'] for leg in trip['legs']]
                for geometry in shapes:
                    geometry = decodePolyline(geometry) if isinstance(geometry, str) else geometry
                    if not isinstance(geometry, dict) or geometry.get('type') != 'LineString':
                        raise ValueError('route geometry is not a GeoJSON LineString')
                    legCoordinates = geometry['coordinates']
                    if coordinates and coordinates[-1] != legCoordinates[0]:
                        raise ValueError('disconnected Valhalla legs')
                    coordinates.extend(legCoordinates[1:] if coordinates else legCoordinates)
                distance, duration = float(summary['length']) * 1000, float(summary['time'])
                from math import isfinite
                if not isfinite(distance) or not isfinite(duration) or distance <= 0 or duration <= 0:
                    raise ValueError('invalid route summary')
                routes.append(RouteData(distanceM=distance, durationSec=duration, geometry={'type': 'LineString', 'coordinates': coordinates}))
            return routes
        except (KeyError, TypeError, ValueError, IndexError) as error:
            raise NoRoute(str(error))
