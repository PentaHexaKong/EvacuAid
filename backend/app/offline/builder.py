import asyncio
import hashlib
import json
import os
import shutil
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from pyproj import Transformer
from shapely.geometry import box, mapping, shape
from shapely.ops import transform
from sqlalchemy import text

from app.db.session import SessionLocal
from app.offline.manifest import Asset, canonical, digest_file, sign, validate
from app.offline.store import root, write_json
from app.offline.graph import regional_tiles


def public_url(value):
    if not isinstance(value, str):
        return None
    parsed = urlsplit(value)
    if parsed.scheme not in {'https', 'http'} or not parsed.hostname:
        return None
    return urlunsplit((parsed.scheme, parsed.hostname, parsed.path, '', ''))


async def snapshot(region_id: str, buffer_m: float) -> dict:
    # A single database snapshot keeps the public exports coherent. No user tables.
    async with SessionLocal() as session, session.begin():
        await session.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY'))
        region = (await session.execute(text("""
            SELECT id, name, boundary_source, data_mode, ST_AsGeoJSON(geometry) AS geometry
            FROM command_regions WHERE id = :id AND data_mode = 'REFERENCE'
        """), {'id': region_id})).mappings().one_or_none()
        if region is None:
            raise ValueError('Reference region not found')
        geometry = shape(json.loads(region['geometry']))
        center = geometry.centroid
        metric = f'+proj=aeqd +lat_0={center.y} +lon_0={center.x} +datum=WGS84 +units=m'
        forward = Transformer.from_crs('EPSG:4326', metric, always_xy=True).transform
        inverse = Transformer.from_crs(metric, 'EPSG:4326', always_xy=True).transform
        coverage = transform(inverse, transform(forward, geometry).buffer(buffer_m))
        coverage_json = json.dumps(mapping(coverage))
        shelters = (await session.execute(text("""
            SELECT id, name, latitude, longitude, entrance_latitude, entrance_longitude,
                   status, capacity, current_occupancy, wheelchair_accessible,
                   medical_support, source, verified_at, updated_at
            FROM shelters
            WHERE ST_Intersects(location::geometry, ST_SetSRID(ST_GeomFromGeoJSON(:geometry),4326))
              AND source NOT IN ('DEMO_FIXTURE','SIMULATION')
            ORDER BY id LIMIT 10001
        """), {'geometry': coverage_json})).mappings().all()
        # Private citizen/community observations are deliberately not exported.
        hazards = (await session.execute(text("""
            SELECT source_id, hazard_type, source, authority, evidence_type,
                   ST_AsGeoJSON(geometry) AS geometry, severity, confidence,
                   observed_at, valid_from, valid_until, metadata
            FROM hazard_evidence
            WHERE authority IN ('OFFICIAL','SATELLITE_OBSERVATION')
              AND source NOT IN ('DEMO_FIXTURE','SIMULATION','COMMAND_SIMULATION')
              AND COALESCE(metadata->>'dataMode','') <> 'SIMULATION'
              AND ST_Intersects(geometry, ST_SetSRID(ST_GeomFromGeoJSON(:geometry),4326))
            ORDER BY source, source_id LIMIT 10001
        """), {'geometry': coverage_json})).mappings().all()
        if len(shelters) > 10000 or len(hazards) > 10000:
            raise ValueError('Public snapshot exceeds package limits')
        def timestamp(value):
            return value.isoformat() if value else None
        public_shelters = [
            {'id': str(s['id']), 'name': s['name'], 'latitude': s['latitude'], 'longitude': s['longitude'],
             'entranceLatitude': s['entrance_latitude'], 'entranceLongitude': s['entrance_longitude'],
             'status': s['status'], 'capacity': s['capacity'], 'currentOccupancy': s['current_occupancy'],
             'wheelchairAccessible': s['wheelchair_accessible'], 'medicalSupport': s['medical_support'],
             'source': s['source'], 'verifiedAt': timestamp(s['verified_at']), 'updatedAt': timestamp(s['updated_at'])}
            for s in shelters
        ]
        public_hazards = [
            {'sourceId': h['source_id'], 'hazardType': h['hazard_type'], 'source': h['source'],
             'authority': h['authority'], 'evidenceType': h['evidence_type'],
             'geometry': json.loads(h['geometry']), 'severity': h['severity'], 'confidence': h['confidence'],
             'observedAt': timestamp(h['observed_at']), 'validFrom': timestamp(h['valid_from']),
             'validUntil': timestamp(h['valid_until']),
             'metadata': {**{k: h['metadata'][k] for k in ('confirmedDamage',) if k in h['metadata']},
                          'sourceUrl': public_url(h['metadata'].get('sourceUrl'))}}
            for h in hazards
        ]
        return {'regionId': str(region['id']), 'regionName': region['name'], 'boundarySource': region['boundary_source'],
                'boundary': mapping(geometry), 'bbox': list(coverage.bounds), 'coverage': mapping(coverage),
                'shelters': public_shelters, 'hazards': public_hazards}


