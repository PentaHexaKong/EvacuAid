import pytest
from datetime import datetime, timezone
from redis.exceptions import RedisError

from app.models.user import AccessibilityItem, AccessibilityUpdate, LocationUpdate, PreferencesUpdate, UserCreate
from app.routers import context as contextRouter
from app.services import user_service
from app.services import assistanceService, buddyService
from app.models.assistance import AssistanceCreate
from app.models.buddy import BuddyInvitationCreate
from app.services.bmkg_service import BmkgFetchResult
from app.services.cacheService import CacheService
from app.services.petabencana_service import PetaBencanaFetchResult


@pytest.mark.asyncio
async def testContextOrchestratesProfileAndRisk(dbSession, monkeypatch):
    user = await user_service.create_user(dbSession, UserCreate(name='Citra', needs_assistance=True))
    await user_service.update_location(dbSession, user.id, LocationUpdate(latitude=-6.1647, longitude=106.8453, observed_at=datetime.now(timezone.utc)))
    await user_service.update_accessibility(dbSession, user.id, AccessibilityUpdate(items=[AccessibilityItem(type='MOBILITY_LIMITATION')]))
    await user_service.update_preferences(dbSession, user.id, PreferencesUpdate(voice_enabled=False))

    async def weatherFetcher(adm4):
        return BmkgFetchResult({'forecasts': [{'weather_desc': 'Cloudy', 'temperature_c': 26, 'humidity_pct': 84, 'precipitation': 0.9, 'wind_speed': 3.5, 'forecast_age_minutes': 1}]})

    async def reportsFetcher():
        return PetaBencanaFetchResult([{'report_id': 'r1', 'disaster_type': 'flood', 'latitude': -6.1648, 'longitude': 106.8454, 'report_age_minutes': 1}])

    monkeypatch.setattr(contextRouter, 'fetch_weather', weatherFetcher)
    monkeypatch.setattr(contextRouter, 'fetch_reports', reportsFetcher)
    response = await contextRouter.getContext(user.id, dbSession, CacheService(None))
    assert response.action.recommended_action.value == 'PREPARE'
    assert response.action.requirements.accessible_route_required is True
    assert response.assistance.status.value == 'NOT_REQUESTED'


@pytest.mark.asyncio
async def testCacheFailureDoesNotRaise():
    class BrokenRedis:
        async def get(self, key):
            raise RedisError('unavailable')

        async def set(self, key, value, ex):
            raise RedisError('unavailable')

    cache = CacheService(BrokenRedis())
    assert await cache.getJson('any') is None
    assert await cache.setJson('any', {'value': 1}, 60) is False


@pytest.mark.asyncio
async def testContextShowsOnlyActiveAssistanceRequest(dbSession, monkeypatch):
    user = await user_service.create_user(dbSession, UserCreate(name='Rani', needs_assistance=True))
    buddy = await user_service.create_user(dbSession, UserCreate(name='Sari'))
    await user_service.update_location(dbSession, user.id, LocationUpdate(latitude=-6.2, longitude=106.8, observed_at=datetime.now(timezone.utc)))
    invitation = await buddyService.createInvitation(dbSession, user.id, BuddyInvitationCreate(buddyUserId=buddy.id, level='PRIMARY'))
    await buddyService.acceptInvitation(dbSession, invitation.id, buddy.id)
    request = await assistanceService.createRequest(dbSession, user.id, AssistanceCreate(buddyUserId=buddy.id))
    await assistanceService.transitionRequest(dbSession, request.id, 'notify', user.id)
    await assistanceService.transitionRequest(dbSession, request.id, 'accept', buddy.id)

    async def weatherFetcher(adm4):
        return BmkgFetchResult({'forecasts': [{'weather_desc': 'Cloudy', 'temperature_c': 26, 'humidity_pct': 84, 'precipitation': 0.9, 'wind_speed': 3.5, 'forecast_age_minutes': 1}]})

    async def reportsFetcher():
        return PetaBencanaFetchResult([])

    monkeypatch.setattr(contextRouter, 'fetch_weather', weatherFetcher)
    monkeypatch.setattr(contextRouter, 'fetch_reports', reportsFetcher)
    response = await contextRouter.getContext(user.id, dbSession, CacheService(None))
    assert response.assistance.status.value == 'ACCEPTED'
    assert response.assistance.requestId == str(request.id)
    assert response.assistance.buddy.userId == buddy.id
