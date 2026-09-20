import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.models.user import AccessibilityItem, AccessibilityUpdate, LocationUpdate, PreferencesResponse, PreferencesUpdate, UserCreate, UserResponse, UserUpdate
from app.services import user_service


router = APIRouter(prefix='/v1/users', tags=['users'])


@router.post('', response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def createUser(payload: UserCreate, session: AsyncSession = Depends(get_session)) -> UserResponse:
    return UserResponse.model_validate(await user_service.create_user(session, payload))


@router.get('/{userId}', response_model=UserResponse)
async def getUser(userId: uuid.UUID, session: AsyncSession = Depends(get_session)) -> UserResponse:
    return UserResponse.model_validate(await user_service.require_user(session, userId))


@router.patch('/{userId}', response_model=UserResponse)
async def updateUser(userId: uuid.UUID, payload: UserUpdate, session: AsyncSession = Depends(get_session)) -> UserResponse:
    return UserResponse.model_validate(await user_service.update_user(session, userId, payload))


@router.put('/{userId}/location', response_model=UserResponse)
async def updateLocation(userId: uuid.UUID, payload: LocationUpdate, session: AsyncSession = Depends(get_session)) -> UserResponse:
    return UserResponse.model_validate(await user_service.update_location(session, userId, payload))


@router.get('/{userId}/accessibility', response_model=list[AccessibilityItem])
async def getAccessibility(userId: uuid.UUID, session: AsyncSession = Depends(get_session)) -> list[AccessibilityItem]:
    return [AccessibilityItem(type=row.type, severity=row.severity) for row in await user_service.accessibility_for_user(session, userId)]


@router.put('/{userId}/accessibility', response_model=list[AccessibilityItem])
async def updateAccessibility(userId: uuid.UUID, payload: AccessibilityUpdate, session: AsyncSession = Depends(get_session)) -> list[AccessibilityItem]:
    rows = await user_service.update_accessibility(session, userId, payload)
    return [AccessibilityItem(type=row.type, severity=row.severity) for row in rows]


@router.get('/{userId}/preferences', response_model=PreferencesResponse)
async def getPreferences(userId: uuid.UUID, session: AsyncSession = Depends(get_session)) -> PreferencesResponse:
    preference = await user_service.preferences_for_user(session, userId)
    return PreferencesResponse(user_id=userId, **{field: getattr(preference, field) for field in PreferencesUpdate.model_fields})


@router.put('/{userId}/preferences', response_model=PreferencesResponse)
async def updatePreferences(userId: uuid.UUID, payload: PreferencesUpdate, session: AsyncSession = Depends(get_session)) -> PreferencesResponse:
    preference = await user_service.update_preferences(session, userId, payload)
    return PreferencesResponse(user_id=userId, **{field: getattr(preference, field) for field in PreferencesUpdate.model_fields})
