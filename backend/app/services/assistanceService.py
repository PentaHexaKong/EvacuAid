import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AssistanceRequest
from app.models.assistance import AssistanceCreate, AssistanceResponse, AssistanceStatus
from app.repositories import assistanceRepository, buddyRepository
from app.services import user_service


transitionTargets = {
    'notify': ('REQUESTED', 'NOTIFIED', 'notifiedAt'),
    'accept': ('NOTIFIED', 'ACCEPTED', 'acceptedAt'),
    'decline': ('NOTIFIED', 'DECLINED', None),
    'depart': ('ACCEPTED', 'EN_ROUTE', 'enRouteAt'),
    'arrive': ('EN_ROUTE', 'ARRIVED', 'arrivedAt'),
    'evacuating': ('ARRIVED', 'EVACUATING', 'evacuatingAt'),
    'safe': (('ARRIVED', 'EVACUATING'), 'SAFE', 'safeAt'),
    'cancel': (('REQUESTED', 'NOTIFIED', 'ACCEPTED', 'EN_ROUTE'), 'CANCELLED', 'cancelledAt'),
}


def requestResponse(request: AssistanceRequest) -> AssistanceResponse:
    return AssistanceResponse(id=request.id, userId=request.userId, buddyUserId=request.buddyUserId, eventId=request.eventId, status=request.status, requestedAt=request.requestedAt, notifiedAt=request.notifiedAt, acceptedAt=request.acceptedAt, enRouteAt=request.enRouteAt, arrivedAt=request.arrivedAt, evacuatingAt=request.evacuatingAt, safeAt=request.safeAt, cancelledAt=request.cancelledAt, expiredAt=request.expiredAt, updatedAt=request.updatedAt)


async def createRequest(session: AsyncSession, payload: AssistanceCreate) -> AssistanceRequest:
    await user_service.require_user(session, payload.userId)
    if payload.buddyUserId is not None:
        await user_service.require_user(session, payload.buddyUserId)
        relationship = await buddyRepository.getRelationshipForPair(session, payload.userId, payload.buddyUserId)
        if relationship is None or relationship.status != 'ACTIVE':
            raise HTTPException(status_code=409, detail='a specific buddy must have an active relationship')
    request = AssistanceRequest(userId=payload.userId, buddyUserId=payload.buddyUserId, eventId=payload.eventId, status='REQUESTED')
    session.add(request)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status_code=409, detail='an active assistance request already exists')
    await session.refresh(request)
    return request


async def requireRequest(session: AsyncSession, requestId: uuid.UUID, lock: bool = False) -> AssistanceRequest:
    request = await assistanceRepository.getRequest(session, requestId, lock)
    if request is None:
        raise HTTPException(status_code=404, detail='assistance request not found')
    return request


async def getActiveRequest(session: AsyncSession, userId: uuid.UUID) -> AssistanceRequest | None:
    return await assistanceRepository.getActiveRequest(session, userId)


async def transitionRequest(session: AsyncSession, requestId: uuid.UUID, command: str, actorUserId: uuid.UUID, buddyUserId: uuid.UUID | None = None) -> AssistanceRequest:
    request = await requireRequest(session, requestId, lock=True)
    current, target, timestampField = transitionTargets[command]
    allowedCurrent = current if isinstance(current, tuple) else (current,)
    if request.status not in allowedCurrent:
        raise HTTPException(status_code=409, detail=f'cannot {command} a request in {request.status}')
    if command in ('notify', 'cancel') and request.userId != actorUserId:
        raise HTTPException(status_code=403, detail='only the requesting user can perform this action')
    if command not in ('notify', 'cancel') and request.buddyUserId != actorUserId:
        raise HTTPException(status_code=403, detail='only the assigned buddy can perform this action')
    if command == 'notify' and buddyUserId is not None:
        relationship = await buddyRepository.getRelationshipForPair(session, request.userId, buddyUserId, lock=True)
        if relationship is None or relationship.status != 'ACTIVE':
            raise HTTPException(status_code=409, detail='a notified buddy must have an active relationship')
        request.buddyUserId = buddyUserId
    if command == 'notify' and request.buddyUserId is None:
        raise HTTPException(status_code=422, detail='notify requires an assigned buddy')
    request.status = target
    if timestampField:
        setattr(request, timestampField, datetime.now(timezone.utc))
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status_code=409, detail='assigned buddy already has an active request')
    await session.refresh(request)
    return request
