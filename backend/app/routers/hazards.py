from fastapi import APIRouter, Depends

from app.auth import current_user
from app.db.models import User
from app.models.hazardFeed import HazardsResponse
from app.services import hazardService
from app.services.bmkg_service import fetch_felt_earthquakes
from app.services.cacheService import CacheService, getCache
from app.services.petabencana_service import fetch_reports

router = APIRouter(prefix='/v1/hazards', tags=['hazards'])
CACHE_KEY = 'hazards:recent'


@router.get('/recent', response_model=HazardsResponse)
async def recent(_: User = Depends(current_user), cache: CacheService = Depends(getCache)) -> HazardsResponse:
    cached = await cache.getJson(CACHE_KEY)
    if cached:
        return HazardsResponse.model_validate(cached)
    result = await hazardService.recentHazards(fetch_felt_earthquakes, lambda: fetch_reports(hazardService.REPORT_WINDOW_SECONDS))
    available = [status.status == 'available' for status in result.sources.values()]
    if any(available):
        await cache.setJson(CACHE_KEY, result.model_dump(mode='json'), 300 if all(available) else 60)
    return result
