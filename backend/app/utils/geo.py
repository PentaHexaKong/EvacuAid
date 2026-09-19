"""Geographic helpers used by the risk aggregation service."""

from __future__ import annotations

from math import asin, cos, radians, sin, sqrt


def calculate_distance_meters(
    user_lat: float,
    user_lon: float,
    event_lat: float,
    event_lon: float,
) -> float:
    """Return the great-circle distance between two WGS84 points in metres."""
    earth_radius_m = 6_371_000
    lat_delta = radians(event_lat - user_lat)
    lon_delta = radians(event_lon - user_lon)
    haversine = (
        sin(lat_delta / 2) ** 2
        + cos(radians(user_lat))
        * cos(radians(event_lat))
        * sin(lon_delta / 2) ** 2
    )
    return 2 * earth_radius_m * asin(sqrt(haversine))

