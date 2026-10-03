import uuid
from datetime import timezone

from fastapi import HTTPException
from geoalchemy2.elements import WKTElement
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import User, UserAccessibility, UserPreference
from app.models.user import AccessibilityUpdate, LocationUpdate, PreferencesUpdate, UserCreate, UserUpdate
from app.repositories import users as repository


async def require_user(session: AsyncSession, user_id: uuid.UUID, *, include_relations: bool = False) -> User:
    user = await repository.get_user(session, user_id, include_relations=include_relations)
    if user is None:
        raise HTTPException(status_code=404, detail="user not found")
    return user


async def create_user(session: AsyncSession, payload: UserCreate) -> User:
    user = await repository.create_user(session, User(**payload.model_dump()))
    user.preferences = UserPreference()
    await session.commit()
    await session.refresh(user)
    return user


async def create_guest(session: AsyncSession) -> User:
    user = User(name=None)
    user.preferences = UserPreference()
    session.add(user)
    await session.flush()
    return user


async def update_user(session: AsyncSession, user_id: uuid.UUID, payload: UserUpdate) -> User:
    user = await require_user(session, user_id, include_relations=payload.accessibility is not None)
    for field, value in payload.model_dump(exclude_unset=True).items():
        if field == 'accessibility':
            continue
        setattr(user, 'shareLocationWithBuddies' if field == 'share_location_with_buddies' else field, value)
    if payload.accessibility is not None:
        await repository.replace_accessibility(session, user, [(item.type.value, item.severity) for item in payload.accessibility])
    await session.commit()
    await session.refresh(user)
    return user


async def update_location(session: AsyncSession, user_id: uuid.UUID, payload: LocationUpdate) -> User:
    user = await require_user(session, user_id)
    user.latitude, user.longitude = payload.latitude, payload.longitude
    user.location = WKTElement(f'POINT({payload.longitude} {payload.latitude})', srid=4326)
    user.locationObservedAt = payload.observed_at.astimezone(timezone.utc)
    user.locationAccuracyM = payload.accuracy_m
    await session.commit()
    await session.refresh(user)
    return user


async def delete_location(session: AsyncSession, user_id: uuid.UUID) -> User:
    user = await require_user(session, user_id)
    user.latitude = None
    user.longitude = None
    user.location = None
    user.locationObservedAt = None
    user.locationAccuracyM = None
    user.shareLocationWithBuddies = False
    await session.commit()
    await session.refresh(user)
    return user


async def accessibility_for_user(session: AsyncSession, user_id: uuid.UUID) -> list[UserAccessibility]:
    return (await require_user(session, user_id, include_relations=True)).accessibility


async def update_accessibility(session: AsyncSession, user_id: uuid.UUID, payload: AccessibilityUpdate) -> list[UserAccessibility]:
    user = await require_user(session, user_id, include_relations=True)
    rows = await repository.replace_accessibility(session, user, [(item.type.value, item.severity) for item in payload.items])
    await session.commit()
    return rows


async def preferences_for_user(session: AsyncSession, user_id: uuid.UUID) -> UserPreference:
    user = await require_user(session, user_id, include_relations=True)
    return await repository.get_or_create_preferences(session, user)


async def update_preferences(session: AsyncSession, user_id: uuid.UUID, payload: PreferencesUpdate) -> UserPreference:
    preference = await preferences_for_user(session, user_id)
    for field, value in payload.model_dump().items():
        setattr(preference, field, value)
    await session.commit()
    await session.refresh(preference)
    return preference
