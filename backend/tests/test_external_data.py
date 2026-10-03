import pytest

from app.models.externalData import ExternalMapData
from app.services import externalDataService
from app.services.bmkg_service import BmkgFetchResult
from app.services.petabencana_service import PetaBencanaFetchResult


@pytest.mark.asyncio
async def testSyncExternalDataPersistsMapSnapshots(dbSession):
    async def weatherFetcher(adm4):
        return BmkgFetchResult({'adm4': adm4, 'forecasts': [{'weather_desc': 'Rain', 'temperature_c': 25}]})

    async def reportsFetcher():
        return PetaBencanaFetchResult([{'report_id': 'pb-1', 'disaster_type': 'flood', 'latitude': -6.2, 'longitude': 106.8, 'source': 'PetaBencana'}])

    synced = await externalDataService.syncExternalData(dbSession, '31.71.03.1001', weatherFetcher, reportsFetcher)
    persisted = await externalDataService.mapData(dbSession, '31.71.03.1001')
    assert isinstance(synced, ExternalMapData)
    assert persisted.weather['forecasts'][0]['weather_desc'] == 'Rain'
    assert persisted.reports[0]['report_id'] == 'pb-1'
    assert persisted.weatherStatus.available is True
    assert persisted.reportsStatus.available is True


@pytest.mark.asyncio
async def testSyncExternalDataKeepsLastSnapshotWhenSourceFails(dbSession):
    async def availableWeather(adm4):
        return BmkgFetchResult({'adm4': adm4, 'forecasts': []})

    async def availableReports():
        return PetaBencanaFetchResult([])

    async def unavailableWeather(adm4):
        return BmkgFetchResult(None, 'BMKG unavailable')

    await externalDataService.syncExternalData(dbSession, '31.71.03.1001', availableWeather, availableReports)
    result = await externalDataService.syncExternalData(dbSession, '31.71.03.1001', unavailableWeather, availableReports)
    assert result.weather == {'adm4': '31.71.03.1001', 'forecasts': []}
    assert result.weatherStatus.error == 'BMKG unavailable'
