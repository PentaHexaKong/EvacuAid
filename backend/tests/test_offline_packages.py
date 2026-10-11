import copy
import json
import uuid
from datetime import datetime, timezone, timedelta

import httpx
import pytest
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI

from app.offline.builder import assemble, public_url
from app.offline.manifest import safe_path, validate, verify
from app.offline.store import enqueue, latest
from app.routers.offline import router


@pytest.fixture
def package(tmp_path, monkeypatch):
    monkeypatch.setenv('OFFLINE_PACKAGE_DIR', str(tmp_path / 'packages'))
    graph = tmp_path / 'graph' / '2' / '000' / '482'
    graph.mkdir(parents=True)
    (graph / '107.gph').write_bytes(bytes(16) + b'3.9.0' + bytes(11) + b'unit-test-only-not-a-native-routing-graph')
    streets = tmp_path / 'streets.geojson'
    streets.write_text(json.dumps({'type': 'FeatureCollection', 'features': [
        {'type': 'Feature', 'geometry': {'type': 'LineString', 'coordinates': [[106.7, -6.2], [106.8, -6.3]]},
         'properties': {'citizenPhone': 'must-not-export'}}]}))
    data = {'regionId': str(uuid.uuid4()), 'regionName': 'Fixture', 'boundarySource': 'public fixture',
            'bbox': [106.7, -6.3, 106.8, -6.2],
            'boundary': {'type': 'Polygon', 'coordinates': [[[106.7, -6.3], [106.8, -6.3], [106.8, -6.2], [106.7, -6.2], [106.7, -6.3]]]},
            'shelters': [], 'hazards': []}
    data['coverage'] = data['boundary']
    spec = {'mapFile': str(streets), 'graphDirectory': str(tmp_path / 'graph'),
            'coverageBbox': [106, -7, 107, -6], 'routingEngineVersion': '3.9.0',
            'mapSourceUrl': 'https://example.org/map', 'routingSourceUrl': 'https://example.org/graph',
            'mapAttribution': 'Public test fixture', 'datasetGeneratedAt': '2026-01-01T00:00:00Z'}
    key = Ed25519PrivateKey.generate()
    now = datetime(2026, 1, 2, tzinfo=timezone.utc)
    document = assemble(data, spec, key, 'test-key', now)
    return document, data, spec, key, tmp_path, now


def test_signed_manifest_and_no_fabricated_capabilities(package):
    document, *_ = package
    verify(document, package[3].public_key())
    validate(document)
    assert document['capabilities']['nativeRouting'] is False
    assert document['capabilities']['hazardEvaluation'] is False
    assert document['hazardEvidenceValidUntil'] is None
    assert document['sourceProvenance']['staticDatasetGeneratedAt'] != document['hazardSnapshotAt']
    assert latest(document['regionId']) == document
    object_path = package[4] / 'packages' / 'objects' / document['contentChecksums']['map/streets.geojson']
    assert b'citizenPhone' not in object_path.read_bytes()


def test_manifest_tampering_and_wrong_key_rejected(package):
    document = copy.deepcopy(package[0])
    document['capabilities']['nativeRouting'] = True
    with pytest.raises(InvalidSignature):
        verify(document, package[3].public_key())
    with pytest.raises(InvalidSignature):
        verify(package[0], Ed25519PrivateKey.generate().public_key())


@pytest.mark.parametrize('path', ['/etc/passwd', '../a', 'map/../a', 'map//a', 'C:/a', 'map/a\\b', 'map/a%2fb', './map/a'])
def test_unsafe_paths_rejected(path):
    with pytest.raises(ValueError):
        safe_path(path)


def test_content_checksums_and_duplicate_assets_rejected(package):
    manifest = copy.deepcopy(package[0])
    manifest['assets'].append(manifest['assets'][0])
    with pytest.raises(ValueError):
        validate(manifest)
    manifest = copy.deepcopy(package[0])
    manifest['contentChecksums']['map/streets.geojson'] = '0' * 64
    with pytest.raises(ValueError):
        validate(manifest)


def test_graph_reused_when_hazards_change(package):
    document, data, spec, key, directory, now = package
    objects = directory / 'packages' / 'objects'
    graph_asset = next(a for a in document['assets'] if a['kind'] == 'routing')
    before = (objects / graph_asset['sha256']).stat().st_mtime_ns
    data['hazards'] = [{'validUntil': '2026-01-03T00:00:00Z', 'source': 'PUBLIC_FIXTURE'}]
    updated = assemble(data, spec, key, 'test-key', now + timedelta(hours=1))
    assert updated['graphVersion'] == document['graphVersion']
    assert updated['packageId'] != document['packageId']
    assert (objects / graph_asset['sha256']).stat().st_mtime_ns == before
    assert latest(document['regionId'])['packageId'] == updated['packageId']
    assert (directory / 'packages' / 'packages' / document['packageId'] / 'package.zip').exists()


def test_evidence_expiry_compares_instants_not_timestamp_strings(package):
    _, data, spec, key, _, now = package
    data['hazards'] = [{'validUntil': '2026-01-03T08:00:00+07:00'}, {'validUntil': '2026-01-03T02:00:00+00:00'}]
    manifest = assemble(data, spec, key, 'test-key', now)
    assert manifest['hazardEvidenceValidUntil'] == '2026-01-03T01:00:00+00:00'


