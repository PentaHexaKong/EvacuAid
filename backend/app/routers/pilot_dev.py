import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import current_user
from app.db.session import get_session
from app.db.models.pilot import PilotAvailability, PilotRequest
from app.services import pilotService as service
from app.services import user_service


# Dev-only: mounted solely when PILOT_DEV_SIMULATION=1 (see main.py); the env gate is the only guard, never enable in production.
router = APIRouter(prefix='/v1/buddy-pilot/dev', tags=['Buddy pilot dev'])


@router.post('/simulate-nearby', status_code=201)
async def simulate_nearby(db: AsyncSession = Depends(get_session), actor=Depends(current_user)):
    await service.lock_users(db, [actor.id])
    availability = await db.get(PilotAvailability, actor.id)
    if not availability or availability.latitude is None or availability.longitude is None:
        raise HTTPException(409, 'opt in to Nearby first')
    if await service.occupied(db, actor.id):
        raise HTTPException(409, 'participant already has active assistance')
    requester = await user_service.create_guest(db)
    requester.name = 'Nina Rahma'
    latitude = availability.latitude + 300 / 111320
    longitude = availability.longitude
    row = PilotRequest(requester_id=requester.id, status='FALLBACK_REQUIRED', pilot=True, message='Saya perlu bantuan. Ada peringatan darurat di lokasi saya.', support_needs=['VISUAL_IMPAIRMENT'], sharing_consent=True, idempotency_key='dev-sim-' + uuid.uuid4().hex, latitude=latitude, longitude=longitude, nearby=True, candidates=[])
    db.add(row)
    await db.flush()
    await service.offer(db, row, actor.id, 120)
    await db.commit()
    return await service.response(db, row, actor.id)
