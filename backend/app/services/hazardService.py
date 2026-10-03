import asyncio
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from typing import Any

from app.models.hazard import HazardItem, HazardType, HazardsResponse, SourceStatus
from app.services.bmkg_service import BmkgQuakeResult
from app.services.petabencana_service import PetaBencanaFetchResult

REPORT_WINDOW_SECONDS = 7 * 24 * 3600
MAX_ITEMS = 20
KNOWN_TYPES = {kind.value for kind in HazardType}


def _when(value: Any) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def aggregate_reports(reports: list[dict[str, Any]]) -> list[HazardItem]:
    """Counts per disaster type only; citizen report text is unmoderated and never leaves the backend."""
    groups: dict[str, tuple[int, datetime]] = {}
    for report in reports:
        kind, when = report.get('disaster_type'), _when(report.get('created_at'))
        if not isinstance(kind, str) or kind not in KNOWN_TYPES or when is None:
            continue
        count, newest = groups.get(kind, (0, when))
        groups[kind] = (count + 1, max(newest, when))
    return [HazardItem(id=f'pb:{kind}', type=kind, occurredAt=newest, source='PetaBencana', reportCount=count) for kind, (count, newest) in groups.items()]


def _status(available: bool) -> SourceStatus:
    return SourceStatus(status='available') if available else SourceStatus(status='unavailable', error='source unavailable')


async def recentHazards(
    quakeFetcher: Callable[[], Awaitable[BmkgQuakeResult]],
    reportsFetcher: Callable[[], Awaitable[PetaBencanaFetchResult]],
) -> HazardsResponse:
    quakes, reports = await asyncio.gather(quakeFetcher(), reportsFetcher(), return_exceptions=True)
    for outcome in (quakes, reports):
        if isinstance(outcome, BaseException) and not isinstance(outcome, Exception):
            raise outcome
    if isinstance(quakes, Exception):
        quakes = BmkgQuakeResult(quakes=None, error='source unavailable')
    if isinstance(reports, Exception):
        reports = PetaBencanaFetchResult(reports=None, error='source unavailable')
    items = [HazardItem(id=f"bmkg:{quake['occurredAt']}", type=HazardType.EARTHQUAKE, source='BMKG', **quake) for quake in (quakes.quakes or [])] if quakes.available else []
    if reports.available:
        items += aggregate_reports(reports.reports or [])
    items.sort(key=lambda item: item.occurredAt, reverse=True)
    return HazardsResponse(items=items[:MAX_ITEMS], sources={'BMKG': _status(quakes.available), 'PetaBencana': _status(reports.available)})
