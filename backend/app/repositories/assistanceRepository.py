import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AssistanceRequest


activeStatuses = ('REQUESTED', 'NOTIFIED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'EVACUATING')


async def getRequest(session: AsyncSession, requestId: uuid.UUID, lock: bool = False) -> AssistanceRequest | None:
    query = select(AssistanceRequest).where(AssistanceRequest.id == requestId)
    if lock:
        query = query.with_for_update()
    return (await session.execute(query)).scalar_one_or_none()


async def listUserRequests(session: AsyncSession, userId: uuid.UUID) -> list[AssistanceRequest]:
    query = select(AssistanceRequest).where(AssistanceRequest.userId == userId).order_by(AssistanceRequest.requestedAt.desc())
    return list((await session.execute(query)).scalars())


async def listBuddyAssignments(session: AsyncSession, buddyUserId: uuid.UUID) -> list[AssistanceRequest]:
    query = select(AssistanceRequest).where(AssistanceRequest.buddyUserId == buddyUserId).order_by(AssistanceRequest.requestedAt.desc())
    return list((await session.execute(query)).scalars())


async def getActiveRequest(session: AsyncSession, userId: uuid.UUID) -> AssistanceRequest | None:
    query = select(AssistanceRequest).where(AssistanceRequest.userId == userId, AssistanceRequest.status.in_(activeStatuses)).order_by(AssistanceRequest.requestedAt.desc())
    return (await session.execute(query)).scalars().first()
