import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import BuddyRelationship


async def getRelationshipForPair(session: AsyncSession, userId: uuid.UUID, buddyUserId: uuid.UUID, lock: bool = False) -> BuddyRelationship | None:
    query = select(BuddyRelationship).where(BuddyRelationship.userId == userId, BuddyRelationship.buddyUserId == buddyUserId, BuddyRelationship.status.in_(('PENDING', 'ACTIVE')))
    if lock:
        query = query.with_for_update()
    return (await session.execute(query)).scalar_one_or_none()
