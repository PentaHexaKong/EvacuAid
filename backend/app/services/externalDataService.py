import asyncio
from typing import Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import PETABENCANA_ADMIN
from app.models.externalData import ExternalMapData, ExternalSourceStatus
from app.repositories import externalDataRepository
from app.services.bmkg_service import BmkgFetchResult, fetch_weather
from app.services.petabencana_service import PetaBencanaFetchResult, fetch_reports


BmkgFetcher = Callable[[str], Awaitable[BmkgFetchResult]]
ReportsFetcher = Callable[[], Awaitable[PetaBencanaFetchResult]]


def reportsScope() -> str:
    return PETABENCANA_ADMIN or 'ALL'


async def syncExternalData(session: AsyncSession, adm4: str, weatherFetcher: BmkgFetcher = fetch_weather, reportsFetcher: ReportsFetcher = fetch_reports) -> ExternalMapData:
    weatherResult, reportsResult = await asyncio.gather(weatherFetcher(adm4), reportsFetcher())
    if weatherResult.available:
        await externalDataRepository.saveSnapshot(session, 'BMKG', adm4, weatherResult.data or {})
    if reportsResult.available:
        await externalDataRepository.saveSnapshot(session, 'PetaBencana', reportsScope(), {'reports': reportsResult.reports or []})
    if weatherResult.available or reportsResult.available:
        await session.commit()
    return await mapData(session, adm4, weatherResult.error, reportsResult.error)


async def mapData(session: AsyncSession, adm4: str, weatherError: str | None = None, reportsError: str | None = None) -> ExternalMapData:
    weatherSnapshot = await externalDataRepository.getSnapshot(session, 'BMKG', adm4)
    reportsSnapshot = await externalDataRepository.getSnapshot(session, 'PetaBencana', reportsScope())
    reports = reportsSnapshot.payload.get('reports', []) if reportsSnapshot else []
    return ExternalMapData(
        adm4=adm4,
        weather=weatherSnapshot.payload if weatherSnapshot else None,
        weatherStatus=ExternalSourceStatus(available=weatherSnapshot is not None, fetchedAt=weatherSnapshot.fetchedAt if weatherSnapshot else None, error=weatherError),
        reports=reports,
        reportsStatus=ExternalSourceStatus(available=reportsSnapshot is not None, fetchedAt=reportsSnapshot.fetchedAt if reportsSnapshot else None, error=reportsError),
    )


async def storedReports(session: AsyncSession) -> list[dict] | None:
    snapshot = await externalDataRepository.getSnapshot(session, 'PetaBencana', reportsScope())
    return snapshot.payload.get('reports', []) if snapshot else None
