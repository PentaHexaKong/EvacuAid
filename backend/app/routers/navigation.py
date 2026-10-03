from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.models.navigation import NavigationCreate, NavigationPreviewCreate, NavigationPreviewResponse, NavigationResponse
from app.services import navigationService


router = APIRouter(prefix='/v1/navigation', tags=['navigation'])


@router.post('/routes', response_model=NavigationResponse)
async def route(payload: NavigationCreate, session: AsyncSession = Depends(get_session)) -> NavigationResponse:
    return await navigationService.navigationForUser(session, payload)


@router.post('/preview', response_model=NavigationPreviewResponse)
async def preview(payload: NavigationPreviewCreate, session: AsyncSession = Depends(get_session)) -> NavigationPreviewResponse:
    return await navigationService.previewNavigation(session, payload)
