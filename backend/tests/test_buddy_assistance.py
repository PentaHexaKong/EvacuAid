import pytest
from datetime import datetime, timezone
from fastapi import HTTPException

from app.models.assistance import AssistanceCreate
from app.models.buddy import BuddyInvitationCreate
from app.services import assistanceService, buddyService, user_service
from app.models.user import LocationUpdate, UserCreate, UserUpdate


async def createUser(dbSession, name, latitude=None, longitude=None):
    user = await user_service.create_user(dbSession, UserCreate(name=name))
    if latitude is not None:
        await user_service.update_location(dbSession, user.id, LocationUpdate(latitude=latitude, longitude=longitude, observed_at=datetime.now(timezone.utc)))
    return user


async def activeRelationship(dbSession, user, buddy, level='PRIMARY'):
    invitation = await buddyService.createInvitation(dbSession, user.id, BuddyInvitationCreate(buddyUserId=buddy.id, level=level))
    return await buddyService.acceptInvitation(dbSession, invitation.id, buddy.id)


@pytest.mark.asyncio
async def testInvitationLifecycleAndAuthorization(dbSession):
    user = await createUser(dbSession, 'Ayu')
    buddy = await createUser(dbSession, 'Bima')
    invitation = await buddyService.createInvitation(dbSession, user.id, BuddyInvitationCreate(buddyUserId=buddy.id, level='PRIMARY'))
    assert invitation.status == 'PENDING'
    with pytest.raises(HTTPException) as wrongActor:
        await buddyService.acceptInvitation(dbSession, invitation.id, user.id)
    assert wrongActor.value.status_code == 403
    accepted = await buddyService.acceptInvitation(dbSession, invitation.id, buddy.id)
    assert accepted.status == 'ACTIVE'
    revoked = await buddyService.revokeRelationship(dbSession, user.id, invitation.id)
    assert revoked.status == 'REVOKED'


@pytest.mark.asyncio
async def testSelfAndDuplicateBuddyAreRejected(dbSession):
    user = await createUser(dbSession, 'Citra')
    with pytest.raises(HTTPException) as selfBuddy:
        await buddyService.createInvitation(dbSession, user.id, BuddyInvitationCreate(buddyUserId=user.id, level='PRIMARY'))
    assert selfBuddy.value.status_code == 422
    buddy = await createUser(dbSession, 'Dewi')
    await buddyService.createInvitation(dbSession, user.id, BuddyInvitationCreate(buddyUserId=buddy.id, level='SECONDARY'))
    with pytest.raises(HTTPException) as duplicate:
        await buddyService.createInvitation(dbSession, user.id, BuddyInvitationCreate(buddyUserId=buddy.id, level='SECONDARY'))
    assert duplicate.value.status_code == 409


@pytest.mark.asyncio
async def testRejectInvitationDoesNotProduceActiveBuddy(dbSession):
    user = await createUser(dbSession, 'Eka')
    buddy = await createUser(dbSession, 'Fajar')
    invitation = await buddyService.createInvitation(dbSession, user.id, BuddyInvitationCreate(buddyUserId=buddy.id, level='COMMUNITY'))
    rejected = await buddyService.rejectInvitation(dbSession, invitation.id, buddy.id)
    candidates = await buddyService.candidateBuddies(dbSession, user.id)
    assert rejected.status == 'REJECTED'
    assert candidates == []


@pytest.mark.asyncio
async def testCandidatesUsePostgisDistanceAndLevelRanking(dbSession):
    user = await createUser(dbSession, 'Gita', -6.2000, 106.8000)
    primary = await createUser(dbSession, 'Hadi', -6.2100, 106.8000)
    secondary = await createUser(dbSession, 'Indra', -6.2005, 106.8000)
    missingLocation = await createUser(dbSession, 'Joko')
    await activeRelationship(dbSession, user, primary, 'PRIMARY')
    await activeRelationship(dbSession, user, secondary, 'SECONDARY')
    await activeRelationship(dbSession, user, missingLocation, 'COMMUNITY')
    await user_service.update_user(dbSession, user.id, UserUpdate(share_location_with_buddies=True))
    await user_service.update_user(dbSession, primary.id, UserUpdate(share_location_with_buddies=True))
    await user_service.update_user(dbSession, secondary.id, UserUpdate(share_location_with_buddies=True))
    candidates = await buddyService.candidateBuddies(dbSession, user.id)
    assert [candidate.buddyUserId for candidate in candidates] == [primary.id, secondary.id, missingLocation.id]
    assert candidates[0].distanceM is not None
    assert candidates[2].locationAvailable is False
    assert candidates[0].selectionReasons[0] == 'PRIMARY_BUDDY'


@pytest.mark.asyncio
async def testAssistanceStateMachineAndTerminalProtection(dbSession):
    user = await createUser(dbSession, 'Kiki')
    buddy = await createUser(dbSession, 'Lina')
    await activeRelationship(dbSession, user, buddy)
    request = await assistanceService.createRequest(dbSession, user.id, AssistanceCreate(buddyUserId=buddy.id))
    assert request.status == 'REQUESTED'
    notified = await assistanceService.transitionRequest(dbSession, request.id, 'notify', user.id)
    accepted = await assistanceService.transitionRequest(dbSession, request.id, 'accept', buddy.id)
    departed = await assistanceService.transitionRequest(dbSession, request.id, 'depart', buddy.id)
    arrived = await assistanceService.transitionRequest(dbSession, request.id, 'arrive', buddy.id)
    completed = await assistanceService.transitionRequest(dbSession, request.id, 'safe', buddy.id)
    assert notified.notifiedAt is not None
    assert accepted.acceptedAt is not None
    assert departed.enRouteAt is not None
    assert arrived.arrivedAt is not None
    assert completed.safeAt is not None
    with pytest.raises(HTTPException) as invalid:
        await assistanceService.transitionRequest(dbSession, request.id, 'depart', buddy.id)
    assert invalid.value.status_code == 409


@pytest.mark.asyncio
async def testUnassignedRequestCanBeNotifiedWithActiveCandidate(dbSession):
    user = await createUser(dbSession, 'Maya')
    buddy = await createUser(dbSession, 'Nina')
    await activeRelationship(dbSession, user, buddy, 'SECONDARY')
    request = await assistanceService.createRequest(dbSession, user.id, AssistanceCreate())
    notified = await assistanceService.transitionRequest(dbSession, request.id, 'notify', user.id, buddy.id)
    assert notified.buddyUserId == buddy.id
    assert notified.status == 'NOTIFIED'
