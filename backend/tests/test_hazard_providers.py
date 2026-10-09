from datetime import datetime, timedelta, timezone

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin
from sqlalchemy import func, select, text

from app.db.models.hazard import HazardRecord
from app.repositories import hazardRepository
from app.services.elevationProvider import ElevationProvider
from app.services.hazardIngestionService import providerHealth, refreshSource
from app.services.hazardProviders import communityEvidence, parseCap, parseEarthquakes, parseFirms
from app.services.inariskProvider import baselineFromRaster
from tests.test_hazards import syntheticEvidence


NOW = datetime(2026, 10, 2, 12, tzinfo=timezone.utc)


def capXml(status='Actual', msgType='Alert', expires='2026-10-02T13:00:00+00:00', severity='Severe'):
    return f'''<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
    <identifier>SYNTHETIC_TEST_CAP</identifier><status>{status}</status><msgType>{msgType}</msgType>
    <sent>2026-10-02T11:00:00+00:00</sent><info><event>SYNTHETIC_TEST_RAIN</event>
    <effective>2026-10-02T11:00:00+00:00</effective><expires>{expires}</expires>
    {f'<severity>{severity}</severity>' if severity is not None else ''}<certainty>Likely</certainty>
    <area><polygon>-6.2,106.8 -6.2,106.9 -6.1,106.9 -6.1,106.8 -6.2,106.8</polygon></area>
    </info></alert>'''


def testCapPreservesActiveGeometryAndValidityWithoutInventedSeverity():
    items = parseCap(capXml(), NOW)
    assert len(items) == 1
    item = items[0]
    assert item.geometry['coordinates'][0][0] == (106.8, -6.2)
    assert item.validUntil == NOW + timedelta(hours=1)
    assert item.metadata['capSeverity'] == 'Severe'
    assert item.severity is None and item.confidence is None
    assert not item.hard()


@pytest.mark.parametrize('severity,status', [('Extreme', 'SIAGA'), ('Severe', 'WASPADA'), ('Moderate', 'WASPADA'), ('Minor', None), ('Unknown', None), (None, None)])
def testCapOfficialStatusNeverUsesEvacuationLevel(severity, status):
    item = parseCap(capXml(severity=severity), NOW)[0]
    assert item.metadata.get('officialStatus') == status
    assert item.metadata.get('officialStatus') != 'AWAS'
    if status is None:
        assert 'officialStatus' not in item.metadata


@pytest.mark.parametrize('status,msgType,expires', [('Test', 'Alert', '2026-10-02T13:00:00Z'), ('Actual', 'Cancel', '2026-10-02T13:00:00Z'), ('Actual', 'Alert', '2026-10-02T11:59:00Z')])
def testCapTestCancelledAndExpiredWarningsAreInactive(status, msgType, expires):
    assert parseCap(capXml(status, msgType, expires), NOW) == []


def testEarthquakeJsonKeepsCorrectAxisOrderAndProvenance():
    payload = {'Infogempa': {'gempa': [{'DateTime': '2026-10-02T11:00:00Z', 'Coordinates': '-6.2,106.8', 'Magnitude': '5.5', 'Potensi': 'SYNTHETIC_TEST_CONTEXT'}]}}
    item = parseEarthquakes(payload, NOW)[0]
    assert item.geometry['coordinates'] == (106.8, -6.2)
    assert item.metadata['attribution'] == 'BMKG'
    assert item.metadata['damageStatus'] == 'UNKNOWN'
    assert not item.hard()
    assert item.validUntil <= NOW + timedelta(minutes=10)


def testOldEarthquakeIsNotReactivatedByRefresh():
    payload = {'Infogempa': {'gempa': {'DateTime': '2026-09-01T11:00:00Z', 'Coordinates': '-6.2,106.8'}}}
    assert parseEarthquakes(payload, NOW) == []


