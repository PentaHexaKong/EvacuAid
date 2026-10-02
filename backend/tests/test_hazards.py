import httpx
import pytest
from fastapi import FastAPI

from app.auth import current_user
from app.db import session as db_session
from app.routers import hazards as hazards_router
from app.services import hazardService
from app.services.bmkg_service import BmkgQuakeResult, normalize_earthquakes
from app.services.cacheService import CacheService, getCache
from app.services.petabencana_service import PetaBencanaFetchResult


def test_normalize_earthquakes_keeps_valid_rows_and_skips_malformed_ones():
    payload = {'Infogempa': {'gempa': [
        {'DateTime': '2026-10-02T06:48:10+00:00', 'Coordinates': '-8.00,120.88', 'Magnitude': '4.3', 'Kedalaman': '17 km',
         'Wilayah': 'Pusat gempa berada di laut 82 km Timur Laut RUTENG-MANGGARAI-NTT', 'Dirasakan': 'II-III Kab. Manggarai'},
        {'DateTime': '2026-10-01T01:00:00+00:00', 'Coordinates': 'garbage', 'Magnitude': '3.1', 'Kedalaman': '?', 'Wilayah': 'x' * 400},
        {'DateTime': None, 'Coordinates': '-1,100', 'Magnitude': '5.0'},
        {'DateTime': '2026-10-01T02:00:00+00:00', 'Coordinates': '-1,100', 'Magnitude': 'n/a'},
        'not a row',
    ]}}
    quakes = normalize_earthquakes(payload)
    assert len(quakes) == 2
    assert quakes[0] == {'occurredAt': '2026-10-02T06:48:10+00:00', 'magnitude': 4.3, 'depthKm': 17.0, 'latitude': -8.0, 'longitude': 120.88,
                         'region': 'Pusat gempa berada di laut 82 km Timur Laut RUTENG-MANGGARAI-NTT', 'felt': 'II-III Kab. Manggarai'}
    assert quakes[1]['latitude'] is None and quakes[1]['longitude'] is None and quakes[1]['depthKm'] is None
    assert len(quakes[1]['region']) == 160 and quakes[1]['felt'] is None


def test_normalize_earthquakes_accepts_single_object_and_rejects_out_of_range_coordinates():
    payload = {'Infogempa': {'gempa': {'DateTime': '2026-10-02T06:48:10+00:00', 'Coordinates': '-95,500', 'Magnitude': '4'}}}
    [quake] = normalize_earthquakes(payload)
    assert quake['latitude'] is None and quake['longitude'] is None
    assert normalize_earthquakes({}) == []


QUAKE = {'occurredAt': '2026-10-02T06:48:10+00:00', 'magnitude': 4.3, 'depthKm': 17.0, 'latitude': -8.0, 'longitude': 120.88, 'region': 'Ruteng', 'felt': 'II-III'}
REPORTS = [
    {'disaster_type': 'volcano', 'created_at': '2026-10-01T10:00:00Z', 'text': 'never exposed'},
    {'disaster_type': 'volcano', 'created_at': '2026-10-02T09:00:00+00:00'},
    {'disaster_type': 'haze', 'created_at': '2026-09-30T00:00:00Z'},
    {'disaster_type': 'alien', 'created_at': '2026-10-02T00:00:00Z'},
    {'disaster_type': 'flood', 'created_at': 'not a date'},
]


def test_aggregate_reports_counts_known_types_and_never_carries_text():
    items = {item.type.value: item for item in hazardService.aggregate_reports(REPORTS)}
    assert set(items) == {'volcano', 'haze'}
    assert items['volcano'].reportCount == 2 and items['volcano'].id == 'pb:volcano'
    assert items['volcano'].occurredAt.isoformat() == '2026-10-02T09:00:00+00:00'
    assert 'never exposed' not in items['volcano'].model_dump_json()


@pytest.mark.asyncio
async def test_recent_hazards_merges_sorts_and_reports_source_status():
    async def quakes(): return BmkgQuakeResult(quakes=[QUAKE])
    async def reports(): return PetaBencanaFetchResult(reports=REPORTS)
    result = await hazardService.recentHazards(quakes, reports)
    assert [item.id for item in result.items] == ['pb:volcano', 'bmkg:2026-10-02T06:48:10+00:00', 'pb:haze']
    assert {name: status.status for name, status in result.sources.items()} == {'BMKG': 'available', 'PetaBencana': 'available'}


@pytest.mark.asyncio
async def test_recent_hazards_survives_one_or_both_sources_down():
    async def down_quakes(): return BmkgQuakeResult(quakes=None, error='boom')
    async def down_reports(): return PetaBencanaFetchResult(reports=None, error='boom')
    async def reports(): return PetaBencanaFetchResult(reports=REPORTS)
    partial = await hazardService.recentHazards(down_quakes, reports)
    assert partial.sources['BMKG'].status == 'unavailable' and len(partial.items) == 2
    empty = await hazardService.recentHazards(down_quakes, down_reports)
    assert empty.items == [] and {s.status for s in empty.sources.values()} == {'unavailable'}
    assert all(s.error == 'source unavailable' for s in empty.sources.values())


