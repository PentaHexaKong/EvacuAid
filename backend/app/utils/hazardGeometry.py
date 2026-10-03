from math import ceil, isfinite

from pyproj import CRS, Transformer
from shapely import make_valid
from shapely.errors import GEOSException
from shapely.geometry import LineString, mapping, shape
from shapely.ops import substring, transform, unary_union

from app.config import HAZARD_MAX_SAMPLES, HAZARD_SAMPLE_METERS


def validGeometry(value: dict):
    try:
        geometry = shape(value)
        if geometry.is_empty or not all(isfinite(x) for x in geometry.bounds):
            return None
        west, south, east, north = geometry.bounds
        if west < -180 or east > 180 or south < -90 or north > 90 or east - west > 180:
            return None
        if not geometry.is_valid:
            geometry = make_valid(geometry)
            if geometry.geom_type == 'GeometryCollection':
                geometry = unary_union([part for part in geometry.geoms if part.geom_type in {'Polygon', 'MultiPolygon'}])
        return geometry if not geometry.is_empty and geometry.is_valid else None
    except (ValueError, TypeError, KeyError, AttributeError, IndexError, GEOSException):
        return None


def projection(geometry):
    center = geometry.centroid
    local = CRS.from_proj4(f'+proj=aeqd +lat_0={center.y} +lon_0={center.x} +datum=WGS84 +units=m')
    forward = Transformer.from_crs(4326, local, always_xy=True).transform
    reverse = Transformer.from_crs(local, 4326, always_xy=True).transform
    return forward, reverse


def sampleSegments(line):
    count = min(HAZARD_MAX_SAMPLES, max(1, ceil(line.length / HAZARD_SAMPLE_METERS)))
    return [substring(line, index / count, (index + 1) / count, normalized=True) for index in range(count)]


def metricGeometry(value: dict, forward):
    geometry = validGeometry(value)
    return transform(forward, geometry) if geometry is not None else None


def normalizedGeometry(value: dict) -> dict:
    geometry = validGeometry(value)
    if geometry is None:
        raise ValueError('invalid or unsupported geographic geometry')
    return mapping(geometry)
