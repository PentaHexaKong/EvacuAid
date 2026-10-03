import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import rasterio
from rasterio.shutil import copy as copyRaster


def prepareDem(inputPath: str, outputPath: str, source: str, sourceUrl: str, verticalDatum: str) -> dict:
    if source == 'UNKNOWN' or verticalDatum == 'UNKNOWN' or not sourceUrl:
        raise ValueError('DEM preparation requires independently verified provenance and vertical datum')
    with rasterio.open(inputPath) as dataset:
        if dataset.crs is None or dataset.count != 1:
            raise ValueError('DEM must have a declared CRS and one elevation band in meters')
        metadata = {'source': source, 'sourceUrl': sourceUrl, 'verticalDatum': verticalDatum, 'units': 'meters', 'crs': dataset.crs.to_string(), 'resolution': dataset.res, 'bounds': list(dataset.bounds), 'nodata': dataset.nodata, 'preparedAt': datetime.now(timezone.utc).isoformat()}
    output = Path(outputPath)
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.resolve() == Path(inputPath).resolve():
        raise ValueError('prepared asset must differ from input asset')
    copyRaster(inputPath, outputPath, driver='COG', compress='DEFLATE')
    digest = hashlib.sha256()
    with output.open('rb') as asset:
        for chunk in iter(lambda: asset.read(1_048_576), b''):
            digest.update(chunk)
    metadata['sha256'] = digest.hexdigest()
    Path(f'{outputPath}.json').write_text(json.dumps(metadata, indent=2))
    return metadata