def hazards_api(monkeypatch, quakes, reports, authed=True):
    app = FastAPI()
    app.include_router(hazards_router.router)
    if authed:
        app.dependency_overrides[current_user] = lambda: object()
    else:
        async def no_session():
            yield None
        app.dependency_overrides[db_session.get_session] = no_session
    app.dependency_overrides[getCache] = lambda: CacheService(None)
    async def fake_quakes(): return quakes
    async def fake_reports(timeperiod=None):
        assert timeperiod == hazardService.REPORT_WINDOW_SECONDS
        return reports
    monkeypatch.setattr(hazards_router, 'fetch_felt_earthquakes', fake_quakes)
    monkeypatch.setattr(hazards_router, 'fetch_reports', fake_reports)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test')


@pytest.mark.asyncio
async def test_recent_endpoint_returns_merged_items(monkeypatch):
    async with hazards_api(monkeypatch, BmkgQuakeResult(quakes=[QUAKE]), PetaBencanaFetchResult(reports=REPORTS)) as client:
        response = await client.get('/v1/hazards/recent')
    assert response.status_code == 200
    body = response.json()
    assert [item['type'] for item in body['items']] == ['volcano', 'earthquake', 'haze']
    assert body['items'][1]['magnitude'] == 4.3 and body['items'][1]['felt'] == 'II-III'


@pytest.mark.asyncio
async def test_recent_endpoint_is_200_when_every_source_is_down(monkeypatch):
    async with hazards_api(monkeypatch, BmkgQuakeResult(quakes=None, error='x'), PetaBencanaFetchResult(reports=None, error='x')) as client:
        response = await client.get('/v1/hazards/recent')
    assert response.status_code == 200
    assert response.json() == {'items': [], 'sources': {'BMKG': {'status': 'unavailable', 'error': 'source unavailable'}, 'PetaBencana': {'status': 'unavailable', 'error': 'source unavailable'}}}


@pytest.mark.asyncio
async def test_recent_endpoint_requires_a_guest_session(monkeypatch):
    async with hazards_api(monkeypatch, BmkgQuakeResult(quakes=[]), PetaBencanaFetchResult(reports=[]), authed=False) as client:
        assert (await client.get('/v1/hazards/recent')).status_code == 401


@pytest.mark.asyncio
async def test_recent_hazards_survives_a_fetcher_raising_unexpectedly():
    async def quakes(): return BmkgQuakeResult(quakes=[QUAKE])
    async def reports(): return PetaBencanaFetchResult(reports=REPORTS)
    async def broken_reports(): raise AttributeError('malformed feature')
    async def broken_quakes(): raise OSError('disk')
    async def down_reports(): return PetaBencanaFetchResult(reports=None, error='x')

    result = await hazardService.recentHazards(quakes, broken_reports)
    assert [item.id for item in result.items] == ['bmkg:2026-10-02T06:48:10+00:00']
    assert result.sources['PetaBencana'].status == 'unavailable' and result.sources['BMKG'].status == 'available'

    result = await hazardService.recentHazards(broken_quakes, reports)
    assert [item.id for item in result.items] == ['pb:volcano', 'pb:haze']
    assert result.sources['BMKG'].status == 'unavailable' and result.sources['BMKG'].error == 'source unavailable'

    result = await hazardService.recentHazards(quakes, down_reports)
    assert [item.id for item in result.items] == ['bmkg:2026-10-02T06:48:10+00:00']
    assert result.sources['PetaBencana'].status == 'unavailable'


def test_normalize_earthquakes_skips_non_finite_magnitude_and_depth():
    rows = [{'DateTime': '2026-10-02T06:48:10+00:00', 'Coordinates': '-1,100', 'Magnitude': m} for m in ('NaN', 'inf', '-inf')]
    rows.append({'DateTime': '2026-10-02T06:48:10+00:00', 'Coordinates': '-1,100', 'Magnitude': '4', 'Kedalaman': 'nan km'})
    quakes = normalize_earthquakes({'Infogempa': {'gempa': rows}})
    assert len(quakes) == 1 and quakes[0]['depthKm'] is None


def test_aggregate_reports_skips_unhashable_disaster_types():
    reports = [{'disaster_type': ['flood'], 'created_at': '2026-10-02T00:00:00Z'}, {'disaster_type': {'a': 1}, 'created_at': '2026-10-02T00:00:00Z'}, *REPORTS]
    assert {item.type.value for item in hazardService.aggregate_reports(reports)} == {'volcano', 'haze'}