def assemble(data: dict, spec: dict, signing_key: Ed25519PrivateKey, key_id: str, now=None) -> dict:
    """Runs in a worker thread, never an HTTP handler. Assets are content-addressed."""
    now = now or datetime.now(timezone.utc)
    storage = root()
    assets = []
    objects = storage / 'objects'
    objects.mkdir(parents=True, exist_ok=True)

    def add(path, kind, content=None, source=None):
        if content is not None:
            encoded = canonical(content)
            digest = hashlib.sha256(encoded).hexdigest()
            target = objects / digest
            if not target.exists():
                temporary = objects / (digest + '.' + os.urandom(8).hex() + '.tmp')
                temporary.write_bytes(encoded)
                os.replace(temporary, target)
        else:
            source = Path(source)
            if source.is_symlink() or not source.is_file():
                raise ValueError('Asset must be a regular file')
            digest = digest_file(source)
            target = objects / digest
            if not target.exists():
                temporary = objects / (digest + '.' + os.urandom(8).hex() + '.tmp')
                try:
                    shutil.copyfile(source, temporary)
                    if digest_file(temporary) != digest:
                        raise ValueError('Source asset changed during build')
                    os.replace(temporary, target)
                finally:
                    temporary.unlink(missing_ok=True)
        assets.append(Asset(path=path, kind=kind, sha256=digest, sizeBytes=target.stat().st_size).model_dump())

    if not box(*spec['coverageBbox']).covers(box(*data['bbox'])):
        raise ValueError('Static assets do not cover the region plus requested buffer')
    map_file = Path(spec['mapFile'])
    if map_file.stat().st_size > 16 * 1024 * 1024:
        raise ValueError('Map GeoJSON exceeds 16 MiB; prepare a smaller region')
    map_data = json.loads(map_file.read_text(encoding='utf-8-sig'))
    if map_data.get('type') != 'FeatureCollection' or len(map_data.get('features', [])) > 10000:
        raise ValueError('Expected a bounded public map FeatureCollection')
    features = []
    area = shape(data['coverage'])
    for feature in map_data['features']:
        geometry = shape(feature['geometry'])
        if not geometry.is_valid:
            raise ValueError('Invalid map geometry')
        clipped = geometry.intersection(area)
        if not clipped.is_empty:
            # No arbitrary feature metadata crosses the public package boundary.
            features.append({'type': 'Feature', 'geometry': mapping(clipped), 'properties': {}})
    add('map/streets.geojson', 'map', {'type': 'FeatureCollection', 'features': features})
    add('map/boundary.geojson', 'map', {'type': 'Feature', 'geometry': data['boundary'], 'properties': {}})
    add('map/coverage.geojson', 'map', {'type': 'Feature', 'geometry': data['coverage'], 'properties': {}})
    graph_directory = Path(spec['graphDirectory'])
    if graph_directory.is_symlink():
        raise ValueError('Graph symlinks are not supported')
    graph_files = regional_tiles(graph_directory, data['bbox'])
    if not graph_files or len(graph_files) > 19990 or spec['routingEngineVersion'] != '3.9.0':
        raise ValueError('Valhalla 3.9.0 graph tiles are required')
    if any(p.is_symlink() for p in graph_directory.rglob('*')):
        raise ValueError('Graph symlinks are not supported')
    for source in graph_files:
        add('routing/' + source.relative_to(graph_directory).as_posix(), 'routing', source=source)
    add('hazards/evidence.json', 'hazards', data['hazards'])
    add('shelters/shelters.json', 'shelters', data['shelters'])
    # Existing route origins may be private. Do not export citizen navigation logs.
    add('cached-routes/routes.json', 'cached-routes', [])
    map_version = hashlib.sha256(canonical([a for a in assets if a['kind'] == 'map'])).hexdigest()
    graph_version = hashlib.sha256(canonical([a for a in assets if a['kind'] == 'routing'])).hexdigest()
    expiries = [h['validUntil'] for h in data['hazards']]
    evidence_until = min(datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(timezone.utc)
                         for value in expiries).isoformat() if expiries and all(expiries) else None
    manifest = {'schemaVersion': 1, 'regionId': data['regionId'], 'regionName': data['regionName'],
        'bbox': data['bbox'], 'generatedAt': now.isoformat(), 'expiresAt': (now + timedelta(days=7)).isoformat(),
        'mapDataVersion': map_version, 'routingEngine': 'valhalla', 'routingEngineVersion': '3.9.0',
        'graphVersion': graph_version, 'graphCompatibility': 'UNVERIFIED',
        'hazardSnapshotAt': now.isoformat(), 'hazardEvidenceValidUntil': evidence_until,
        'packageSizeBytes': sum(a['sizeBytes'] for a in assets), 'assets': assets,
        'contentChecksums': {a['path']: a['sha256'] for a in assets},
        'sourceProvenance': {'boundary': data['boundarySource'], 'map': public_url(spec['mapSourceUrl']),
                             'routing': public_url(spec['routingSourceUrl']), 'mapAttribution': spec['mapAttribution'],
                             'staticDatasetGeneratedAt': spec['datasetGeneratedAt'],
                             'mapDatasetGeneratedAt': spec.get('mapDatasetGeneratedAt'),
                             'graphDatasetGeneratedAt': spec.get('graphDatasetGeneratedAt')},
        'capabilities': {'offlineMap': True, 'routingGraph': True, 'nativeRouting': False,
                         'hazardEvaluation': False, 'cachedRoutes': False, 'communityEvidence': False,
                         'wheelchairRouting': False},
        'warnings': ['NATIVE_ROUTING_UNVERIFIED', 'NO_OFFLINE_HAZARD_POLICY', 'SAFETY_NOT_VERIFIED']}
    if not manifest['sourceProvenance']['map'] or not manifest['sourceProvenance']['routing']:
        raise ValueError('Public map and routing provenance URLs are required')
    manifest['packageId'] = hashlib.sha256(canonical(manifest)).hexdigest()
    manifest = sign(manifest, signing_key, key_id)
    validate(manifest)
    if any(a['kind'] != 'routing' and a['sizeBytes'] > 16 * 1024 * 1024 for a in assets):
        raise ValueError('Display assets exceed the on-device limit')
    package_dir = storage / 'packages' / manifest['packageId']
    package_dir.mkdir(parents=True, exist_ok=True)
    write_json(package_dir / 'manifest.json', manifest)
    temporary_zip = package_dir / 'package.zip.tmp'
    with zipfile.ZipFile(temporary_zip, 'w', compression=zipfile.ZIP_STORED) as archive:
        archive.write(package_dir / 'manifest.json', 'manifest.json')
        for asset in assets:
            archive.write(objects / asset['sha256'], asset['path'])
    os.replace(temporary_zip, package_dir / 'package.zip')
    # The last valid package stays published until this complete build succeeds.
    write_json(storage / 'regions' / data['regionId'] / 'latest.json', {'packageId': manifest['packageId']})
    return manifest


async def build(job: dict):
    catalog = json.loads(Path(os.environ['OFFLINE_ASSET_CATALOG']).read_text(encoding='utf-8-sig'))
    spec = catalog['regions'][job['regionId']]
    key = serialization.load_pem_private_key(Path(os.environ['OFFLINE_SIGNING_KEY_PATH']).read_bytes(), password=None)
    if not isinstance(key, Ed25519PrivateKey):
        raise ValueError('Offline signing requires an Ed25519 private key')
    buffer_m = float(spec.get('bufferMeters', 1000))
    if not 0 <= buffer_m <= 20000:
        raise ValueError('Invalid region buffer')
    data = await snapshot(job['regionId'], buffer_m)
    return await asyncio.to_thread(assemble, data, spec, key, os.environ.get('OFFLINE_SIGNING_KEY_ID', 'offline-v1'))
