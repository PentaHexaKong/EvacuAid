import json
import hashlib
from datetime import datetime, timezone
from pathlib import Path

import httpx
from pyproj import Transformer
from shapely.geometry import mapping, shape
from shapely.ops import transform

from app import config
from app.models.hazard import Authority, EvidenceType, HazardEvidence, HazardType
from app.services.hazardProviders import getData, stableId
from app.utils.hazardGeometry import normalizedGeometry


SERVICES = {'FLOOD': 'layer_bahaya_banjir', 'EARTHQUAKE': 'layer_bahaya_gempabumi', 'TSUNAMI': 'layer_bahaya_tsunami', 'WILDFIRE': 'layer_bahaya_kebakaran_hutan_dan_lahan', 'LANDSLIDE': 'layer_bahaya_tanah_longsor'}


async def prepareInarisk(hazardType: str, bbox: str, output: str, serviceUrl: str | None = None) -> dict:
    west, south, east, north = [float(value) for value in bbox.split(',')]
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90) or east - west > 2 or north - south > 2:
        raise ValueError('prepare a bounded local area, at most two degrees per axis')
    url = (serviceUrl or f'{config.INARISK_BASE_URL}/{SERVICES[hazardType]}/ImageServer').rstrip('/')
    path = Path(output)
    path.parent.mkdir(parents=True, exist_ok=True)
    async with httpx.AsyncClient(timeout=60) as client:
        metadata = (await getData(client, url, {'f': 'json'})).json()
        if 'error' in metadata:
            raise ValueError('InaRISK metadata unavailable')
        if '/ImageServer' in url:
            if metadata.get('bandCount') != 1 or 'Image' not in metadata.get('capabilities', ''):
                raise ValueError('unsupported InaRISK ImageServer')
            response = await getData(client, f'{url}/exportImage', {'f': 'image', 'bbox': bbox, 'bboxSR': 4326, 'imageSR': 4326, 'size': '1024,1024', 'format': 'tiff', 'pixelType': metadata.get('pixelType', 'F32'), 'interpolation': 'RSP_NearestNeighbor'})
            path.write_bytes(response.content)
        else:
            if metadata.get('type') != 'Feature Layer' or 'Query' not in metadata.get('capabilities', ''):
                raise ValueError('MapServer raster layers require ImageServer extraction; select a queryable Feature Layer')
            features = []
            offset = 0
            while True:
                result = (await getData(client, f'{url}/query', {'f': 'geojson', 'where': '1=1', 'geometry': bbox, 'geometryType': 'esriGeometryEnvelope', 'inSR': 4326, 'outSR': 4326, 'spatialRel': 'esriSpatialRelIntersects', 'outFields': '*', 'resultOffset': offset, 'resultRecordCount': 1000})).json()
                if 'error' in result:
                    raise ValueError('InaRISK spatial query failed')
                batch = result.get('features', [])
                features.extend(batch)
                if len(features) > config.HAZARD_MAX_EVIDENCE:
                    raise ValueError('InaRISK extraction exceeds configured bound')
                if not result.get('exceededTransferLimit') and len(batch) < 1000:
                    break
                if not metadata.get('advancedQueryCapabilities', {}).get('supportsPagination'):
                    raise ValueError('layer requires pagination; narrow extraction area')
                offset += len(batch)
                if not batch:
                    break
            path.write_text(json.dumps({'type': 'FeatureCollection', 'features': features}))
    manifest = {'source': 'BNPB InaRISK', 'hazardType': hazardType, 'sourceUrl': url, 'bbox': [west, south, east, north], 'serviceMetadata': metadata, 'baselineOnly': True, 'preparedAt': datetime.now(timezone.utc).isoformat(), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
    Path(f'{output}.json').write_text(json.dumps(manifest, indent=2))
    return manifest


def baselineFromGeojson(path: str, hazardType: str, sourceUrl: str, severityField: str | None = None) -> list[HazardEvidence]:
    payload = json.loads(Path(path).read_text())
    result = []
    for feature in payload['features']:
        geometry = normalizedGeometry(feature['geometry'])
        properties = feature.get('properties') or {}
        severity = properties.get(severityField) if severityField else None
        result.append(HazardEvidence(sourceId=stableId(json.dumps([sourceUrl, hazardType, feature.get('id'), geometry, properties], sort_keys=True)), hazardType=HazardType(hazardType), source='INARISK', authority=Authority.OFFICIAL, evidenceType=EvidenceType.BASELINE_HAZARD, geometry=geometry, severity=severity, metadata={'attribution': 'BNPB InaRISK', 'sourceUrl': sourceUrl, 'sourceProperties': properties, 'baselineOnly': True}))
    return result


def baselineFromRaster(path: str, hazardType: str, sourceUrl: str, minimum: float) -> list[HazardEvidence]:
    import numpy as np
    import rasterio
    from rasterio.features import shapes

    result = []
    with rasterio.open(path) as dataset:
        if dataset.crs is None or dataset.count != 1 or dataset.width * dataset.height > 4_194_304:
            raise ValueError('prepared raster requires CRS, one band and bounded dimensions')
        values = dataset.read(1, masked=True)
        mask = (~np.ma.getmaskarray(values)) & np.isfinite(values.data) & (values.data >= minimum)
        project = Transformer.from_crs(dataset.crs, 4326, always_xy=True).transform
        for geometry, value in shapes(mask.astype('uint8'), mask=mask, transform=dataset.transform):
            geographic = mapping(transform(project, shape(geometry)))
            result.append(HazardEvidence(sourceId=stableId(json.dumps([sourceUrl, hazardType, minimum, geographic], sort_keys=True)), hazardType=hazardType, source='INARISK', authority=Authority.OFFICIAL, evidenceType=EvidenceType.BASELINE_HAZARD, geometry=normalizedGeometry(geographic), metadata={'attribution': 'BNPB InaRISK', 'sourceUrl': sourceUrl, 'rasterAsset': str(path), 'minimumSourceValue': minimum, 'thresholdPolicy': 'EXPERIMENTAL', 'sourceResolution': dataset.res, 'sourceCrs': dataset.crs.to_string(), 'baselineOnly': True}))
            if len(result) > config.HAZARD_MAX_EVIDENCE:
                raise ValueError('prepared geometry count exceeds bound')
    return result
