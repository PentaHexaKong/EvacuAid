import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.auth import current_user
from app.db.models import User
from app.models.context import ContextAssistanceData, ContextNavigationData, ContextResponse
from app.models.navigation import NavigationCreate, NavigationResponse, NavigationStatus
from app.models.assistance import ContextBuddy
from app.models.risk import RiskRequest
from app.services import user_service
from app.services.bmkg_service import BmkgFetchResult, fetch_weather
from app.services.cacheService import CacheService, getCache
from app.services.petabencana_service import PetaBencanaFetchResult, fetch_reports
from app.services.risk_service import aggregate_risk
from app.services import assistanceService, navigationService
from app.services.hazardContextService import officialWarningForLocation
from app.repositories import buddyRepository


router = APIRouter(prefix='/v1', tags=['context'])


async def getContext(userId: uuid.UUID, session: AsyncSession, cache: CacheService | None = None) -> ContextResponse:
    user = await user_service.require_user(session, userId, include_relations=True)
    if user.latitude is None or user.longitude is None or user.locationObservedAt is None:
        raise HTTPException(status_code=409, detail='user location is required for context')
    if user.locationObservedAt < datetime.now(timezone.utc) - timedelta(minutes=15):
        raise HTTPException(status_code=409, detail='user location is stale; update location')

    async def weatherFetcher(adm4: str) -> BmkgFetchResult:
        cacheKey = f'weather:{adm4}'
        cached = await cache.getJson(cacheKey) if cache else None
        if cached:
            return BmkgFetchResult(data=cached)
        result = await fetch_weather(adm4)
        if result.available and cache:
            await cache.setJson(cacheKey, result.data or {}, 300)
        return result

    async def reportsFetcher() -> PetaBencanaFetchResult:
        cacheKey = 'reports:current'
        cached = await cache.getJson(cacheKey) if cache else None
        if cached is not None:
            return PetaBencanaFetchResult(reports=cached.get('reports', []))
        result = await fetch_reports()
        if result.available and cache:
            await cache.setJson(cacheKey, {'reports': result.reports or []}, 60)
        return result

    preferences = user.preferences
    activeRequest = await assistanceService.getActiveRequest(session, userId)
    risk = await aggregate_risk(
        RiskRequest(
            adm4='31.71.03.1001',
            latitude=user.latitude,
            longitude=user.longitude,
            needs_assistance=user.needs_assistance,
            accessibility=[row.type for row in user.accessibility],
            voice_enabled=preferences.voice_enabled if preferences else True,
            vibration_enabled=preferences.vibration_enabled if preferences else True,
            text_enabled=preferences.text_enabled if preferences else True,
        ),
        weatherFetcher,
        reportsFetcher,
        officialWarning=await officialWarningForLocation(session, user.latitude, user.longitude),
    )
    return ContextResponse(
        event=risk.event,
        exposure=risk.exposure,
        weather=risk.weather,
        action=risk.action,
        assistance=await contextAssistance(session, risk.action.assistance_required, activeRequest),
        navigation=await contextNavigation(session, userId, risk.action.recommended_action.value),
        quality=risk.quality,
    )


async def contextAssistance(session: AsyncSession, required: bool, request) -> ContextAssistanceData:
    if request is None:
        return ContextAssistanceData(required=required)
    buddy = None
    if request.buddyUserId is not None:
        relationship = await buddyRepository.getRelationshipForPair(session, request.userId, request.buddyUserId)
        if relationship is not None:
            buddy = ContextBuddy(userId=request.buddyUserId, level=relationship.level)
    return ContextAssistanceData(required=required, status=request.status, requestId=str(request.id), buddy=buddy)


async def contextNavigation(session: AsyncSession, userId: uuid.UUID, action: str) -> NavigationResponse:
    if action != 'EVACUATE':
        return NavigationResponse(routeStatus=NavigationStatus.NOT_REQUIRED)
    return await navigationService.navigationForUser(session, NavigationCreate(userId=userId))


@router.get('/context', response_model=ContextResponse)
async def context(actor: User = Depends(current_user), session: AsyncSession = Depends(get_session), cache: CacheService = Depends(getCache)) -> ContextResponse:
    return await getContext(actor.id, session, cache)
