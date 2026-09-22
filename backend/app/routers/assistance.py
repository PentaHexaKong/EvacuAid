import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.models.assistance import AssistanceActor, AssistanceCreate, AssistanceNotify, AssistanceResponse
from app.repositories import assistanceRepository
from app.services import assistanceService, user_service


router = APIRouter(prefix='/v1', tags=['assistance'])


@router.post('/assistance/requests', response_model=AssistanceResponse, status_code=status.HTTP_201_CREATED)
async def createRequest(payload: AssistanceCreate, session: AsyncSession = Depends(get_session)) -> AssistanceResponse:
    return assistanceService.requestResponse(await assistanceService.createRequest(session, payload))


@router.get('/assistance/requests/{requestId}', response_model=AssistanceResponse)
async def getRequest(requestId: uuid.UUID, session: AsyncSession = Depends(get_session)) -> AssistanceResponse:
    return assistanceService.requestResponse(await assistanceService.requireRequest(session, requestId))


@router.get('/users/{userId}/assistance/requests', response_model=list[AssistanceResponse])
async def listRequests(userId: uuid.UUID, session: AsyncSession = Depends(get_session)) -> list[AssistanceResponse]:
    await user_service.require_user(session, userId)
    return [assistanceService.requestResponse(request) for request in await assistanceRepository.listUserRequests(session, userId)]


@router.get('/users/{buddyUserId}/assistance/assignments', response_model=list[AssistanceResponse])
async def listAssignments(buddyUserId: uuid.UUID, session: AsyncSession = Depends(get_session)) -> list[AssistanceResponse]:
    await user_service.require_user(session, buddyUserId)
    return [assistanceService.requestResponse(request) for request in await assistanceRepository.listBuddyAssignments(session, buddyUserId)]


async def transition(requestId: uuid.UUID, command: str, payload: AssistanceActor, session: AsyncSession, buddyUserId: uuid.UUID | None = None) -> AssistanceResponse:
    return assistanceService.requestResponse(await assistanceService.transitionRequest(session, requestId, command, payload.actorUserId, buddyUserId))


@router.post('/assistance/requests/{requestId}/notify', response_model=AssistanceResponse)
async def notify(requestId: uuid.UUID, payload: AssistanceNotify, session: AsyncSession = Depends(get_session)) -> AssistanceResponse:
    return await transition(requestId, 'notify', payload, session, payload.buddyUserId)


@router.post('/assistance/requests/{requestId}/accept', response_model=AssistanceResponse)
async def accept(requestId: uuid.UUID, payload: AssistanceActor, session: AsyncSession = Depends(get_session)) -> AssistanceResponse:
    return await transition(requestId, 'accept', payload, session)


@router.post('/assistance/requests/{requestId}/decline', response_model=AssistanceResponse)
async def decline(requestId: uuid.UUID, payload: AssistanceActor, session: AsyncSession = Depends(get_session)) -> AssistanceResponse:
    return await transition(requestId, 'decline', payload, session)


@router.post('/assistance/requests/{requestId}/depart', response_model=AssistanceResponse)
async def depart(requestId: uuid.UUID, payload: AssistanceActor, session: AsyncSession = Depends(get_session)) -> AssistanceResponse:
    return await transition(requestId, 'depart', payload, session)


@router.post('/assistance/requests/{requestId}/arrive', response_model=AssistanceResponse)
async def arrive(requestId: uuid.UUID, payload: AssistanceActor, session: AsyncSession = Depends(get_session)) -> AssistanceResponse:
    return await transition(requestId, 'arrive', payload, session)


@router.post('/assistance/requests/{requestId}/evacuating', response_model=AssistanceResponse)
async def evacuating(requestId: uuid.UUID, payload: AssistanceActor, session: AsyncSession = Depends(get_session)) -> AssistanceResponse:
    return await transition(requestId, 'evacuating', payload, session)


@router.post('/assistance/requests/{requestId}/safe', response_model=AssistanceResponse)
async def safe(requestId: uuid.UUID, payload: AssistanceActor, session: AsyncSession = Depends(get_session)) -> AssistanceResponse:
    return await transition(requestId, 'safe', payload, session)


@router.post('/assistance/requests/{requestId}/cancel', response_model=AssistanceResponse)
async def cancel(requestId: uuid.UUID, payload: AssistanceActor, session: AsyncSession = Depends(get_session)) -> AssistanceResponse:
    return await transition(requestId, 'cancel', payload, session)
