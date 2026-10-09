import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import current_user
from app.db.models.user import User
from app.db.session import get_session
from app.models.alerts import AlertItem, AlertList, AlertResponseCreate
from app.services import alertService


router = APIRouter(prefix='/v1/alerts', tags=['Alerts'])


@router.get('', response_model=AlertList)
async def alerts(db: AsyncSession = Depends(get_session), actor: User = Depends(current_user)):
    return await alertService.listAlerts(db, actor)


@router.post('/{alertId}/response', response_model=AlertItem)
async def respond(alertId: uuid.UUID, body: AlertResponseCreate, db: AsyncSession = Depends(get_session), actor: User = Depends(current_user)):
    return await alertService.respond(db, actor, alertId, body.response)
