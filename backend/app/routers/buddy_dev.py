import math
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import current_user
from app.authConfig import settings
from app.db.session import get_session
from app.db.models.buddySession import BuddyAttempt, BuddyAvailability, BuddyLocation, BuddyRequest
from app.services import buddyRequestService as service
from app.services import user_service
from app.services.valhallaProvider import NoRoute, RoutingUnavailable, ValhallaRoutingProvider


# Dev-only: mounted solely when PILOT_DEV_SIMULATION=1 (see main.py); the env gate is the only guard, never enable in production.
router = APIRouter(prefix='/dev', tags=['Buddy'])


@router.post('/simulate-nearby', status_code=201)
async def simulate_nearby(db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    if settings().environment == 'production':
        raise HTTPException(404, 'Simulation is disabled')
    await service.lock_users(db, [actor.id])
    availability = await db.get(BuddyAvailability, actor.id)
    if not availability or availability.latitude is None or availability.longitude is None:
        raise HTTPException(409, 'opt in to Nearby first')
    if await service.occupied(db, actor.id):
        raise HTTPException(409, 'participant already has active assistance')
    requester = await user_service.create_guest(db)
    requester.name = 'Nina Rahma'
    latitude = availability.latitude + 300 / 111320
    longitude = availability.longitude
    row = BuddyRequest(requester_id=requester.id, status='FALLBACK_REQUIRED', buddy_flow=True, message='Saya perlu bantuan. Ada peringatan darurat di lokasi saya.', support_needs=['VISUAL_IMPAIRMENT'], sharing_consent=True, idempotency_key='dev-sim-' + uuid.uuid4().hex, latitude=latitude, longitude=longitude, nearby=True, candidates=[])
    db.add(row)
    await db.flush()
    await service.offer(db, row, actor.id, 120)
    await db.commit()
    return await service.response(db, row, actor.id)


# Demo shortcut for one phone: the simulated requester confirms they are safe on the helper's behalf.
@router.post('/requests/{request_id}/simulate-safe')
async def simulate_safe(request_id: uuid.UUID, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    if settings().environment == 'production':
        raise HTTPException(404, 'Simulation is disabled')
    row = await service.get_request(db, request_id, actor.id)
    if actor.id not in (row.requester_id, row.helper_id):
        raise HTTPException(403, 'participant only')
    if row.status != 'COMPLETION_PENDING':
        raise HTTPException(409, 'arrival not reported yet')
    row.status = 'COMPLETED'
    await service.terminate(db, row)
    await service.session_event(db, row)
    await db.commit()
    return await service.response(db, row, actor.id)


SAFE_HOUSE_M = 300


class Point(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class WalkStep(BaseModel):
    progress: float = Field(ge=0, le=1)
    # TOGETHER: both people walk to the safe house. APPROACH: the helper walks to the requester, who stays put.
    leg: Literal['TOGETHER', 'APPROACH'] = 'TOGETHER'
    # The first step's origin, sent back on every later step so the route stays put while people move along it.
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    # APPROACH only: where the requester is waiting.
    target: Point | None = None


def metres(a, b):
    # Equirectangular: exact enough over a few hundred metres.
    x = math.radians(b[0] - a[0]) * math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot(x, math.radians(b[1] - a[1])) * 6371000


def along(coordinates, fraction):
    legs = [metres(a, b) for a, b in zip(coordinates, coordinates[1:])]
    left = sum(legs) * fraction
    for (a, b), leg in zip(zip(coordinates, coordinates[1:]), legs):
        if left <= leg and leg:
            t = left / leg
            return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], sum(legs)
        left -= leg
    return coordinates[-1], sum(legs)


async def route_between(start, target):
    try:
        return (await ValhallaRoutingProvider().route(start, target)).geometry['coordinates']
    except (RoutingUnavailable, NoRoute):
        return [[start[1], start[0]], [target[1], target[0]]]


async def place(db, row, user, latitude, longitude, observed):
    location = await db.get(BuddyLocation, (row.id, user))
    if not location:
        location = BuddyLocation(request_id=row.id, user_id=user)
        db.add(location)
    location.latitude, location.longitude, location.accuracy_m, location.observed_at = latitude, longitude, 5.0, observed


# Demo for the person who needs help: a simulated Buddy has already accepted and starts about 300 m north.
# The phone then walks them in with simulate-walk (leg APPROACH), the requester confirms meeting, and they walk on together.
@router.post('/simulate-helper', status_code=201)
async def simulate_helper(payload: Point, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    if settings().environment == 'production':
        raise HTTPException(404, 'Simulation is disabled')
    await service.lock_users(db, [actor.id])
    if await service.occupied(db, actor.id):
        raise HTTPException(409, 'participant already has active assistance')
    requester = await user_service.require_user(db, actor.id, include_relations=True)
    helper = await user_service.create_guest(db)
    helper.name = 'Sari Dewi'
    row = BuddyRequest(requester_id=actor.id, helper_id=helper.id, status='ACCEPTED', acceptedAt=service.now(), buddy_flow=True, message='Saya perlu bantuan menuju tempat aman.', support_needs=[item.type for item in requester.accessibility], sharing_consent=True, idempotency_key='dev-sim-' + uuid.uuid4().hex)
    db.add(row)
    await db.flush()
    db.add(BuddyAttempt(request_id=row.id, helper_id=helper.id, status='ACCEPTED', expires_at=service.now()))
    start = Point(latitude=payload.latitude + SAFE_HOUSE_M / 111320, longitude=payload.longitude)
    await place(db, row, helper.id, start.latitude, start.longitude, service.now())
    await service.session_event(db, row)
    await db.commit()
    return {**await service.response(db, row, actor.id), 'helperStart': start.model_dump()}


# Demo walk, one call per step. TOGETHER: both people move from the requester to a safe house about 300 m east, and the last
# step (progress 1) reports arrival so the requester confirms safety themselves. APPROACH: only the helper moves, to the requester.
@router.post('/requests/{request_id}/simulate-walk')
async def simulate_walk(request_id: uuid.UUID, payload: WalkStep, db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    if settings().environment == 'production':
        raise HTTPException(404, 'Simulation is disabled')
    row = await service.get_request(db, request_id, actor.id, connected=True)
    approach = payload.leg == 'APPROACH'
    if row.helper_id is None or row.status not in (('ACCEPTED', 'EN_ROUTE') if approach else ('ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'EVACUATING')):
        raise HTTPException(409, 'session is not walking')
    if payload.latitude is not None and payload.longitude is not None:
        start = (payload.latitude, payload.longitude)
    else:
        # Accepting clears the request's own coordinates, so start where the requester (or else the helper) was last seen.
        first, second = (row.helper_id, row.requester_id) if approach else (row.requester_id, row.helper_id)
        known = await db.get(BuddyLocation, (row.id, first)) or await db.get(BuddyLocation, (row.id, second)) or await db.get(BuddyAvailability, row.helper_id)
        if not known or known.latitude is None:
            raise HTTPException(409, 'no known position to start from')
        start = (known.latitude, known.longitude)
    if approach:
        if not payload.target:
            raise HTTPException(422, 'approach needs the requester position')
        target = (payload.target.latitude, payload.target.longitude)
    else:
        target = (start[0], start[1] + SAFE_HOUSE_M / (111320 * math.cos(math.radians(start[0]))))
    coordinates = await route_between(start, target)
    point, distance = along(coordinates, payload.progress)
    observed = service.now()
    if approach:
        await place(db, row, row.helper_id, point[1], point[0], observed)
        status = 'ARRIVED' if payload.progress >= 1 else 'EN_ROUTE'
    else:
        # The helper walks a step beside the requester so both markers stay visible.
        await place(db, row, row.requester_id, point[1], point[0], observed)
        await place(db, row, row.helper_id, point[1], point[0] + 0.00003, observed)
        row.meeting_confirmed = True
        status = 'COMPLETION_PENDING' if payload.progress >= 1 else 'EVACUATING'
    if row.status != status:
        row.status = status
        await service.session_event(db, row)
    await db.commit()
    walk = {'leg': payload.leg, 'origin': {'latitude': start[0], 'longitude': start[1]}, 'geometry': coordinates, 'distanceM': round(distance), 'progress': payload.progress, 'latitude': point[1], 'longitude': point[0], 'destination': {'latitude': coordinates[-1][1], 'longitude': coordinates[-1][0]}}
    return {**await service.response(db, row, actor.id), 'walk': walk}
