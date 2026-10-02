import math
from dataclasses import dataclass, field

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
    maneuvers: list = field(default_factory=list)


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
        payload = {'locations': [{'lat': origin[0], 'lon': origin[1]}, {'lat': destination[0], 'lon': destination[1]}], 'costing': 'pedestrian', 'units': 'kilometers', 'shape_format': 'geojson'}
        if profile == 'WHEELCHAIR':
            payload['costing_options'] = {'pedestrian': {'type': 'wheelchair', 'step_penalty': 100000, 'max_hiking_difficulty': 0}}
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
            legs = trip.get('legs')
            geometry = trip.get('geometry')
            if not geometry:
                if not isinstance(legs, list) or not legs:
                    raise ValueError('route has no legs')
                geometry = legs[0].get('shape')
            if isinstance(geometry, str):
                geometry = decodePolyline(geometry)
            if not isValidLineString(geometry):
                raise ValueError('route geometry is not a valid LineString')
            distanceM = float(summary['length']) * 1000
            durationSec = float(summary['time'])
            if not math.isfinite(distanceM) or not math.isfinite(durationSec) or distanceM < 0 or durationSec < 0:
                raise ValueError('route summary is invalid')
            maneuvers = []
            for maneuver in (legs[0].get('maneuvers', []) if legs else []):
                begin, end = int(maneuver['begin_shape_index']), int(maneuver['end_shape_index'])
                if not 0 <= begin <= end < len(geometry['coordinates']):
                    raise ValueError('invalid maneuver shape indices')
                maneuver_distance = float(maneuver.get('length', 0)) * 1000
                maneuver_time = float(maneuver.get('time', 0))
                if not isFiniteNumber(maneuver_distance) or not isFiniteNumber(maneuver_time) or maneuver_distance < 0 or maneuver_time < 0:
                    raise ValueError('invalid maneuver summary')
                maneuvers.append({'instruction': str(maneuver['instruction']), 'beginShapeIndex': begin, 'endShapeIndex': end, 'distanceM': maneuver_distance, 'durationSec': maneuver_time, 'type': int(maneuver.get('type', 0))})
            return RouteData(distanceM=distanceM, durationSec=durationSec, geometry=geometry, maneuvers=maneuvers)
        except (KeyError, TypeError, ValueError, AttributeError) as error:
            raise NoRoute(str(error))
