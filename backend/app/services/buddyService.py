import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import BuddyRelationship
from app.models.buddy import BuddyCandidate, BuddyInvitationCreate, BuddyLevel, BuddyRelationshipResponse, BuddyStatus
from app.repositories import buddyRepository
from app.services import user_service


levelRank = {'PRIMARY': 0, 'SECONDARY': 1, 'COMMUNITY': 2}


def relationshipResponse(relationship: BuddyRelationship) -> BuddyRelationshipResponse:
    return BuddyRelationshipResponse(id=relationship.id, userId=relationship.userId, buddyUserId=relationship.buddyUserId, level=relationship.level, status=relationship.status, createdAt=relationship.createdAt, updatedAt=relationship.updatedAt, acceptedAt=relationship.acceptedAt)


async def createInvitation(session: AsyncSession, userId: uuid.UUID, payload: BuddyInvitationCreate) -> BuddyRelationship:
    if userId == payload.buddyUserId:
        raise HTTPException(status_code=422, detail='a user cannot be their own buddy')
    await user_service.require_user(session, userId)
    await user_service.require_user(session, payload.buddyUserId)
    if await buddyRepository.getRelationshipForPair(session, userId, payload.buddyUserId):
        raise HTTPException(status_code=409, detail='an active or pending relationship already exists')
    relationship = BuddyRelationship(userId=userId, buddyUserId=payload.buddyUserId, level=payload.level.value, status='PENDING')
    session.add(relationship)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status_code=409, detail='an active or pending relationship already exists')
    await session.refresh(relationship)
    return relationship


async def acceptInvitation(session: AsyncSession, relationshipId: uuid.UUID, actorUserId: uuid.UUID) -> BuddyRelationship:
    relationship = await buddyRepository.getRelationship(session, relationshipId, lock=True)
    if relationship is None:
        raise HTTPException(status_code=404, detail='buddy relationship not found')
    if relationship.buddyUserId != actorUserId:
        raise HTTPException(status_code=403, detail='only the invited buddy can accept')
    if relationship.status != 'PENDING':
        raise HTTPException(status_code=409, detail='only pending invitations can be accepted')
    relationship.status = 'ACTIVE'
    relationship.acceptedAt = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(relationship)
    return relationship


async def rejectInvitation(session: AsyncSession, relationshipId: uuid.UUID, actorUserId: uuid.UUID) -> BuddyRelationship:
    relationship = await buddyRepository.getRelationship(session, relationshipId, lock=True)
    if relationship is None:
        raise HTTPException(status_code=404, detail='buddy relationship not found')
    if relationship.buddyUserId != actorUserId:
        raise HTTPException(status_code=403, detail='only the invited buddy can reject')
    if relationship.status != 'PENDING':
        raise HTTPException(status_code=409, detail='only pending invitations can be rejected')
    relationship.status = 'REJECTED'
    await session.commit()
    await session.refresh(relationship)
    return relationship


async def revokeRelationship(session: AsyncSession, userId: uuid.UUID, relationshipId: uuid.UUID) -> BuddyRelationship:
    relationship = await buddyRepository.getRelationship(session, relationshipId, lock=True)
    if relationship is None or relationship.userId != userId:
        raise HTTPException(status_code=404, detail='buddy relationship not found')
    if relationship.status not in ('PENDING', 'ACTIVE'):
        raise HTTPException(status_code=409, detail='only pending or active relationships can be revoked')
    relationship.status = 'REVOKED'
    await session.commit()
    await session.refresh(relationship)
    return relationship


async def candidateBuddies(session: AsyncSession, userId: uuid.UUID) -> list[BuddyCandidate]:
    user = await user_service.require_user(session, userId)
    rows = await buddyRepository.listCandidates(session, user)
    candidates: list[BuddyCandidate] = []
    for relationship, buddy, distanceM, activeAssignments in rows:
        locationAvailable = distanceM is not None
        available = activeAssignments == 0
        reasons = [f'{relationship.level}_BUDDY']
        reasons.append('AVAILABLE' if available else 'ACTIVE_ASSIGNMENT')
        reasons.append('LOCATION_AVAILABLE' if locationAvailable else 'LOCATION_UNAVAILABLE')
        candidates.append(BuddyCandidate(buddyUserId=buddy.id, relationshipId=relationship.id, level=relationship.level, distanceM=round(distanceM, 2) if distanceM is not None else None, locationAvailable=locationAvailable, available=available, activeAssignments=activeAssignments, rank=0, selectionReasons=reasons))
    candidates.sort(key=lambda candidate: (levelRank[candidate.level.value], not candidate.available, candidate.distanceM is None, candidate.distanceM if candidate.distanceM is not None else float('inf'), str(candidate.buddyUserId)))
    for index, candidate in enumerate(candidates, start=1):
        candidate.rank = index
    return candidates
