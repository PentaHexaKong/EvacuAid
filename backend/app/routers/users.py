import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.auth import require_profile_owner
from app.models.user import AccessibilityItem, AccessibilityUpdate, LocationUpdate, PreferencesResponse, PreferencesUpdate, UserResponse, UserUpdate
from app.services import user_service


router = APIRouter(prefix='/v1/users', tags=['users'])


@router.get('/{userId}', response_model=UserResponse)
async def getUser(userId: uuid.UUID, session: AsyncSession = Depends(get_session), actor=Depends(require_profile_owner)) -> UserResponse:
    return UserResponse.model_validate(await user_service.require_user(session, userId))


@router.patch('/{userId}', response_model=UserResponse)
async def updateUser(userId: uuid.UUID, payload: UserUpdate, session: AsyncSession = Depends(get_session), actor=Depends(require_profile_owner)) -> UserResponse:
    return UserResponse.model_validate(await user_service.update_user(session, userId, payload))


@router.put('/{userId}/location', response_model=UserResponse)
async def updateLocation(userId: uuid.UUID, payload: LocationUpdate, session: AsyncSession = Depends(get_session), actor=Depends(require_profile_owner)) -> UserResponse:
    return UserResponse.model_validate(await user_service.update_location(session, userId, payload))


@router.delete('/{userId}/location', response_model=UserResponse)
async def deleteLocation(userId: uuid.UUID, session: AsyncSession = Depends(get_session), actor=Depends(require_profile_owner)) -> UserResponse:
    return UserResponse.model_validate(await user_service.delete_location(session, userId))


@router.get('/{userId}/accessibility', response_model=list[AccessibilityItem])
async def getAccessibility(userId: uuid.UUID, session: AsyncSession = Depends(get_session), actor=Depends(require_profile_owner)) -> list[AccessibilityItem]:
    return [AccessibilityItem(type=row.type, severity=row.severity) for row in await user_service.accessibility_for_user(session, userId)]


@router.put('/{userId}/accessibility', response_model=list[AccessibilityItem])
async def updateAccessibility(userId: uuid.UUID, payload: AccessibilityUpdate, session: AsyncSession = Depends(get_session), actor=Depends(require_profile_owner)) -> list[AccessibilityItem]:
    rows = await user_service.update_accessibility(session, userId, payload)
    return [AccessibilityItem(type=row.type, severity=row.severity) for row in rows]


@router.get('/{userId}/preferences', response_model=PreferencesResponse)
async def getPreferences(userId: uuid.UUID, session: AsyncSession = Depends(get_session), actor=Depends(require_profile_owner)) -> PreferencesResponse:
    preference = await user_service.preferences_for_user(session, userId)
    return PreferencesResponse(user_id=userId, **{field: getattr(preference, field) for field in PreferencesUpdate.model_fields})


@router.put('/{userId}/preferences', response_model=PreferencesResponse)
async def updatePreferences(userId: uuid.UUID, payload: PreferencesUpdate, session: AsyncSession = Depends(get_session), actor=Depends(require_profile_owner)) -> PreferencesResponse:
    preference = await user_service.update_preferences(session, userId, payload)
    return PreferencesResponse(user_id=userId, **{field: getattr(preference, field) for field in PreferencesUpdate.model_fields})
