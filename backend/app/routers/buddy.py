import hashlib
import secrets
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import current_user
from app.db.session import get_session
from app.db.models import BuddyRelationship, User, UserAccessibility
from app.db.models.buddySession import BuddyAttempt, BuddyAvailability, BuddyInbox, BuddyInvitation, BuddyLocation, BuddyMessage, BuddyPushToken, BuddyRequest
from app.models.buddyRequest import AttemptAction, AvailabilityUpdate, BeaconSearch, InviteDirect, InviteRedeem, MessageCreate, NearbyHelperSelection, NearbySearch, PhoneSharing, PushToken, RequestCreate, SessionLocation, SessionRoute
from app.services import alertService
from app.services import buddyRequestService as service
from app.services.buddyService import relationshipResponse
from app.utils.geo import calculate_distance_meters


router = APIRouter(tags=['Buddy'])
BUDDY_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
DIRECT_INVITATIONS_PER_DAY = 20


async def user_needs(db, ids):
    if not ids:
        return {}
    needs = {user_id: [] for user_id in ids}
    for user_id, kind in (await db.execute(select(UserAccessibility.user_id, UserAccessibility.type).where(UserAccessibility.user_id.in_(ids)).order_by(UserAccessibility.type))).all():
        needs[user_id].append(kind)
    return needs


def discloses_needs(invite, actor_id):
    return invite.code_hash is None and invite.direction == 'SEEK_HELP' and invite.status == 'SENT' and actor_id == invite.redeemer_id


async def invitation_responses(db, rows, actor_id=None, code=None):
    ids = {user_id for row in rows for user_id in (row.owner_id, row.redeemer_id) if user_id}
    names = dict((await db.execute(select(User.id, User.name).where(User.id.in_(ids)))).all()) if ids else {}
    needs = await user_needs(db, {row.owner_id for row in rows if discloses_needs(row, actor_id)})
    now = service.now()
    return [{'id': row.id, **({'code': code} if code else {}), 'expiresAt': row.expires_at, 'status': 'EXPIRED' if row.expires_at <= now and row.status in ('PENDING', 'REDEEMED', 'SENT') else row.status, 'redeemerUserId': row.redeemer_id, 'redeemerName': names.get(row.redeemer_id), 'direction': row.direction, 'relation': row.relation, 'ownerName': names.get(row.owner_id), 'ownerUserId': row.owner_id, 'ownerNeeds': needs[row.owner_id] if discloses_needs(row, actor_id) else []} for row in rows]


async def invitation_response(db, invite, code=None, actor_id=None):
    return (await invitation_responses(db, [invite], actor_id, code))[0]


async def activate_relationship(db, user_id, buddy_id, relation=None):
    relationship = (await db.execute(select(BuddyRelationship).where(BuddyRelationship.userId == user_id, BuddyRelationship.buddyUserId == buddy_id, BuddyRelationship.status.in_(('ACTIVE', 'PENDING'))).with_for_update())).scalar_one_or_none()
    if not relationship:
        has_primary = (await db.execute(select(BuddyRelationship.id).where(BuddyRelationship.userId == user_id, BuddyRelationship.level == 'PRIMARY', BuddyRelationship.status == 'ACTIVE'))).first()
        relationship = BuddyRelationship(userId=user_id, buddyUserId=buddy_id, level='SECONDARY' if has_primary else 'PRIMARY')
        db.add(relationship)
    relationship.status, relationship.acceptedAt = 'ACTIVE', service.now()
    if relation:
        relationship.relation = relation


