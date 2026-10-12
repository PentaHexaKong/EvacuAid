from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import current_user
from app.authConfig import settings
from app.db.models.user import User
from app.db.session import get_session
from app.models.alerts import AlertItem
from app.models.hazard import HazardType
from app.services import alertService, alertSimulation


# Dev-only: mounted solely when PILOT_DEV_SIMULATION=1 (see main.py); the env gate is the only guard, never enable in production.
router = APIRouter(prefix='/v1/alerts/dev', tags=['Alerts'])


class Simulation(BaseModel):
    level: Literal['waspada', 'siaga', 'awas'] = 'awas'
    hazard: HazardType = HazardType.EARTHQUAKE


def enabled():
    if settings().environment == 'production':
        raise HTTPException(404, 'Simulation is disabled')


@router.post('/simulate', response_model=AlertItem, status_code=201)
async def simulate(body: Simulation = Simulation(), db: AsyncSession = Depends(get_session), actor: User = Depends(current_user)):
    enabled()
    if actor.latitude is None or actor.longitude is None:
        raise HTTPException(409, 'location required')
    await alertSimulation.clear(db)
    row, _ = await alertSimulation.apply(db, body.level, body.hazard.value, (actor.latitude, actor.longitude), fresh=True)
    return alertService.item(row)


@router.delete('/simulate', status_code=204)
async def clear(db: AsyncSession = Depends(get_session), actor: User = Depends(current_user)):
    enabled()
    await alertSimulation.clear(db)
