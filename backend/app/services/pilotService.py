import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import delete, or_, select

from app.db.models import User
from app.db.models.pilot import PilotAttempt, PilotInbox, PilotLocation, PilotOutbox, PilotRequest
from app.utils.geo import calculate_distance_meters


TERMINAL = ('COMPLETED', 'INTERRUPTED', 'UNANSWERED', 'SAFE', 'DECLINED', 'CANCELLED', 'EXPIRED')
CONNECTED = ('ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'EVACUATING', 'COMPLETION_PENDING')


def now():
    return datetime.now(timezone.utc)


async def lock_users(db, ids):
    await db.execute(select(User.id).where(User.id.in_(ids)).order_by(User.id).with_for_update())


async def occupied(db, user_id, exclude=None):
    query = select(PilotRequest.id).where(or_(PilotRequest.requester_id == user_id, PilotRequest.helper_id == user_id), PilotRequest.status.not_in(TERMINAL))
    if exclude:
        query = query.where(PilotRequest.id != exclude)
    pilot = (await db.execute(query)).first()
    pending_query = select(PilotAttempt.id).where(PilotAttempt.helper_id == user_id, PilotAttempt.status == 'PENDING', PilotAttempt.expires_at > now())
    if exclude:
        pending_query = pending_query.where(PilotAttempt.request_id != exclude)
    pending = (await db.execute(pending_query)).first()
    return bool(pilot or pending)


async def event(db, user_id, request_id, kind, payload=None):
    inbox = PilotInbox(user_id=user_id, request_id=request_id, kind=kind, payload=payload or {})
    db.add(inbox)
    await db.flush()
    db.add(PilotOutbox(inbox_id=inbox.id))


async def session_event(db, request):
    for user_id in (request.requester_id, request.helper_id):
        if user_id:
            await event(db, user_id, request.id, 'SESSION_UPDATED', {'requestId': str(request.id), 'status': request.status})


async def get_request(db, request_id, actor, connected=False):
    request = (await db.execute(select(PilotRequest).where(PilotRequest.id == request_id, PilotRequest.pilot.is_(True)).with_for_update())).scalar_one_or_none()
    if not request:
        raise HTTPException(404, 'request not found')
    offered = (await db.execute(select(PilotAttempt.id).where(PilotAttempt.request_id == request_id, PilotAttempt.helper_id == actor, PilotAttempt.status == 'PENDING', PilotAttempt.expires_at > now()))).first()
    if actor not in (request.requester_id, request.helper_id) and (connected or not offered):
        raise HTTPException(403, 'not a session participant')
    if connected and request.status not in CONNECTED:
        raise HTTPException(409, 'accepted active session required')
    return request


async def response(db, request, actor=None):
    await db.refresh(request)
    attempts = (await db.execute(select(PilotAttempt).where(PilotAttempt.request_id == request.id).order_by(PilotAttempt.created_at))).scalars().all()
    if actor and actor not in (request.requester_id, request.helper_id):
        attempts = [a for a in attempts if a.helper_id == actor]
    names = dict((await db.execute(select(User.id, User.name).where(User.id.in_([request.requester_id, request.helper_id] if request.helper_id else [request.requester_id])))).all())
    return {'id': request.id, 'requesterUserId': request.requester_id, 'helperUserId': request.helper_id, 'requesterName': names.get(request.requester_id), 'helperName': names.get(request.helper_id), 'status': request.status, 'message': request.message, 'supportNeeds': request.support_needs, 'sharingConsent': request.sharing_consent, 'phoneShared': request.requester_phone_shared if actor == request.requester_id else (request.helper_phone_shared if actor == request.helper_id else False), 'nearby': request.nearby, 'selectedShelterId': request.selected_shelter_id, 'meetingConfirmed': request.meeting_confirmed, 'attempts': [{'id': a.id, 'helperUserId': a.helper_id, 'status': a.status, 'expiresAt': a.expires_at} for a in attempts], 'createdAt': request.created_at, 'updatedAt': request.updated_at}


async def offer(db, request, helper, seconds):
    attempt = PilotAttempt(request_id=request.id, helper_id=helper, expires_at=now() + timedelta(seconds=seconds))
    db.add(attempt)
    await db.flush()
    request.status = 'WAITING'
    await event(db, helper, request.id, 'OFFER', {'requestId': str(request.id), 'attemptId': str(attempt.id)})


async def advance(db, request):
    from app.db.models.pilot import PilotAvailability
    candidates = list(request.candidates)
    while candidates:
        helper = uuid.UUID(candidates.pop(0))
        availability = await db.get(PilotAvailability, helper)
        if availability and availability.enrolled and availability.opted_in and availability.observed_at and availability.observed_at > now() - timedelta(minutes=2) and availability.latitude is not None and request.latitude is not None and calculate_distance_meters(request.latitude, request.longitude, availability.latitude, availability.longitude) <= 5000 and not await occupied(db, helper):
            request.candidates = candidates
            await offer(db, request, helper, 30)
            return
    request.candidates = []
    request.status = 'UNANSWERED' if request.nearby else 'FALLBACK_REQUIRED'
    if request.status == 'UNANSWERED':
        await terminate(db, request)
    await session_event(db, request)


async def terminate(db, request):
    request.latitude = request.longitude = None
    request.candidates = []
    request.sharing_consent = False
    request.selected_shelter_id = None
    request.requester_phone_shared = request.helper_phone_shared = False
    await db.execute(delete(PilotLocation).where(PilotLocation.request_id == request.id))
    attempts = (await db.execute(select(PilotAttempt).where(PilotAttempt.request_id == request.id, PilotAttempt.status == 'PENDING'))).scalars()
    for attempt in attempts:
        attempt.status = 'CANCELLED'


async def expire(db):
    requests = (await db.execute(select(PilotRequest).where(PilotRequest.status == 'WAITING').with_for_update(skip_locked=True))).scalars()
    for request in requests:
        attempts = (await db.execute(select(PilotAttempt).where(PilotAttempt.request_id == request.id, PilotAttempt.status == 'PENDING', PilotAttempt.expires_at <= now()))).scalars().all()
        if attempts:
            for attempt in attempts:
                attempt.status = 'EXPIRED'
            await db.flush()
            await advance(db, request)