def testFirmsCsvPreservesHotspotAndRawConfidence():
    items = parseFirms('latitude,longitude,acq_date,acq_time,confidence,satellite,instrument\n-6.2,106.8,2026-10-02,1100,h,TEST,TEST\n', NOW)
    item = items[0]
    assert item.geometry['type'] == 'Point'
    assert item.confidence is None
    assert item.metadata['qualityWeight'] == 0.8
    assert item.metadata['rawConfidence'] == 'h'
    assert item.metadata['perimeter'] is False
    assert item.severity is None


def testInvalidFirmsPayloadIsNotSuccessfulEmptyRefresh():
    with pytest.raises(ValueError):
        parseFirms('Invalid MAP_KEY', NOW)


def testPetaBencanaDoesNotBecomePolygonOrCriticalWarning():
    item = communityEvidence([{'report_id': 'SYNTHETIC_TEST', 'latitude': -6.2, 'longitude': 106.8, 'created_at': '2026-10-02T11:00:00Z'}], NOW)[0]
    assert item.authority.value == 'COMMUNITY'
    assert item.evidenceType.value == 'OBSERVATION'
    assert item.geometry['type'] == 'Point'
    assert item.severity is None
    assert not item.hard()


def testOldCommunityReportDoesNotBecomeCurrent():
    assert communityEvidence([{'latitude': -6.2, 'longitude': 106.8, 'created_at': '2026-09-01T11:00:00Z'}], NOW) == []


def testPreparedDemReadsNodataCrsAndActualElevation(tmp_path):
    path = tmp_path / 'SYNTHETIC_TEST_DEM.tif'
    with rasterio.open(path, 'w', driver='GTiff', width=2, height=2, count=1, dtype='float32', crs='EPSG:4326', transform=from_origin(0, 0.002, 0.001, 0.001), nodata=-9999) as dataset:
        dataset.write(np.array([[10, 20], [30, -9999]], dtype='float32'), 1)
    profile = ElevationProvider(str(path), 'SYNTHETIC_TEST_DEM', 'SYNTHETIC_TEST_DATUM').sample([[0.0005, 0.0015], [0.0015, 0.0015], [0.0015, 0.0005], [1, 1]])
    assert profile.elevations == [10, 20, None, None]
    assert profile.source == 'SYNTHETIC_TEST_DEM'
    assert profile.slopeMeanDegrees is not None


def testPreparedDemWithoutNodataReadsElevationAndRejectsUncoveredPoints(tmp_path):
    path = tmp_path / 'SYNTHETIC_TEST_DEM.tif'
    with rasterio.open(path, 'w', driver='GTiff', width=2, height=2, count=1, dtype='float32', crs='EPSG:4326', transform=from_origin(0, 0.002, 0.001, 0.001)) as dataset:
        dataset.write(np.array([[0, 20], [30, np.nan]], dtype='float32'), 1)
    profile = ElevationProvider(str(path), 'SYNTHETIC_TEST_DEM', 'SYNTHETIC_TEST_DATUM').sample([[0.0005, 0.0015], [0.0015, 0.0015], [0.0015, 0.0005], [1, 1]])
    assert profile.elevations == [0, 20, None, None]
    assert profile.source == 'SYNTHETIC_TEST_DEM'
    assert profile.slopeMeanDegrees is not None


def testRasterBaselineExtractionPreservesProvenanceAndNeverInfersActiveHazard(tmp_path):
    path = tmp_path / 'SYNTHETIC_TEST_BASELINE.tif'
    with rasterio.open(path, 'w', driver='GTiff', width=2, height=2, count=1, dtype='float32', crs='EPSG:4326', transform=from_origin(0, 0.002, 0.001, 0.001), nodata=-9999) as dataset:
        dataset.write(np.array([[0.9, 0.8], [0.1, -9999]], dtype='float32'), 1)
    items = baselineFromRaster(str(path), 'LANDSLIDE', 'SYNTHETIC_TEST_SOURCE', 0.6)
    assert len(items) == 1
    assert items[0].evidenceType.value == 'BASELINE_HAZARD'
    assert items[0].metadata['minimumSourceValue'] == 0.6
    assert items[0].metadata['thresholdPolicy'] == 'EXPERIMENTAL'
    assert items[0].severity is None
    assert not items[0].hard()