@router.get('/me/code')
async def personal_code(db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    code = (await db.execute(select(User.buddy_code).where(User.id == actor.id).with_for_update())).scalar_one()
    while not code:
        value = ''.join(secrets.choice(BUDDY_CODE_ALPHABET) for _ in range(8))
        candidate = f'{value[:4]}-{value[4:]}'
        try:
            async with db.begin_nested():
                await db.execute(update(User).where(User.id == actor.id).values(buddy_code=candidate))
            code = candidate
        except IntegrityError:
            pass
    await db.commit()
    return {'code': code}


@router.get('/me/beacon')
async def personal_beacon(db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    value = await service.beacon_id(db, actor.id)
    await db.commit()
    return {'beaconId': value}


@router.post('/invitations/direct', status_code=201)
async def direct_invitation(payload: InviteDirect, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    value = ''.join(payload.code.upper().split()).replace('-', '')
    if len(value) != 8 or any(char not in BUDDY_CODE_ALPHABET for char in value):
        raise HTTPException(422, 'invalid buddy code')
    target = (await db.execute(select(User.id).where(User.buddy_code == f'{value[:4]}-{value[4:]}'))).scalar_one_or_none()
    if not target:
        raise HTTPException(404, 'buddy code not found')
    if target == actor.id:
        raise HTTPException(409, 'self invitation')
    await service.lock_users(db, [actor.id, target])
    user_id, buddy_id = (actor.id, target) if payload.direction == 'SEEK_HELP' else (target, actor.id)
    relationship = (await db.execute(select(BuddyRelationship.id).where(BuddyRelationship.userId == user_id, BuddyRelationship.buddyUserId == buddy_id, BuddyRelationship.status == 'ACTIVE'))).first()
    pending = (await db.execute(select(BuddyInvitation.id).where(BuddyInvitation.owner_id == actor.id, BuddyInvitation.redeemer_id == target, BuddyInvitation.direction == payload.direction, BuddyInvitation.status == 'SENT', BuddyInvitation.expires_at > service.now()))).first()
    if relationship or pending:
        raise HTTPException(409, 'relationship or invitation already exists')
    if await db.scalar(select(func.count()).select_from(BuddyInvitation).where(BuddyInvitation.owner_id == actor.id, BuddyInvitation.code_hash.is_(None), BuddyInvitation.created_at > service.now() - timedelta(days=1))) >= DIRECT_INVITATIONS_PER_DAY:
        raise HTTPException(429, 'too many invitations today')
    row = BuddyInvitation(owner_id=actor.id, redeemer_id=target, status='SENT', direction=payload.direction, relation=payload.relation, code_hash=None, expires_at=service.now() + timedelta(days=7))
    db.add(row)
    await db.flush()
    await service.event(db, target, None, 'INVITATION_RECEIVED', {'invitationId': str(row.id)})
    await db.commit()
    return await invitation_response(db, row, actor_id=actor.id)


@router.get('/invitations/received')
async def received_invitations(db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    rows = (await db.execute(select(BuddyInvitation).where(BuddyInvitation.redeemer_id == actor.id, BuddyInvitation.status == 'SENT', BuddyInvitation.expires_at > service.now()).order_by(BuddyInvitation.created_at.desc()))).scalars().all()
    return await invitation_responses(db, rows, actor.id)


@router.post('/invitations', status_code=201)
async def invite(db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    code = secrets.token_urlsafe(12)
    row = BuddyInvitation(owner_id=actor.id, code_hash=hashlib.sha256(code.encode()).hexdigest(), expires_at=service.now() + timedelta(hours=24))
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return await invitation_response(db, row, code)


@router.get('/invitations')
async def invitations(db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    rows = (await db.execute(select(BuddyInvitation).where(BuddyInvitation.owner_id == actor.id).order_by(BuddyInvitation.created_at.desc()))).scalars().all()
    return await invitation_responses(db, rows, actor.id)


@router.post('/invitations/redeem')
async def redeem(payload: InviteRedeem, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    row = (await db.execute(select(BuddyInvitation).where(BuddyInvitation.code_hash == hashlib.sha256(payload.code.strip().encode()).hexdigest()).with_for_update())).scalar_one_or_none()
    if not row or row.expires_at <= service.now() or row.status not in ('PENDING', 'REDEEMED'):
        raise HTTPException(409, 'invitation unavailable')
    if row.owner_id == actor.id or row.redeemer_id not in (None, actor.id):
        raise HTTPException(409, 'invitation already redeemed or self invitation')
    if row.status == 'REDEEMED' and row.redeemer_id == actor.id:
        return await invitation_response(db, row)
    row.redeemer_id, row.status = actor.id, 'REDEEMED'
    await service.event(db, row.owner_id, None, 'INVITATION_REDEEMED', {'invitationId': str(row.id)})
    await db.commit()
    return await invitation_response(db, row)


@router.post('/invitations/{invitation_id}/confirm')
async def confirm_invitation(invitation_id: uuid.UUID, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    row = (await db.execute(select(BuddyInvitation).where(BuddyInvitation.id == invitation_id).with_for_update())).scalar_one_or_none()
    if not row or row.owner_id != actor.id:
        raise HTTPException(404, 'invitation not found')
    if row.status == 'CONFIRMED':
        return await invitation_response(db, row)
    if row.status != 'REDEEMED' or row.expires_at <= service.now():
        raise HTTPException(409, 'redeemed unexpired invitation required')
    await service.lock_users(db, [actor.id, row.redeemer_id])
    await activate_relationship(db, actor.id, row.redeemer_id)
    row.status = 'CONFIRMED'
    await service.event(db, row.redeemer_id, None, 'INVITATION_CONFIRMED', {'invitationId': str(row.id)})
    await db.commit()
    return await invitation_response(db, row)


@router.delete('/invitations/{invitation_id}')
async def revoke_invitation(invitation_id: uuid.UUID, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    row = (await db.execute(select(BuddyInvitation).where(BuddyInvitation.id == invitation_id).with_for_update())).scalar_one_or_none()
    if not row or row.owner_id != actor.id:
        raise HTTPException(404, 'invitation not found')
    if row.status == 'CONFIRMED':
        raise HTTPException(409, 'remove confirmed contact through buddy relationship endpoint')
    row.status = 'REVOKED'
    await db.commit()
    return await invitation_response(db, row, actor_id=actor.id)


@router.post('/invitations/{invitation_id}/accept')
async def accept_invitation(invitation_id: uuid.UUID, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    row = (await db.execute(select(BuddyInvitation).where(BuddyInvitation.id == invitation_id).with_for_update())).scalar_one_or_none()
    if not row or row.redeemer_id != actor.id or row.code_hash is not None:
        raise HTTPException(404, 'invitation not found')
    if row.status == 'CONFIRMED':
        return await invitation_response(db, row, actor_id=actor.id)
    if row.status != 'SENT' or row.expires_at <= service.now():
        raise HTTPException(409, 'sent unexpired invitation required')
    await service.lock_users(db, [row.owner_id, actor.id])
    user_id, buddy_id = (row.owner_id, actor.id) if row.direction == 'SEEK_HELP' else (actor.id, row.owner_id)
    await activate_relationship(db, user_id, buddy_id, row.relation)
    row.status = 'CONFIRMED'
    await service.event(db, row.owner_id, None, 'INVITATION_ACCEPTED', {'invitationId': str(row.id)})
    await db.commit()
    return await invitation_response(db, row, actor_id=actor.id)


@router.post('/invitations/{invitation_id}/decline')
async def decline_invitation(invitation_id: uuid.UUID, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    row = (await db.execute(select(BuddyInvitation).where(BuddyInvitation.id == invitation_id).with_for_update())).scalar_one_or_none()
    if not row or row.redeemer_id != actor.id or row.code_hash is not None:
        raise HTTPException(404, 'invitation not found')
    if row.status != 'SENT' or row.expires_at <= service.now():
        raise HTTPException(409, 'sent unexpired invitation required')
    row.status = 'DECLINED'
    await db.commit()
    return await invitation_response(db, row, actor_id=actor.id)


@router.get('/contacts')
async def contacts(db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    rows = (await db.execute(select(BuddyRelationship, User.name, BuddyAvailability.opted_in, BuddyAvailability.observed_at).join(User, User.id == BuddyRelationship.buddyUserId).outerjoin(BuddyAvailability, BuddyAvailability.user_id == User.id).where(BuddyRelationship.userId == actor.id, BuddyRelationship.status == 'ACTIVE'))).all()
    cutoff = service.now() - timedelta(minutes=2)
    beacons = {user_id: await service.beacon_id(db, user_id) for user_id in sorted({row.buddyUserId for row, name, opted_in, observed_at in rows})}
    await db.commit()
    return [{**relationshipResponse(row).model_dump(), 'name': name, 'beaconId': beacons[row.buddyUserId], 'available': bool(opted_in and observed_at and observed_at >= cutoff), 'observedAt': observed_at, 'relation': row.relation} for row, name, opted_in, observed_at in rows]


@router.get('/contacts/incoming')
async def incoming_contacts(db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    rows = (await db.execute(select(BuddyRelationship, User.name).join(User, User.id == BuddyRelationship.userId).where(BuddyRelationship.buddyUserId == actor.id, BuddyRelationship.status == 'ACTIVE'))).all()
    needs = await user_needs(db, [row.userId for row, name in rows])
    responses = await alertService.latestResponses(db, [row.userId for row, name in rows])
    beacons = {user_id: await service.beacon_id(db, user_id) for user_id in sorted({row.userId for row, name in rows})}
    await db.commit()
    return [{**relationshipResponse(row).model_dump(), 'name': name, 'beaconId': beacons[row.userId], 'needs': needs[row.userId], 'relation': row.relation, 'latestAlertResponse': responses.get(row.userId)} for row, name in rows]


@router.delete('/contacts/{contact_id}')
async def remove_contact(contact_id: uuid.UUID, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    row = (await db.execute(select(BuddyRelationship).where(BuddyRelationship.id == contact_id).with_for_update())).scalar_one_or_none()
    if not row or actor.id not in (row.userId, row.buddyUserId):
        raise HTTPException(404, 'contact not found')
    row.status = 'REVOKED'
    await db.commit()
    await db.refresh(row)
    return relationshipResponse(row)


@router.post('/contacts/{contact_id}/primary')
async def primary_contact(contact_id: uuid.UUID, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    await service.lock_users(db, [actor.id])
    rows = (await db.execute(select(BuddyRelationship).where(BuddyRelationship.userId == actor.id, BuddyRelationship.status == 'ACTIVE').with_for_update())).scalars().all()
    chosen = next((row for row in rows if row.id == contact_id), None)
    if not chosen:
        raise HTTPException(404, 'contact not found')
    for row in rows:
        row.level = 'PRIMARY' if row.id == contact_id else 'SECONDARY'
    await db.commit()
    await db.refresh(chosen)
    return relationshipResponse(chosen)


async def availability_row(db, actor):
    await service.lock_users(db, [actor.id])
    row = await db.get(BuddyAvailability, actor.id)
    if not row:
        row = BuddyAvailability(user_id=actor.id, opted_in=False)
        db.add(row)
    return row


async def availability_response(db, row):
    return {'enrolled': bool(await db.scalar(select(service.is_buddy(row.user_id)))), 'optedIn': row.opted_in, 'observedAt': row.observed_at}


@router.get('/availability')
async def availability(db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    row = await availability_row(db, actor)
    await db.commit()
    return await availability_response(db, row)


@router.put('/availability')
async def update_availability(payload: AvailabilityUpdate, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    row = await availability_row(db, actor)
    if payload.refreshOnly and (not payload.optedIn or not row.opted_in):
        raise HTTPException(409, 'availability refresh requires an active opt-in')
    if payload.optedIn:
        if payload.latitude is None or payload.longitude is None or payload.observedAt is None or payload.accuracyM is None or payload.observedAt.tzinfo is None or not service.now() - timedelta(minutes=2) <= payload.observedAt <= service.now() + timedelta(seconds=30):
            raise HTTPException(422, 'fresh accurate availability location required')
        row.latitude, row.longitude, row.observed_at, row.accuracy_m = payload.latitude, payload.longitude, payload.observedAt, payload.accuracyM
    else:
        row.latitude = row.longitude = row.observed_at = row.accuracy_m = None
    row.opted_in = payload.optedIn
    await db.commit()
    return await availability_response(db, row)


@router.post('/requests', status_code=201)
async def create_request(payload: RequestCreate, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    await service.lock_users(db, [actor.id] + ([payload.helperUserId] if payload.helperUserId else []))
    existing = (await db.execute(select(BuddyRequest).where(BuddyRequest.idempotency_key == payload.idempotencyKey))).scalar_one_or_none()
    if existing:
        if existing.requester_id != actor.id:
            raise HTTPException(409, 'idempotency key unavailable')
        return await service.response(db, existing, actor.id)
    if not payload.sharingConsent or actor.id == payload.helperUserId:
        raise HTTPException(422, 'sharing consent and another helper required')
    if (payload.latitude is None) != (payload.longitude is None):
        raise HTTPException(422, 'coordinates must be a pair')
    relationship = (await db.execute(select(BuddyRelationship.id).where(BuddyRelationship.userId == actor.id, BuddyRelationship.buddyUserId == payload.helperUserId, BuddyRelationship.status == 'ACTIVE'))).first()
    if payload.helperUserId and not relationship:
        raise HTTPException(409, 'confirmed trusted contact required')
    if await service.occupied(db, actor.id) or (payload.helperUserId and await service.occupied(db, payload.helperUserId)):
        raise HTTPException(409, 'participant already has active assistance')
    row = BuddyRequest(requester_id=actor.id, status='WAITING' if payload.helperUserId else 'FALLBACK_REQUIRED', buddy_flow=True, message=payload.message, support_needs=payload.supportNeeds, sharing_consent=True, idempotency_key=payload.idempotencyKey, latitude=payload.latitude, longitude=payload.longitude)
    db.add(row)
    await db.flush()
    if payload.helperUserId:
        await service.offer(db, row, payload.helperUserId, 120)
    await db.commit()
    return await service.response(db, row, actor.id)


@router.get('/requests/current')
async def current_request(db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    request = await service.current_request(db, actor.id, include_offers=True)
    if not request:
        return None
    try:
        row = await service.get_request(db, request.id, actor.id)
    except HTTPException:
        return None
    return await service.response(db, row, actor.id)


@router.get('/requests/{request_id}')
async def request_detail(request_id: uuid.UUID, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    row = await service.get_request(db, request_id, actor.id)
    return await service.response(db, row, actor.id)


@router.post('/requests/{request_id}/nearby')
async def nearby(request_id: uuid.UUID, payload: NearbySearch, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    row = await service.get_request(db, request_id, actor.id)
    if row.requester_id != actor.id:
        raise HTTPException(403, 'requester only')
    if row.nearby:
        return await service.response(db, row, actor.id)
    if payload.observedAt < service.now() - timedelta(minutes=2) or payload.accuracyM is None or payload.accuracyM > 100:
        raise HTTPException(422, 'fresh accurate nearby origin required')
    row.latitude, row.longitude = payload.latitude, payload.longitude
    if row.status != 'FALLBACK_REQUIRED':
        raise HTTPException(409, 'fallback and search location required')
    availability = (await db.execute(select(BuddyAvailability).where(BuddyAvailability.opted_in.is_(True), BuddyAvailability.observed_at > service.now() - timedelta(minutes=2), BuddyAvailability.user_id != actor.id))).scalars()
    candidates = [(calculate_distance_meters(row.latitude, row.longitude, a.latitude, a.longitude), a.user_id) for a in availability if a.latitude is not None and a.longitude is not None and not await service.occupied(db, a.user_id)]
    row.candidates = [str(user) for distance, user in sorted(candidates) if distance <= 5000][:5]
    row.nearby = True
    row.nearby_started_at = service.now()
    await service.advance(db, row)
    await db.commit()
    return await service.response(db, row, actor.id)


@router.post('/requests/{request_id}/nearby/helper')
async def nearby_helper(request_id: uuid.UUID, payload: NearbyHelperSelection, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    row = await service.get_request(db, request_id, actor.id)
    if row.requester_id != actor.id:
        raise HTTPException(403, 'requester only')
    if not row.nearby or row.status != 'WAITING' or row.helper_id is not None or not row.sharing_consent or (row.nearby_started_at or row.created_at) <= service.now() - timedelta(minutes=10):
        raise HTTPException(409, 'nearby request unavailable')
    helper = (await db.execute(select(User.id).where(User.beacon_id == payload.beaconId))).scalar_one_or_none()
    if helper is None or helper == actor.id:
        raise HTTPException(409, 'nearby helper unavailable')
    await service.lock_users(db, [row.requester_id, helper])
    eligibility = await db.get(BuddyAvailability, helper, populate_existing=True)
    if not eligibility or not eligibility.opted_in or not eligibility.observed_at or eligibility.observed_at <= service.now() - timedelta(minutes=2) or await service.occupied(db, helper, row.id):
        raise HTTPException(409, 'nearby helper unavailable')
    attempt = (await db.execute(select(BuddyAttempt).where(BuddyAttempt.request_id == row.id, BuddyAttempt.helper_id == helper).order_by(BuddyAttempt.created_at.desc()).limit(1))).scalar_one_or_none()
    if attempt:
        if attempt.status != 'PENDING' or attempt.expires_at <= service.now():
            raise HTTPException(409, 'nearby helper unavailable')
    else:
        attempt = await service.offer(db, row, helper, 30, source='BLE')
    await db.commit()
    response = await service.response(db, row, actor.id)
    response['selectedAttemptId'] = attempt.id
    return response


@router.post('/nearby/beacons')
async def nearby_beacons(payload: BeaconSearch, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    eligibility = await db.get(BuddyAvailability, actor.id)
    if not eligibility or not eligibility.opted_in or not eligibility.observed_at or eligibility.observed_at <= service.now() - timedelta(minutes=2):
        raise HTTPException(409, 'helper availability expired')
    rows = (await db.execute(select(BuddyRequest).join(User, User.id == BuddyRequest.requester_id).where(User.beacon_id.in_(payload.beaconIds), BuddyRequest.requester_id != actor.id, BuddyRequest.buddy_flow.is_(True), BuddyRequest.nearby.is_(True), BuddyRequest.status == 'WAITING', BuddyRequest.helper_id.is_(None), func.coalesce(BuddyRequest.nearby_started_at, BuddyRequest.created_at) > service.now() - timedelta(minutes=10)).order_by(BuddyRequest.created_at, BuddyRequest.id).limit(10).with_for_update(of=BuddyRequest))).scalars().all()
    for row in rows:
        await service.lock_users(db, [row.requester_id, actor.id])
        eligibility = await db.get(BuddyAvailability, actor.id, populate_existing=True)
        if not eligibility or not eligibility.opted_in or not eligibility.observed_at or eligibility.observed_at <= service.now() - timedelta(minutes=2):
            raise HTTPException(409, 'helper availability expired')
        if await service.occupied(db, actor.id, row.id):
            raise HTTPException(409, 'helper already occupied')
        attempt = (await db.execute(select(BuddyAttempt).where(BuddyAttempt.request_id == row.id, BuddyAttempt.helper_id == actor.id).order_by(BuddyAttempt.created_at.desc()).limit(1))).scalar_one_or_none()
        if attempt:
            if attempt.status != 'PENDING' or attempt.expires_at <= service.now():
                continue
        else:
            await service.offer(db, row, actor.id, 30, source='BLE')
        await db.commit()
        return [await service.response(db, row, actor.id)]
    await db.commit()
    return []


@router.post('/requests/{request_id}/accept')
async def accept(request_id: uuid.UUID, payload: AttemptAction, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    row = await service.get_request(db, request_id, actor.id)
    if row.helper_id == actor.id and row.status in service.CONNECTED:
        return await service.response(db, row, actor.id)
    attempt = await db.get(BuddyAttempt, payload.attemptId)
    if not payload.sharingConsent or not attempt or attempt.request_id != row.id or attempt.helper_id != actor.id or attempt.status != 'PENDING' or attempt.expires_at <= service.now() or row.status != 'WAITING':
        raise HTTPException(409, 'offer expired or consent missing')
    await service.lock_users(db, [row.requester_id, actor.id])
    if await service.occupied(db, actor.id, row.id):
        raise HTTPException(409, 'helper already occupied')
    if row.nearby:
        if (row.nearby_started_at or row.created_at) <= service.now() - timedelta(minutes=10):
            raise HTTPException(409, 'nearby request expired')
        eligibility = await db.get(BuddyAvailability, actor.id)
        if not eligibility or not eligibility.opted_in or not eligibility.observed_at or eligibility.observed_at <= service.now() - timedelta(minutes=2):
            raise HTTPException(409, 'helper availability expired')
    else:
        relationship = (await db.execute(select(BuddyRelationship.id).where(BuddyRelationship.userId == row.requester_id, BuddyRelationship.buddyUserId == actor.id, BuddyRelationship.status == 'ACTIVE').with_for_update())).first()
        if not relationship:
            raise HTTPException(409, 'trusted relationship revoked')
    row.helper_id, row.status, row.acceptedAt = actor.id, 'ACCEPTED', service.now()
    row.latitude = row.longitude = None
    row.candidates = []
    attempt.status = 'ACCEPTED'
    await db.execute(update(BuddyAttempt).where(BuddyAttempt.request_id == row.id, BuddyAttempt.id != attempt.id, BuddyAttempt.status == 'PENDING').values(status='CANCELLED'))
    await service.session_event(db, row)
    await db.commit()
    return await service.response(db, row, actor.id)


@router.post('/requests/{request_id}/decline')
async def decline(request_id: uuid.UUID, payload: AttemptAction, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    row = await service.get_request(db, request_id, actor.id)
    attempt = await db.get(BuddyAttempt, payload.attemptId)
    if not attempt or attempt.request_id != row.id or attempt.helper_id != actor.id or attempt.status != 'PENDING' or attempt.expires_at <= service.now() or row.status != 'WAITING':
        raise HTTPException(409, 'offer unavailable')
    attempt.status = 'DECLINED'
    await db.flush()
    await service.advance(db, row)
    await db.commit()
    return await service.response(db, row, actor.id)


@router.get('/inbox')
async def inbox(db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    rows = (await db.execute(select(BuddyInbox).where(BuddyInbox.user_id == actor.id, BuddyInbox.kind != 'ALERT').order_by(BuddyInbox.created_at.desc()).limit(100))).scalars()
    return [{'id': row.id, 'requestId': row.request_id, 'kind': row.kind, 'payload': row.payload, 'read': row.read, 'createdAt': row.created_at} for row in rows]


@router.post('/inbox/{inbox_id}/read')
async def read_inbox(inbox_id: uuid.UUID, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    row = await db.get(BuddyInbox, inbox_id)
    if not row or row.user_id != actor.id:
        raise HTTPException(404, 'inbox event not found')
    row.read = True
    await db.commit()
    return {'read': True}


@router.put('/push-token')
async def push_token(payload: PushToken, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    await service.lock_users(db, [actor.id])
    row = (await db.execute(select(BuddyPushToken).where(BuddyPushToken.token == payload.token).with_for_update())).scalar_one_or_none()
    if row and row.user_id != actor.id:
        raise HTTPException(409, 'push token belongs to another guest')
    if not row:
        db.add(BuddyPushToken(token=payload.token, user_id=actor.id))
    await db.commit()
    return {'registered': True}


@router.delete('/push-token')
async def remove_push_token(payload: PushToken, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    await db.execute(delete(BuddyPushToken).where(BuddyPushToken.token == payload.token, BuddyPushToken.user_id == actor.id))
    await db.commit()
    return {'registered': False}


@router.put('/requests/{request_id}/location')
async def update_location(request_id: uuid.UUID, payload: SessionLocation, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    request = await service.get_request(db, request_id, actor.id, connected=True)
    version = request.requester_location_version if actor.id == request.requester_id else request.helper_location_version
    row = await db.get(BuddyLocation, (request_id, actor.id))
    if payload.sharingConsent and payload.sharingVersion != version:
        raise HTTPException(409, 'location sharing version changed; refresh consent')
    if not row and not payload.sharingConsent:
        raise HTTPException(409, 'explicit location consent required')
    if row and payload.observedAt <= row.observed_at:
        return {'updated': False}
    if not row:
        row = BuddyLocation(request_id=request_id, user_id=actor.id)
        db.add(row)
    row.latitude, row.longitude, row.accuracy_m, row.observed_at = payload.latitude, payload.longitude, payload.accuracyM, payload.observedAt
    await db.commit()
    return {'updated': True}


@router.delete('/requests/{request_id}/location')
async def stop_location(request_id: uuid.UUID, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    request = await service.get_request(db, request_id, actor.id, connected=True)
    field = 'requester_location_version' if actor.id == request.requester_id else 'helper_location_version'
    version = getattr(request, field) + 1
    setattr(request, field, version)
    await db.execute(delete(BuddyLocation).where(BuddyLocation.request_id == request_id, BuddyLocation.user_id == actor.id))
    await db.commit()
    return {'sharing': False, 'sharingVersion': version}


@router.get('/requests/{request_id}/location')
async def locations(request_id: uuid.UUID, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    request = await service.get_request(db, request_id, actor.id, connected=True)
    version = request.requester_location_version if actor.id == request.requester_id else request.helper_location_version
    rows = (await db.execute(select(BuddyLocation).where(BuddyLocation.request_id == request_id))).scalars()
    return {'sharingVersion': version, 'locations': [{'userId': row.user_id, 'latitude': row.latitude, 'longitude': row.longitude, 'accuracyM': row.accuracy_m, 'observedAt': row.observed_at, 'stale': row.observed_at < service.now() - timedelta(seconds=30)} for row in rows]}


def message_response(row):
    return {'id': row.id, 'userId': row.user_id, 'text': row.text, 'createdAt': row.created_at}


@router.get('/requests/{request_id}/messages')
async def messages(request_id: uuid.UUID, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    await service.get_request(db, request_id, actor.id, connected=True)
    rows = (await db.execute(select(BuddyMessage).where(BuddyMessage.request_id == request_id, BuddyMessage.created_at > service.now() - timedelta(hours=24)).order_by(BuddyMessage.created_at).limit(200))).scalars()
    return [message_response(row) for row in rows]


@router.post('/requests/{request_id}/messages', status_code=201)
async def send_message(request_id: uuid.UUID, payload: MessageCreate, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    request = await service.get_request(db, request_id, actor.id, connected=True)
    if not payload.text.strip():
        raise HTTPException(422, 'message is empty')
    message_id = uuid.uuid5(request_id, str(actor.id) + ':' + payload.idempotencyKey) if payload.idempotencyKey else uuid.uuid4()
    existing = await db.get(BuddyMessage, message_id)
    if existing:
        return message_response(existing)
    row = BuddyMessage(id=message_id, request_id=request_id, user_id=actor.id, text=payload.text.strip())
    db.add(row)
    await service.event(db, request.helper_id if actor.id == request.requester_id else request.requester_id, request_id, 'MESSAGE', {'requestId': str(request_id), 'messageId': str(row.id)})
    await db.commit()
    await db.refresh(row)
    return message_response(row)


@router.put('/requests/{request_id}/phone-sharing')
async def phone_sharing(request_id: uuid.UUID, payload: PhoneSharing, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    request = await service.get_request(db, request_id, actor.id, connected=True)
    field = 'requester_phone_shared' if actor.id == request.requester_id else 'helper_phone_shared'
    setattr(request, field, payload.enabled)
    await db.commit()
    return {'enabled': payload.enabled}


@router.get('/requests/{request_id}/contact')
async def contact(request_id: uuid.UUID, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    request = await service.get_request(db, request_id, actor.id, connected=True)
    peer_id = request.helper_id if actor.id == request.requester_id else request.requester_id
    peer = await db.get(User, peer_id)
    shared = request.helper_phone_shared if peer_id == request.helper_id else request.requester_phone_shared
    return {'name': peer.name, 'phone': peer.phone if shared else None}


@router.post('/requests/{request_id}/route')
async def route(request_id: uuid.UUID, payload: SessionRoute, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    from app.services.buddyNavigation import session_route
    request = await service.get_request(db, request_id, actor.id, connected=True)
    return await session_route(db, request, actor.id, payload)


@router.post('/requests/{request_id}/{command}')
async def transition(request_id: uuid.UUID, command: str, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    transitions = {'depart': ('ACCEPTED', 'EN_ROUTE'), 'arrive': ('EN_ROUTE', 'ARRIVED'), 'evacuating': ('ARRIVED', 'EVACUATING'), 'report-complete': (('ARRIVED', 'EVACUATING'), 'COMPLETION_PENDING'), 'confirm-complete': ('COMPLETION_PENDING', 'COMPLETED')}
    if command not in (*transitions, 'interrupt', 'confirm-meeting'):
        raise HTTPException(404, 'unknown action')
    row = await service.get_request(db, request_id, actor.id)
    if actor.id not in (row.requester_id, row.helper_id):
        raise HTTPException(403, 'participant only')
    if command == 'confirm-meeting':
        if actor.id != row.requester_id or row.status != 'ARRIVED':
            raise HTTPException(409, 'requester must confirm arrival')
        row.meeting_confirmed = True
        await service.session_event(db, row)
        await db.commit()
        return await service.response(db, row, actor.id)
    if command == 'evacuating' and not row.meeting_confirmed:
        raise HTTPException(409, 'requester meeting confirmation required')
    if command == 'interrupt':
        if row.status in service.TERMINAL:
            return await service.response(db, row, actor.id)
        row.status = 'INTERRUPTED'
    else:
        source, target = transitions[command]
        expected = row.requester_id if command == 'confirm-complete' else row.helper_id
        if actor.id != expected:
            raise HTTPException(403, 'wrong participant role')
        if row.status == target:
            return await service.response(db, row, actor.id)
        if row.status not in (source if isinstance(source, tuple) else (source,)):
            raise HTTPException(409, 'invalid session transition')
        row.status = target
    if row.status in service.TERMINAL:
        await service.terminate(db, row)
    await service.session_event(db, row)
    await db.commit()
    return await service.response(db, row, actor.id)


