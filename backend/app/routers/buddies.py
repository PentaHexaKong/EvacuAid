import uuid
from fastapi import HTTPException

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.auth import current_user, require_owner
from app.db.models import User
from app.models.buddy import BuddyCandidatesResponse, BuddyInvitationCreate, BuddyRelationshipResponse
from app.repositories import buddyRepository
from app.services import buddyService, user_service


router = APIRouter(prefix='/v1', tags=['buddies'])


@router.post('/users/{userId}/buddies/invitations', response_model=BuddyRelationshipResponse, status_code=status.HTTP_201_CREATED)
async def createInvitation(userId: uuid.UUID, payload: BuddyInvitationCreate, session: AsyncSession = Depends(get_session), actor: User = Depends(current_user)) -> BuddyRelationshipResponse:
    require_owner(userId, actor)
    return buddyService.relationshipResponse(await buddyService.createInvitation(session, userId, payload))


@router.get('/users/{userId}/buddies', response_model=list[BuddyRelationshipResponse])
async def listBuddies(userId: uuid.UUID, session: AsyncSession = Depends(get_session), actor: User = Depends(current_user)) -> list[BuddyRelationshipResponse]:
    require_owner(userId, actor)
    await user_service.require_user(session, userId)
    return [buddyService.relationshipResponse(relationship) for relationship in await buddyRepository.listRelationships(session, userId)]


@router.get('/users/{userId}/buddies/{relationshipId}', response_model=BuddyRelationshipResponse)
async def getBuddy(userId: uuid.UUID, relationshipId: uuid.UUID, session: AsyncSession = Depends(get_session), actor: User = Depends(current_user)) -> BuddyRelationshipResponse:
    require_owner(userId, actor)
    relationship = await buddyRepository.getRelationship(session, relationshipId)
    if relationship is None or relationship.userId != userId:
        raise HTTPException(status_code=404, detail='buddy relationship not found')
    return buddyService.relationshipResponse(relationship)


@router.delete('/users/{userId}/buddies/{relationshipId}', response_model=BuddyRelationshipResponse)
async def revokeBuddy(userId: uuid.UUID, relationshipId: uuid.UUID, session: AsyncSession = Depends(get_session), actor: User = Depends(current_user)) -> BuddyRelationshipResponse:
    require_owner(userId, actor)
    return buddyService.relationshipResponse(await buddyService.revokeRelationship(session, userId, relationshipId))


@router.get('/users/{buddyUserId}/buddy-invitations', response_model=list[BuddyRelationshipResponse])
async def listInvitations(buddyUserId: uuid.UUID, session: AsyncSession = Depends(get_session), actor: User = Depends(current_user)) -> list[BuddyRelationshipResponse]:
    require_owner(buddyUserId, actor)
    await user_service.require_user(session, buddyUserId)
    return [buddyService.relationshipResponse(relationship) for relationship in await buddyRepository.listInvitations(session, buddyUserId)]


@router.post('/buddy-invitations/{relationshipId}/accept', response_model=BuddyRelationshipResponse)
async def acceptInvitation(relationshipId: uuid.UUID, session: AsyncSession = Depends(get_session), actor: User = Depends(current_user)) -> BuddyRelationshipResponse:
    return buddyService.relationshipResponse(await buddyService.acceptInvitation(session, relationshipId, actor.id))


@router.post('/buddy-invitations/{relationshipId}/reject', response_model=BuddyRelationshipResponse)
async def rejectInvitation(relationshipId: uuid.UUID, session: AsyncSession = Depends(get_session), actor: User = Depends(current_user)) -> BuddyRelationshipResponse:
    return buddyService.relationshipResponse(await buddyService.rejectInvitation(session, relationshipId, actor.id))


@router.get('/users/{userId}/buddy-candidates', response_model=BuddyCandidatesResponse)
async def buddyCandidates(userId: uuid.UUID, session: AsyncSession = Depends(get_session), actor: User = Depends(current_user)) -> BuddyCandidatesResponse:
    require_owner(userId, actor)
    return BuddyCandidatesResponse(candidates=await buddyService.candidateBuddies(session, userId))