@pytest.mark.asyncio
async def testPostgisIngestionDeduplicatesAndSpatiallyFilters(dbSession):
    item = syntheticEvidence()
    await hazardRepository.saveEvidence(dbSession, [item, item])
    await dbSession.commit()
    assert await dbSession.scalar(select(func.count()).select_from(HazardRecord)) == 1
    nearby = await hazardRepository.activeEvidence(dbSession, (0, 0), 1000)
    assert len(nearby) == 1
    assert nearby[0].sourceId == 'SYNTHETIC_TEST'
    assert await hazardRepository.activeEvidence(dbSession, (-6.2, 106.8), 1000) == []
    indexes = (await dbSession.execute(text("SELECT indexname FROM pg_indexes WHERE tablename = 'hazard_evidence'"))).scalars().all()
    assert {'ix_hazard_geometry', 'ix_hazard_geography', 'ix_hazard_temporal', 'ix_hazard_type_source'} <= set(indexes)


@pytest.mark.asyncio
async def testPostgisExpiredHazardExcluded(dbSession):
    item = syntheticEvidence()
    item.validUntil = datetime.now(timezone.utc) - timedelta(seconds=1)
    await hazardRepository.saveEvidence(dbSession, [item])
    await dbSession.commit()
    assert await hazardRepository.activeEvidence(dbSession, (0, 0), 1000) == []


@pytest.mark.asyncio
async def testProviderRefreshCachesAndFailureKeepsLastEvidence(dbSession):
    calls = 0
    async def success(source, now):
        nonlocal calls
        calls += 1
        item = syntheticEvidence()
        item.source = 'BMKG_CAP'
        return [item]
    async def failure(source, now):
        raise ValueError('SYNTHETIC_TEST_UNAVAILABLE')
    first = await refreshSource(dbSession, 'BMKG_CAP', fetcher=success)
    cached = await refreshSource(dbSession, 'BMKG_CAP', fetcher=success)
    assert first == cached and calls == 1
    degraded = await refreshSource(dbSession, 'BMKG_CAP', fetcher=failure, force=True)
    assert degraded['status'] == 'degraded'
    assert await dbSession.scalar(select(func.count()).select_from(HazardRecord)) == 1
    assert degraded['error'] == 'ValueError'


@pytest.mark.asyncio
async def testEmptySuccessfulRefreshRemovesOldWarning(dbSession):
    item = syntheticEvidence()
    item.source = 'BMKG_CAP'
    await hazardRepository.saveEvidence(dbSession, [item])
    await dbSession.commit()
    async def empty(source, now):
        return []
    await refreshSource(dbSession, 'BMKG_CAP', fetcher=empty, force=True)
    assert await dbSession.scalar(select(func.count()).select_from(HazardRecord)) == 0


@pytest.mark.asyncio
async def testOptionalUnconfiguredProviderHealthIsUnknown(dbSession):
    result = await providerHealth(dbSession)
    assert result['FIRMS']['status'] in {'unknown', 'unconfigured'}
    assert result['INARISK']['optional'] is True


@pytest.mark.asyncio
async def testMapServerRasterDoesNotPretendToSupportPolygonQuery(tmp_path, monkeypatch):
    from app.services import inariskProvider
    calls = []
    class Response:
        def json(self):
            return {'type': 'Raster Layer', 'capabilities': 'Map,Query,Data'}
    async def response(client, url, params):
        calls.append(url)
        return Response()
    monkeypatch.setattr(inariskProvider, 'getData', response)
    with pytest.raises(ValueError, match='ImageServer'):
        await inariskProvider.prepareInarisk('FLOOD', '0,0,0.01,0.01', str(tmp_path / 'SYNTHETIC_TEST.geojson'), 'https://SYNTHETIC_TEST/MapServer/0')
    assert len(calls) == 1


