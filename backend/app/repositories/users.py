import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models import User, UserAccessibility, UserPreference


async def get_user(session: AsyncSession, user_id: uuid.UUID, *, include_relations: bool = False) -> User | None:
    query = select(User).where(User.id == user_id)
    if include_relations:
        query = query.options(selectinload(User.accessibility), selectinload(User.preferences))
    return (await session.execute(query)).scalar_one_or_none()


async def create_user(session: AsyncSession, user: User) -> User:
    session.add(user)
    await session.flush()
    return user


async def replace_accessibility(session: AsyncSession, user: User, items: list[tuple[str, str | None]]) -> list[UserAccessibility]:
    user.accessibility.clear()
    # A single flush inserts before it deletes orphans, so keeping a need already saved would hit uq_user_accessibility_type.
    await session.flush()
    user.accessibility.extend(UserAccessibility(type=item_type, severity=severity) for item_type, severity in items)
    await session.flush()
    return user.accessibility


async def get_or_create_preferences(session: AsyncSession, user: User) -> UserPreference:
    if user.preferences is None:
        user.preferences = UserPreference()
        await session.flush()
    return user.preferences
