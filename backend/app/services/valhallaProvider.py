from dataclasses import dataclass

import httpx

from app.config import VALHALLA_TIMEOUT_SECONDS, VALHALLA_URL


class RoutingUnavailable(Exception):
    pass


class NoRoute(Exception):
    pass


@dataclass
class RouteData:
    distanceM: float
    durationSec: float
    geometry: dict


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
        payload = {'locations': [{'lat': origin[0], 'lon': origin[1]}, {'lat': destination[0], 'lon': destination[1]}], 'costing': 'pedestrian', 'units': 'kilometers', 'shape_format': 'geojson'}
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
            trip = response.json()['trip']
            summary = trip['summary']
            geometry = trip.get('geometry') or trip['legs'][0].get('shape')
            if isinstance(geometry, str):
                geometry = decodePolyline(geometry)
            if not isinstance(geometry, dict):
                raise ValueError('route geometry is not GeoJSON')
            return RouteData(distanceM=float(summary['length']) * 1000, durationSec=float(summary['time']), geometry=geometry)
        except (KeyError, TypeError, ValueError) as error:
            raise NoRoute(str(error))
