import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.auth import current_user, require_owner
from app.db.models import User
from app.models.assistance import AssistanceCreate, AssistanceNotify, AssistanceResponse
from app.repositories import assistanceRepository
from app.services import assistanceService, user_service


router = APIRouter(prefix='/v1', tags=['assistance'])


@router.post('/assistance/requests', response_model=AssistanceResponse, status_code=status.HTTP_201_CREATED)
async def createRequest(payload: AssistanceCreate, session: AsyncSession = Depends(get_session), actor: User = Depends(current_user)) -> AssistanceResponse:
    return assistanceService.requestResponse(await assistanceService.createRequest(session, actor.id, payload))


@router.get('/assistance/requests/{requestId}', response_model=AssistanceResponse)
async def getRequest(requestId: uuid.UUID, session: AsyncSession = Depends(get_session), actor: User = Depends(current_user)) -> AssistanceResponse:
    request = await assistanceService.requireRequest(session, requestId)
    if actor.id not in (request.userId, request.buddyUserId):
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail='guest session cannot access this assistance request')
    return assistanceService.requestResponse(request)


@router.get('/users/{userId}/assistance/requests', response_model=list[AssistanceResponse])
async def listRequests(userId: uuid.UUID, session: AsyncSession = Depends(get_session), actor: User = Depends(current_user)) -> list[AssistanceResponse]:
    require_owner(userId, actor)
    await user_service.require_user(session, userId)
    return [assistanceService.requestResponse(request) for request in await assistanceRepository.listUserRequests(session, userId)]


@router.get('/users/{buddyUserId}/assistance/assignments', response_model=list[AssistanceResponse])
async def listAssignments(buddyUserId: uuid.UUID, session: AsyncSession = Depends(get_session), actor: User = Depends(current_user)) -> list[AssistanceResponse]:
    require_owner(buddyUserId, actor)
    await user_service.require_user(session, buddyUserId)
    return [assistanceService.requestResponse(request) for request in await assistanceRepository.listBuddyAssignments(session, buddyUserId)]


async def transition(requestId: uuid.UUID, command: str, actor: User, session: AsyncSession, buddyUserId: uuid.UUID | None = None) -> AssistanceResponse:
    return assistanceService.requestResponse(await assistanceService.transitionRequest(session, requestId, command, actor.id, buddyUserId))


@router.post('/assistance/requests/{requestId}/notify', response_model=AssistanceResponse)
async def notify(requestId: uuid.UUID, payload: AssistanceNotify, session: AsyncSession = Depends(get_session), actor: User = Depends(current_user)) -> AssistanceResponse:
    return await transition(requestId, 'notify', actor, session, payload.buddyUserId)


@router.post('/assistance/requests/{requestId}/accept', response_model=AssistanceResponse)
async def accept(requestId: uuid.UUID, session: AsyncSession = Depends(get_session), actor: User = Depends(current_user)) -> AssistanceResponse:
    return await transition(requestId, 'accept', actor, session)


@router.post('/assistance/requests/{requestId}/decline', response_model=AssistanceResponse)
async def decline(requestId: uuid.UUID, session: AsyncSession = Depends(get_session), actor: User = Depends(current_user)) -> AssistanceResponse:
    return await transition(requestId, 'decline', actor, session)


@router.post('/assistance/requests/{requestId}/depart', response_model=AssistanceResponse)
async def depart(requestId: uuid.UUID, session: AsyncSession = Depends(get_session), actor: User = Depends(current_user)) -> AssistanceResponse:
    return await transition(requestId, 'depart', actor, session)


@router.post('/assistance/requests/{requestId}/arrive', response_model=AssistanceResponse)
async def arrive(requestId: uuid.UUID, session: AsyncSession = Depends(get_session), actor: User = Depends(current_user)) -> AssistanceResponse:
    return await transition(requestId, 'arrive', actor, session)


@router.post('/assistance/requests/{requestId}/evacuating', response_model=AssistanceResponse)
async def evacuating(requestId: uuid.UUID, session: AsyncSession = Depends(get_session), actor: User = Depends(current_user)) -> AssistanceResponse:
    return await transition(requestId, 'evacuating', actor, session)


@router.post('/assistance/requests/{requestId}/safe', response_model=AssistanceResponse)
async def safe(requestId: uuid.UUID, session: AsyncSession = Depends(get_session), actor: User = Depends(current_user)) -> AssistanceResponse:
    return await transition(requestId, 'safe', actor, session)


@router.post('/assistance/requests/{requestId}/cancel', response_model=AssistanceResponse)
async def cancel(requestId: uuid.UUID, session: AsyncSession = Depends(get_session), actor: User = Depends(current_user)) -> AssistanceResponse:
    return await transition(requestId, 'cancel', actor, session)
