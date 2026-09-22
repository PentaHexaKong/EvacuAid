import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.models.assistance import AssistanceActor
from app.models.buddy import BuddyCandidatesResponse, BuddyInvitationCreate, BuddyRelationshipResponse
from app.repositories import buddyRepository
from app.services import buddyService, user_service


router = APIRouter(prefix='/v1', tags=['buddies'])


@router.post('/users/{userId}/buddies/invitations', response_model=BuddyRelationshipResponse, status_code=status.HTTP_201_CREATED)
async def createInvitation(userId: uuid.UUID, payload: BuddyInvitationCreate, session: AsyncSession = Depends(get_session)) -> BuddyRelationshipResponse:
    return buddyService.relationshipResponse(await buddyService.createInvitation(session, userId, payload))


@router.get('/users/{userId}/buddies', response_model=list[BuddyRelationshipResponse])
async def listBuddies(userId: uuid.UUID, session: AsyncSession = Depends(get_session)) -> list[BuddyRelationshipResponse]:
    await user_service.require_user(session, userId)
    return [buddyService.relationshipResponse(relationship) for relationship in await buddyRepository.listRelationships(session, userId)]


@router.get('/users/{userId}/buddies/{relationshipId}', response_model=BuddyRelationshipResponse)
async def getBuddy(userId: uuid.UUID, relationshipId: uuid.UUID, session: AsyncSession = Depends(get_session)) -> BuddyRelationshipResponse:
    relationship = await buddyRepository.getRelationship(session, relationshipId)
    if relationship is None or relationship.userId != userId:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail='buddy relationship not found')
    return buddyService.relationshipResponse(relationship)


@router.delete('/users/{userId}/buddies/{relationshipId}', response_model=BuddyRelationshipResponse)
async def revokeBuddy(userId: uuid.UUID, relationshipId: uuid.UUID, session: AsyncSession = Depends(get_session)) -> BuddyRelationshipResponse:
    return buddyService.relationshipResponse(await buddyService.revokeRelationship(session, userId, relationshipId))


@router.get('/users/{buddyUserId}/buddy-invitations', response_model=list[BuddyRelationshipResponse])
async def listInvitations(buddyUserId: uuid.UUID, session: AsyncSession = Depends(get_session)) -> list[BuddyRelationshipResponse]:
    await user_service.require_user(session, buddyUserId)
    return [buddyService.relationshipResponse(relationship) for relationship in await buddyRepository.listInvitations(session, buddyUserId)]


@router.post('/buddy-invitations/{relationshipId}/accept', response_model=BuddyRelationshipResponse)
async def acceptInvitation(relationshipId: uuid.UUID, payload: AssistanceActor, session: AsyncSession = Depends(get_session)) -> BuddyRelationshipResponse:
    return buddyService.relationshipResponse(await buddyService.acceptInvitation(session, relationshipId, payload.actorUserId))


@router.post('/buddy-invitations/{relationshipId}/reject', response_model=BuddyRelationshipResponse)
async def rejectInvitation(relationshipId: uuid.UUID, payload: AssistanceActor, session: AsyncSession = Depends(get_session)) -> BuddyRelationshipResponse:
    return buddyService.relationshipResponse(await buddyService.rejectInvitation(session, relationshipId, payload.actorUserId))


@router.get('/users/{userId}/buddy-candidates', response_model=BuddyCandidatesResponse)
async def buddyCandidates(userId: uuid.UUID, session: AsyncSession = Depends(get_session)) -> BuddyCandidatesResponse:
    return BuddyCandidatesResponse(candidates=await buddyService.candidateBuddies(session, userId))
