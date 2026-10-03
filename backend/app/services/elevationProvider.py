from dataclasses import dataclass
from math import atan, degrees, isfinite
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.errors import RasterioError

from app.config import DEM_ASSET_PATH, DEM_SOURCE, DEM_VERTICAL_DATUM
from app.utils.geo import calculate_distance_meters


@dataclass
class ElevationProfile:
    elevations: list[float | None]
    source: str = 'UNKNOWN'
    verticalDatum: str = 'UNKNOWN'
    resolution: tuple[float, float] | None = None
    slopeMeanDegrees: float | None = None


class ElevationProvider:
    def __init__(self, assetPath: str = DEM_ASSET_PATH, source: str = DEM_SOURCE, verticalDatum: str = DEM_VERTICAL_DATUM):
        self.assetPath = assetPath
        self.source = source
        self.verticalDatum = verticalDatum

    def health(self) -> dict:
        status = {'status': 'unknown', 'source': self.source, 'verticalDatum': self.verticalDatum}
        if not self.assetPath or self.source == 'UNKNOWN' or self.verticalDatum == 'UNKNOWN':
            return status
        try:
            with rasterio.open(self.assetPath) as dataset:
                if dataset.crs is not None and dataset.count == 1:
                    status['status'] = 'available'
                    status['resolution'] = dataset.res
                    status['crs'] = dataset.crs.to_string()
        except (RasterioError, ValueError, OSError):
            status['status'] = 'degraded'
        return status

    def sample(self, coordinates: list[list[float]]) -> ElevationProfile:
        unknown = ElevationProfile([None] * len(coordinates))
        if not self.assetPath or not Path(self.assetPath).is_file() or self.source == 'UNKNOWN' or self.verticalDatum == 'UNKNOWN':
            return unknown
        try:
            with rasterio.open(self.assetPath) as dataset:
                if dataset.crs is None or dataset.count != 1:
                    return unknown
                project = Transformer.from_crs(4326, dataset.crs, always_xy=True)
                points = [project.transform(*point[:2]) for point in coordinates]
                values = []
                for point, sample in zip(points, dataset.sample(points, masked=True)):
                    inside = dataset.bounds.left <= point[0] < dataset.bounds.right and dataset.bounds.bottom < point[1] <= dataset.bounds.top
                    value = None if not inside or np.ma.getmaskarray(sample)[0] else float(sample[0])
                    values.append(value if value is not None and isfinite(value) else None)
                slopes = []
                for start, end, first, second in zip(coordinates, coordinates[1:], values, values[1:]):
                    distance = calculate_distance_meters(start[1], start[0], end[1], end[0])
                    if first is not None and second is not None and distance > 0:
                        slopes.append(degrees(atan(abs(second - first) / distance)))
                return ElevationProfile(values, self.source, self.verticalDatum, dataset.res, sum(slopes) / len(slopes) if slopes else None)
        except (RasterioError, ValueError, OSError):
            return unknown
