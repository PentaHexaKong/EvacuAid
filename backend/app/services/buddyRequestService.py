import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import delete, exists, or_, select, update
from sqlalchemy.exc import IntegrityError

from app.db.models import BuddyRelationship, User
from app.db.models.buddySession import BuddyAttempt, BuddyInbox, BuddyLocation, BuddyOutbox, BuddyRequest
from app.utils.geo import calculate_distance_meters


TERMINAL = ('COMPLETED', 'INTERRUPTED', 'UNANSWERED', 'SAFE', 'DECLINED', 'CANCELLED', 'EXPIRED')
CONNECTED = ('ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'EVACUATING', 'COMPLETION_PENDING')


def is_buddy(user_id):
    return exists().where(BuddyRelationship.buddyUserId == user_id, BuddyRelationship.status == 'ACTIVE')


def now():
    return datetime.now(timezone.utc)


async def lock_users(db, ids):
    await db.execute(select(User.id).where(User.id.in_(ids)).order_by(User.id).with_for_update())


async def beacon_id(db, user_id):
    value = (await db.execute(select(User.beacon_id).where(User.id == user_id).with_for_update())).scalar_one()
    while value is None:
        candidate = secrets.randbelow(4294967295) + 1
        try:
            async with db.begin_nested():
                await db.execute(update(User).where(User.id == user_id).values(beacon_id=candidate))
            value = candidate
        except IntegrityError:
            pass
    return value


async def occupied(db, user_id, exclude=None):
    query = select(BuddyRequest.id).where(or_(BuddyRequest.requester_id == user_id, BuddyRequest.helper_id == user_id), BuddyRequest.status.not_in(TERMINAL))
    if exclude:
        query = query.where(BuddyRequest.id != exclude)
    active = (await db.execute(query)).first()
    pending_query = select(BuddyAttempt.id).where(BuddyAttempt.helper_id == user_id, BuddyAttempt.status == 'PENDING', BuddyAttempt.expires_at > now())
    if exclude:
        pending_query = pending_query.where(BuddyAttempt.request_id != exclude)
    pending = (await db.execute(pending_query)).first()
    return bool(active or pending)


async def current_request(db, user_id, include_offers=False):
    participants = [BuddyRequest.requester_id == user_id, BuddyRequest.helper_id == user_id]
    if include_offers:
        offered = select(BuddyAttempt.request_id).where(BuddyAttempt.helper_id == user_id, BuddyAttempt.status == 'PENDING', BuddyAttempt.expires_at > now())
        participants.append(BuddyRequest.id.in_(offered))
    return (await db.execute(select(BuddyRequest).where(BuddyRequest.buddy_flow.is_(True), or_(*participants), BuddyRequest.status.not_in(TERMINAL)).order_by(BuddyRequest.created_at.desc()))).scalars().first()


def legacyStatus(status):
    return {'WAITING': 'REQUESTED', 'FALLBACK_REQUIRED': 'REQUESTED', 'COMPLETION_PENDING': 'EVACUATING', 'COMPLETED': 'SAFE', 'INTERRUPTED': 'CANCELLED', 'UNANSWERED': 'EXPIRED'}.get(status, status)


async def event(db, user_id, request_id, kind, payload=None):
    inbox = BuddyInbox(user_id=user_id, request_id=request_id, kind=kind, payload=payload or {})
    db.add(inbox)
    await db.flush()
    db.add(BuddyOutbox(inbox_id=inbox.id))


async def session_event(db, request):
    for user_id in (request.requester_id, request.helper_id):
        if user_id:
            await event(db, user_id, request.id, 'SESSION_UPDATED', {'requestId': str(request.id), 'status': request.status})


async def get_request(db, request_id, actor, connected=False):
    request = (await db.execute(select(BuddyRequest).where(BuddyRequest.id == request_id, BuddyRequest.buddy_flow.is_(True)).with_for_update())).scalar_one_or_none()
    if not request:
        raise HTTPException(404, 'request not found')
    offered = (await db.execute(select(BuddyAttempt.id).where(BuddyAttempt.request_id == request_id, BuddyAttempt.helper_id == actor, BuddyAttempt.status == 'PENDING', BuddyAttempt.expires_at > now()))).first()
    if actor not in (request.requester_id, request.helper_id) and (connected or not offered):
        raise HTTPException(403, 'not a session participant')
    if connected and request.status not in CONNECTED:
        raise HTTPException(409, 'accepted active session required')
    return request


async def response(db, request, actor=None):
    await db.refresh(request)
    attempts = (await db.execute(select(BuddyAttempt).where(BuddyAttempt.request_id == request.id).order_by(BuddyAttempt.created_at))).scalars().all()
    if actor and actor not in (request.requester_id, request.helper_id):
        attempts = [a for a in attempts if a.helper_id == actor]
    names = dict((await db.execute(select(User.id, User.name).where(User.id.in_([request.requester_id, request.helper_id] if request.helper_id else [request.requester_id])))).all())
    return {'id': request.id, 'requesterUserId': request.requester_id, 'helperUserId': request.helper_id, 'requesterName': names.get(request.requester_id), 'helperName': names.get(request.helper_id), 'status': request.status, 'message': request.message, 'supportNeeds': request.support_needs, 'sharingConsent': request.sharing_consent, 'phoneShared': request.requester_phone_shared if actor == request.requester_id else (request.helper_phone_shared if actor == request.helper_id else False), 'nearby': request.nearby, 'selectedShelterId': request.selected_shelter_id, 'meetingConfirmed': request.meeting_confirmed, 'attempts': [{'id': a.id, 'helperUserId': a.helper_id, 'status': a.status, 'source': a.source, 'expiresAt': a.expires_at} for a in attempts], 'createdAt': request.created_at, 'updatedAt': request.updated_at}


async def offer(db, request, helper, seconds, source='GPS'):
    attempt = BuddyAttempt(request_id=request.id, helper_id=helper, source=source, expires_at=now() + timedelta(seconds=seconds))
    db.add(attempt)
    await db.flush()
    request.status = 'WAITING'
    await event(db, helper, request.id, 'OFFER', {'requestId': str(request.id), 'attemptId': str(attempt.id)})
    return attempt


async def advance(db, request):
    from app.db.models.buddySession import BuddyAvailability
    if request.nearby and (request.nearby_started_at or request.created_at) <= now() - timedelta(minutes=10):
        request.status = 'UNANSWERED'
        await terminate(db, request)
        await session_event(db, request)
        return
    pending = await db.scalar(select(BuddyAttempt.id).where(BuddyAttempt.request_id == request.id, BuddyAttempt.status == 'PENDING', BuddyAttempt.expires_at > now()).limit(1))
    if pending:
        return
    candidates = list(request.candidates)
    while candidates:
        helper = uuid.UUID(candidates.pop(0))
        availability = await db.get(BuddyAvailability, helper)
        if availability and availability.opted_in and availability.observed_at and availability.observed_at > now() - timedelta(minutes=2) and availability.latitude is not None and request.latitude is not None and calculate_distance_meters(request.latitude, request.longitude, availability.latitude, availability.longitude) <= 5000 and not await occupied(db, helper):
            request.candidates = candidates
            await offer(db, request, helper, 30)
            return
    request.candidates = []
    request.status = 'WAITING' if request.nearby else 'FALLBACK_REQUIRED'
    await session_event(db, request)


async def terminate(db, request):
    request.latitude = request.longitude = None
    request.candidates = []
    request.sharing_consent = False
    request.selected_shelter_id = None
    request.requester_phone_shared = request.helper_phone_shared = False
    await db.execute(delete(BuddyLocation).where(BuddyLocation.request_id == request.id))
    attempts = (await db.execute(select(BuddyAttempt).where(BuddyAttempt.request_id == request.id, BuddyAttempt.status == 'PENDING'))).scalars()
    for attempt in attempts:
        attempt.status = 'CANCELLED'


async def expire(db):
    requests = (await db.execute(select(BuddyRequest).where(BuddyRequest.status == 'WAITING').with_for_update(skip_locked=True))).scalars()
    for request in requests:
        if request.nearby and (request.nearby_started_at or request.created_at) <= now() - timedelta(minutes=10):
            request.status = 'UNANSWERED'
            await terminate(db, request)
            await session_event(db, request)
            continue
        attempts = (await db.execute(select(BuddyAttempt).where(BuddyAttempt.request_id == request.id, BuddyAttempt.status == 'PENDING', BuddyAttempt.expires_at <= now()))).scalars().all()
        if attempts:
            for attempt in attempts:
                attempt.status = 'EXPIRED'
            await db.flush()
            await advance(db, request)
