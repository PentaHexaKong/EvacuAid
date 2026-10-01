from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import current_user, require_owner
from app.db.session import get_session
from app.models.navigation import NavigationCreate, NavigationResponse
from app.services import navigationService


router = APIRouter(prefix='/v1/navigation', tags=['navigation'])


@router.post('/routes', response_model=NavigationResponse)
async def route(payload: NavigationCreate, session: AsyncSession = Depends(get_session), actor=Depends(current_user)) -> NavigationResponse:
    require_owner(payload.userId, actor)
    return await navigationService.navigationForUser(session, payload)
