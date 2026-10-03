import hashlib
import os
import secrets
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import current_user
from app.db.session import get_session
from app.db.models import BuddyRelationship, User
from app.db.models.pilot import PilotAttempt, PilotAvailability, PilotInbox, PilotInvitation, PilotLocation, PilotMessage, PilotPushToken, PilotRequest
from app.models.pilot import AttemptAction, AvailabilityUpdate, Enrollment, InviteRedeem, MessageCreate, NearbySearch, PhoneSharing, PushToken, RequestCreate, SessionLocation, SessionRoute
from app.services import pilotService as service
from app.services.buddyService import relationshipResponse
from app.utils.geo import calculate_distance_meters


router = APIRouter(prefix='/v1/buddy-pilot', tags=['Buddy pilot'])


async def invitation_response(db, invite, code=None):
    redeemer = await db.get(User, invite.redeemer_id) if invite.redeemer_id else None
    return {'id': invite.id, **({'code': code} if code else {}), 'expiresAt': invite.expires_at, 'status': 'EXPIRED' if invite.expires_at <= service.now() and invite.status in ('PENDING', 'REDEEMED') else invite.status, 'redeemerUserId': invite.redeemer_id, 'redeemerName': redeemer.name if redeemer else None}


@router.post('/invitations', status_code=201)
async def invite(db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    code = secrets.token_urlsafe(12)
    row = PilotInvitation(owner_id=actor.id, code_hash=hashlib.sha256(code.encode()).hexdigest(), expires_at=service.now() + timedelta(hours=24))
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return await invitation_response(db, row, code)


@router.get('/invitations')
async def invitations(db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    rows = (await db.execute(select(PilotInvitation).where(PilotInvitation.owner_id == actor.id).order_by(PilotInvitation.created_at.desc()))).scalars()
    return [await invitation_response(db, row) for row in rows]


@router.post('/invitations/redeem')
async def redeem(payload: InviteRedeem, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    row = (await db.execute(select(PilotInvitation).where(PilotInvitation.code_hash == hashlib.sha256(payload.code.strip().encode()).hexdigest()).with_for_update())).scalar_one_or_none()
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
    row = (await db.execute(select(PilotInvitation).where(PilotInvitation.id == invitation_id).with_for_update())).scalar_one_or_none()
    if not row or row.owner_id != actor.id:
        raise HTTPException(404, 'invitation not found')
    if row.status == 'CONFIRMED':
        return await invitation_response(db, row)
    if row.status != 'REDEEMED' or row.expires_at <= service.now():
        raise HTTPException(409, 'redeemed unexpired invitation required')
    await service.lock_users(db, [actor.id, row.redeemer_id])
    relationship = (await db.execute(select(BuddyRelationship).where(BuddyRelationship.userId == actor.id, BuddyRelationship.buddyUserId == row.redeemer_id, BuddyRelationship.status.in_(('ACTIVE', 'PENDING'))).with_for_update())).scalar_one_or_none()
    if not relationship:
        has_primary = (await db.execute(select(BuddyRelationship.id).where(BuddyRelationship.userId == actor.id, BuddyRelationship.level == 'PRIMARY', BuddyRelationship.status == 'ACTIVE'))).first()
        relationship = BuddyRelationship(userId=actor.id, buddyUserId=row.redeemer_id, level='SECONDARY' if has_primary else 'PRIMARY', status='ACTIVE', acceptedAt=service.now())
        db.add(relationship)
    else:
        relationship.status, relationship.acceptedAt = 'ACTIVE', service.now()
    row.status = 'CONFIRMED'
    await service.event(db, row.redeemer_id, None, 'INVITATION_CONFIRMED', {'invitationId': str(row.id)})
    await db.commit()
    return await invitation_response(db, row)


@router.delete('/invitations/{invitation_id}')
async def revoke_invitation(invitation_id: uuid.UUID, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    row = (await db.execute(select(PilotInvitation).where(PilotInvitation.id == invitation_id).with_for_update())).scalar_one_or_none()
    if not row or row.owner_id != actor.id:
        raise HTTPException(404, 'invitation not found')
    if row.status == 'CONFIRMED':
        raise HTTPException(409, 'remove confirmed contact through buddy relationship endpoint')
    row.status = 'REVOKED'
    await db.commit()
    return await invitation_response(db, row)


@router.get('/contacts')
async def contacts(db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    rows = (await db.execute(select(BuddyRelationship, User.name, PilotAvailability.opted_in, PilotAvailability.observed_at).join(User, User.id == BuddyRelationship.buddyUserId).outerjoin(PilotAvailability, PilotAvailability.user_id == User.id).where(BuddyRelationship.userId == actor.id, BuddyRelationship.status == 'ACTIVE'))).all()
    cutoff = service.now() - timedelta(minutes=2)
    return [{**relationshipResponse(row).model_dump(), 'name': name, 'available': bool(opted_in and observed_at and observed_at >= cutoff), 'observedAt': observed_at} for row, name, opted_in, observed_at in rows]


@router.get('/contacts/incoming')
async def incoming_contacts(db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    rows = (await db.execute(select(BuddyRelationship, User.name).join(User, User.id == BuddyRelationship.userId).where(BuddyRelationship.buddyUserId == actor.id, BuddyRelationship.status == 'ACTIVE'))).all()
    return [{**relationshipResponse(row).model_dump(), 'name': name} for row, name in rows]


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
    row = await db.get(PilotAvailability, actor.id)
    if not row:
        row = PilotAvailability(user_id=actor.id, enrolled=False, opted_in=False)
        db.add(row)
    return row


def availability_response(row):
    return {'enrolled': row.enrolled, 'optedIn': row.opted_in, 'observedAt': row.observed_at}


@router.post('/enrollment')
async def enroll(payload: Enrollment, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    expected = os.getenv('BUDDY_PILOT_ENROLLMENT_CODE', '')
    if not expected or not secrets.compare_digest(payload.code, expected):
        raise HTTPException(403, 'pilot enrollment code invalid')
    row = await availability_row(db, actor)
    row.enrolled = True
    await db.commit()
    return availability_response(row)


@router.get('/availability')
async def availability(db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    row = await availability_row(db, actor)
    await db.commit()
    return availability_response(row)


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
    return availability_response(row)


@router.post('/requests', status_code=201)
async def create_request(payload: RequestCreate, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    await service.lock_users(db, [actor.id] + ([payload.helperUserId] if payload.helperUserId else []))
    existing = (await db.execute(select(PilotRequest).where(PilotRequest.idempotency_key == payload.idempotencyKey))).scalar_one_or_none()
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
    row = PilotRequest(requester_id=actor.id, status='WAITING' if payload.helperUserId else 'FALLBACK_REQUIRED', pilot=True, message=payload.message, support_needs=payload.supportNeeds, sharing_consent=True, idempotency_key=payload.idempotencyKey, latitude=payload.latitude, longitude=payload.longitude)
    db.add(row)
    await db.flush()
    if payload.helperUserId:
        await service.offer(db, row, payload.helperUserId, 120)
    await db.commit()
    return await service.response(db, row, actor.id)


@router.get('/requests/current')
async def current_request(db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    row = (await db.execute(select(PilotRequest).where(PilotRequest.pilot.is_(True), or_(PilotRequest.requester_id == actor.id, PilotRequest.helper_id == actor.id), PilotRequest.status.not_in(service.TERMINAL)).order_by(PilotRequest.created_at.desc()))).scalars().first()
    return await service.response(db, row, actor.id) if row else None


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
    availability = (await db.execute(select(PilotAvailability).where(PilotAvailability.enrolled.is_(True), PilotAvailability.opted_in.is_(True), PilotAvailability.observed_at > service.now() - timedelta(minutes=2), PilotAvailability.user_id != actor.id))).scalars()
    candidates = [(calculate_distance_meters(row.latitude, row.longitude, a.latitude, a.longitude), a.user_id) for a in availability if a.latitude is not None and a.longitude is not None and not await service.occupied(db, a.user_id)]
    row.candidates = [str(user) for distance, user in sorted(candidates) if distance <= 5000][:5]
    row.nearby = True
    await service.advance(db, row)
    await db.commit()
    return await service.response(db, row, actor.id)


@router.post('/requests/{request_id}/accept')
async def accept(request_id: uuid.UUID, payload: AttemptAction, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    row = await service.get_request(db, request_id, actor.id)
    if row.helper_id == actor.id and row.status in service.CONNECTED:
        return await service.response(db, row, actor.id)
    attempt = await db.get(PilotAttempt, payload.attemptId)
    if not payload.sharingConsent or not attempt or attempt.request_id != row.id or attempt.helper_id != actor.id or attempt.status != 'PENDING' or attempt.expires_at <= service.now() or row.status != 'WAITING':
        raise HTTPException(409, 'offer expired or consent missing')
    await service.lock_users(db, [row.requester_id, actor.id])
    if await service.occupied(db, actor.id, row.id):
        raise HTTPException(409, 'helper already occupied')
    if row.nearby:
        eligibility = await db.get(PilotAvailability, actor.id)
        if not eligibility or not eligibility.enrolled or not eligibility.opted_in or not eligibility.observed_at or eligibility.observed_at <= service.now() - timedelta(minutes=2):
            raise HTTPException(409, 'helper availability expired')
    else:
        relationship = (await db.execute(select(BuddyRelationship.id).where(BuddyRelationship.userId == row.requester_id, BuddyRelationship.buddyUserId == actor.id, BuddyRelationship.status == 'ACTIVE').with_for_update())).first()
        if not relationship:
            raise HTTPException(409, 'trusted relationship revoked')
    row.helper_id, row.status, row.acceptedAt = actor.id, 'ACCEPTED', service.now()
    row.latitude = row.longitude = None
    row.candidates = []
    attempt.status = 'ACCEPTED'
    await service.session_event(db, row)
    await db.commit()
    return await service.response(db, row, actor.id)


@router.post('/requests/{request_id}/decline')
async def decline(request_id: uuid.UUID, payload: AttemptAction, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    row = await service.get_request(db, request_id, actor.id)
    attempt = await db.get(PilotAttempt, payload.attemptId)
    if not attempt or attempt.request_id != row.id or attempt.helper_id != actor.id or attempt.status != 'PENDING' or attempt.expires_at <= service.now() or row.status != 'WAITING':
        raise HTTPException(409, 'offer unavailable')
    attempt.status = 'DECLINED'
    await db.flush()
    await service.advance(db, row)
    await db.commit()
    return await service.response(db, row, actor.id)


@router.get('/inbox')
async def inbox(db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    rows = (await db.execute(select(PilotInbox).where(PilotInbox.user_id == actor.id).order_by(PilotInbox.created_at.desc()).limit(100))).scalars()
    return [{'id': row.id, 'requestId': row.request_id, 'kind': row.kind, 'payload': row.payload, 'read': row.read, 'createdAt': row.created_at} for row in rows]


@router.post('/inbox/{inbox_id}/read')
async def read_inbox(inbox_id: uuid.UUID, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    row = await db.get(PilotInbox, inbox_id)
    if not row or row.user_id != actor.id:
        raise HTTPException(404, 'inbox event not found')
    row.read = True
    await db.commit()
    return {'read': True}


@router.put('/push-token')
async def push_token(payload: PushToken, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    await service.lock_users(db, [actor.id])
    row = (await db.execute(select(PilotPushToken).where(PilotPushToken.token == payload.token).with_for_update())).scalar_one_or_none()
    if row and row.user_id != actor.id:
        raise HTTPException(409, 'push token belongs to another guest')
    if not row:
        db.add(PilotPushToken(token=payload.token, user_id=actor.id))
    await db.commit()
    return {'registered': True}


@router.delete('/push-token')
async def remove_push_token(payload: PushToken, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    await db.execute(delete(PilotPushToken).where(PilotPushToken.token == payload.token, PilotPushToken.user_id == actor.id))
    await db.commit()
    return {'registered': False}


@router.put('/requests/{request_id}/location')
async def update_location(request_id: uuid.UUID, payload: SessionLocation, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    request = await service.get_request(db, request_id, actor.id, connected=True)
    version = request.requester_location_version if actor.id == request.requester_id else request.helper_location_version
    row = await db.get(PilotLocation, (request_id, actor.id))
    if payload.sharingConsent and payload.sharingVersion != version:
        raise HTTPException(409, 'location sharing version changed; refresh consent')
    if not row and not payload.sharingConsent:
        raise HTTPException(409, 'explicit location consent required')
    if row and payload.observedAt <= row.observed_at:
        return {'updated': False}
    if not row:
        row = PilotLocation(request_id=request_id, user_id=actor.id)
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
    await db.execute(delete(PilotLocation).where(PilotLocation.request_id == request_id, PilotLocation.user_id == actor.id))
    await db.commit()
    return {'sharing': False, 'sharingVersion': version}


@router.get('/requests/{request_id}/location')
async def locations(request_id: uuid.UUID, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    request = await service.get_request(db, request_id, actor.id, connected=True)
    version = request.requester_location_version if actor.id == request.requester_id else request.helper_location_version
    rows = (await db.execute(select(PilotLocation).where(PilotLocation.request_id == request_id))).scalars()
    return {'sharingVersion': version, 'locations': [{'userId': row.user_id, 'latitude': row.latitude, 'longitude': row.longitude, 'accuracyM': row.accuracy_m, 'observedAt': row.observed_at, 'stale': row.observed_at < service.now() - timedelta(seconds=30)} for row in rows]}


def message_response(row):
    return {'id': row.id, 'userId': row.user_id, 'text': row.text, 'createdAt': row.created_at}


@router.get('/requests/{request_id}/messages')
async def messages(request_id: uuid.UUID, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    await service.get_request(db, request_id, actor.id, connected=True)
    rows = (await db.execute(select(PilotMessage).where(PilotMessage.request_id == request_id, PilotMessage.created_at > service.now() - timedelta(hours=24)).order_by(PilotMessage.created_at).limit(200))).scalars()
    return [message_response(row) for row in rows]


@router.post('/requests/{request_id}/messages', status_code=201)
async def send_message(request_id: uuid.UUID, payload: MessageCreate, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    request = await service.get_request(db, request_id, actor.id, connected=True)
    if not payload.text.strip():
        raise HTTPException(422, 'message is empty')
    message_id = uuid.uuid5(request_id, str(actor.id) + ':' + payload.idempotencyKey) if payload.idempotencyKey else uuid.uuid4()
    existing = await db.get(PilotMessage, message_id)
    if existing:
        return message_response(existing)
    row = PilotMessage(id=message_id, request_id=request_id, user_id=actor.id, text=payload.text.strip())
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
    from app.services.pilotNavigation import session_route
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