@pytest.mark.asyncio
async def testFeatureLayerUsesSpatialQueryAnd4326Output(tmp_path, monkeypatch):
    from app.services import inariskProvider
    calls = []
    class Response:
        def __init__(self, body):
            self.body = body
        def json(self):
            return self.body
    async def response(client, url, params):
        calls.append((url, params))
        if url.endswith('/query'):
            return Response({'type': 'FeatureCollection', 'features': []})
        return Response({'type': 'Feature Layer', 'capabilities': 'Query', 'advancedQueryCapabilities': {'supportsPagination': True}})
    monkeypatch.setattr(inariskProvider, 'getData', response)
    await inariskProvider.prepareInarisk('FLOOD', '0,0,0.01,0.01', str(tmp_path / 'SYNTHETIC_TEST.geojson'), 'https://SYNTHETIC_TEST/MapServer/0')
    assert calls[1][0].endswith('/query')
    assert calls[1][1]['geometryType'] == 'esriGeometryEnvelope'
    assert calls[1][1]['outSR'] == 4326


def testFirmsCredentialIsRedactedFromHttpClientLogs(monkeypatch):
    import logging
    from app.services import hazardProviders
    monkeypatch.setattr(hazardProviders.config, 'FIRMS_MAP_KEY', 'SYNTHETIC_TEST_SECRET')
    record = logging.LogRecord('httpx', logging.INFO, '', 1, 'request %s', ('https://TEST/api/SYNTHETIC_TEST_SECRET/area',), None)
    hazardProviders.CredentialFilter().filter(record)
    assert 'SYNTHETIC_TEST_SECRET' not in record.getMessage()
    assert '[REDACTED]' in record.getMessage()


def testDemPreparationProducesSourceLabelledCog(tmp_path):
    from app.services.demPreparation import prepareDem
    source = tmp_path / 'SYNTHETIC_TEST_SOURCE.tif'
    output = tmp_path / 'SYNTHETIC_TEST_COG.tif'
    with rasterio.open(source, 'w', driver='GTiff', width=2, height=2, count=1, dtype='float32', crs='EPSG:4326', transform=from_origin(0, 0.002, 0.001, 0.001), nodata=-9999) as dataset:
        dataset.write(np.ones((2, 2), dtype='float32'), 1)
    manifest = prepareDem(str(source), str(output), 'SYNTHETIC_TEST_DEM', 'https://SYNTHETIC_TEST/source', 'SYNTHETIC_TEST_DATUM')
    assert manifest['source'] == 'SYNTHETIC_TEST_DEM'
    assert len(manifest['sha256']) == 64
    assert output.is_file()
    assert (tmp_path / 'SYNTHETIC_TEST_COG.tif.json').is_file()


@pytest.mark.asyncio
async def testStaticScopeReplacementPreservesOtherPreparedAreas(dbSession):
    first = syntheticEvidence()
    second = syntheticEvidence()
    second.sourceId = 'SYNTHETIC_TEST_OTHER_AREA'
    await hazardRepository.replaceStaticScope(dbSession, 'SYNTHETIC_TEST', 'SYNTHETIC_TEST_AREA_A', [first])
    await hazardRepository.replaceStaticScope(dbSession, 'SYNTHETIC_TEST', 'SYNTHETIC_TEST_AREA_B', [second])
    await dbSession.commit()
    await hazardRepository.replaceStaticScope(dbSession, 'SYNTHETIC_TEST', 'SYNTHETIC_TEST_AREA_A', [])
    await dbSession.commit()
    rows = (await dbSession.execute(select(HazardRecord))).scalars().all()
    assert [row.sourceId for row in rows] == ['SYNTHETIC_TEST_OTHER_AREA']
