import uuid

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AssistanceRequest, BuddyRelationship, User


activeStatuses = ('REQUESTED', 'NOTIFIED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'EVACUATING')


async def getRelationship(session: AsyncSession, relationshipId: uuid.UUID, lock: bool = False) -> BuddyRelationship | None:
    query = select(BuddyRelationship).where(BuddyRelationship.id == relationshipId)
    if lock:
        query = query.with_for_update()
    return (await session.execute(query)).scalar_one_or_none()


async def getRelationshipForPair(session: AsyncSession, userId: uuid.UUID, buddyUserId: uuid.UUID, lock: bool = False) -> BuddyRelationship | None:
    query = select(BuddyRelationship).where(BuddyRelationship.userId == userId, BuddyRelationship.buddyUserId == buddyUserId, BuddyRelationship.status.in_(('PENDING', 'ACTIVE')))
    if lock:
        query = query.with_for_update()
    return (await session.execute(query)).scalar_one_or_none()


async def listRelationships(session: AsyncSession, userId: uuid.UUID) -> list[BuddyRelationship]:
    query = select(BuddyRelationship).where(BuddyRelationship.userId == userId).order_by(BuddyRelationship.createdAt.desc())
    return list((await session.execute(query)).scalars())


async def listInvitations(session: AsyncSession, buddyUserId: uuid.UUID) -> list[BuddyRelationship]:
    query = select(BuddyRelationship).where(BuddyRelationship.buddyUserId == buddyUserId, BuddyRelationship.status == 'PENDING').order_by(BuddyRelationship.createdAt.desc())
    return list((await session.execute(query)).scalars())


async def listCandidates(session: AsyncSession, user: User) -> list[tuple[BuddyRelationship, User, float | None, int]]:
    assignmentCount = select(func.count(AssistanceRequest.id)).where(AssistanceRequest.buddyUserId == BuddyRelationship.buddyUserId, AssistanceRequest.status.in_(activeStatuses)).correlate(BuddyRelationship).scalar_subquery()
    distance = func.ST_Distance(User.location, user.location).label('distanceM')
    query = select(BuddyRelationship, User, distance, assignmentCount.label('activeAssignments')).join(User, User.id == BuddyRelationship.buddyUserId).where(BuddyRelationship.userId == user.id, BuddyRelationship.status == 'ACTIVE')
    rows = await session.execute(query)
    return [(relationship, buddy, float(distanceM) if distanceM is not None else None, activeAssignments) for relationship, buddy, distanceM, activeAssignments in rows.all()]