def test_failed_replacement_keeps_last_valid_package(package):
    document, data, spec, key, _, now = package
    spec['coverageBbox'] = [0, 0, 1, 1]
    with pytest.raises(ValueError, match='cover'):
        assemble(data, spec, key, 'test-key', now)
    assert latest(document['regionId']) == document


def test_graph_version_and_source_requirements(package):
    _, data, spec, key, _, now = package
    spec['routingEngineVersion'] = 'different-engine'
    with pytest.raises(ValueError, match='3.9.0'):
        assemble(data, spec, key, 'test-key', now)
    assert public_url('https://user:password@example.org/map?token=secret#frag') == 'https://example.org/map'


def test_regional_graph_tile_bounds_and_incompatible_header(package):
    from pathlib import Path
    from app.offline.graph import tile_bounds, regional_tiles
    assert tile_bounds(Path('2/000/482/107.gph')) == (106.75, -6.5, 107.0, -6.25)
    graph = Path(package[2]['graphDirectory'])
    (graph / '2/000/482/107.gph').write_bytes(bytes(16) + b'4.0.0' + bytes(11))
    with pytest.raises(ValueError, match='header'):
        regional_tiles(graph, package[1]['bbox'])


@pytest.mark.asyncio
async def test_download_ranges_and_version_bound_assets(package):
    document = package[0]
    app = FastAPI()
    app.include_router(router)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        region = document['regionId']
        response = await client.get(f'/v1/offline/packages/{region}/manifest')
        assert response.json() == document
        response = await client.get(f'/v1/offline/packages/{region}/download', headers={'Range': 'bytes=0-31'})
        assert response.status_code == 206
        assert len(response.content) == 32
        checksum = document['assets'][0]['sha256']
        url = f'/v1/offline/packages/{region}/assets/{checksum}?packageId={document["packageId"]}'
        response = await client.get(url, headers={'Range': 'bytes=0-7'})
        assert response.status_code == 206
        assert len(response.content) == 8
        assert (await client.get(url.replace(region, str(uuid.uuid4())))).status_code == 404
        assert (await client.get(url.replace(checksum, '0' * 64))).status_code == 404


def test_queue_is_persisted(package):
    job = enqueue(package[0]['regionId'])
    path = package[4] / 'packages' / 'jobs' / (job['jobId'] + '.json')
    assert json.loads(path.read_text())['status'] == 'QUEUED'


@pytest.mark.asyncio
async def test_worker_failure_is_persisted_and_previous_package_retained(package, monkeypatch):
    from app import offlineCli
    async def failed(_job):
        raise ValueError('operator asset problem')
    monkeypatch.setattr(offlineCli, 'build', failed)
    job = enqueue(package[0]['regionId'])
    await offlineCli.work(once=True)
    path = package[4] / 'packages' / 'jobs' / (job['jobId'] + '.json')
    assert json.loads(path.read_text())['status'] == 'FAILED'
    assert latest(package[0]['regionId']) == package[0]


@pytest.mark.asyncio
async def test_public_snapshot_uses_regions_and_excludes_private_community_data(dbSession):
    from geoalchemy2.shape import from_shape
    from shapely.geometry import MultiPolygon, Polygon, Point
    from sqlalchemy import delete
    from app.db.models.hazard import HazardRecord
    from command.models import Region
    from app.offline.builder import snapshot
    region_id = uuid.uuid4()
    polygon = Polygon([(106.7, -6.3), (106.8, -6.3), (106.8, -6.2), (106.7, -6.2), (106.7, -6.3)])
    region = Region(id=region_id, code='offline-' + region_id.hex, name='Public fixture region',
                    administrativeLevel='PROVINCE', dataMode='REFERENCE', boundarySource='public test fixture',
                    geometry=from_shape(MultiPolygon([polygon]), srid=4326),
                    centroid=from_shape(polygon.centroid, srid=4326))
    dbSession.add(region)
    for authority, source in [('OFFICIAL', 'PUBLIC_FIXTURE'), ('COMMUNITY', 'PRIVATE_CITIZEN')]:
        dbSession.add(HazardRecord(id=uuid.uuid4(), sourceId=source, hazardType='FLOOD', source=source,
                      authority=authority, evidenceType='OBSERVATION',
                      geometry=from_shape(Point(106.75, -6.25), srid=4326),
                      evidenceMetadata={'citizenPhone': 'private', 'sourceUrl': 'https://example.org/evidence?token=private'},
                      observedAt=datetime.now(timezone.utc)))
    await dbSession.commit()
    try:
        data = await snapshot(str(region_id), 1000)
        assert data['regionId'] == str(region_id)
        assert [hazard['source'] for hazard in data['hazards']] == ['PUBLIC_FIXTURE']
        assert 'private' not in json.dumps(data)
        assert data['hazards'][0]['metadata']['sourceUrl'] == 'https://example.org/evidence'
        assert data['bbox'][0] < polygon.bounds[0]
    finally:
        await dbSession.execute(delete(Region).where(Region.id == region_id))
        await dbSession.commit()
