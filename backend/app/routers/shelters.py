from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.models.shelter import NearbyShelterResponse
from app.services import shelterService


router = APIRouter(prefix='/v1/shelters', tags=['shelters'])


@router.get('/nearby', response_model=list[NearbyShelterResponse])
async def nearby(latitude: float = Query(ge=-90, le=90), longitude: float = Query(ge=-180, le=180), radiusM: float = Query(default=5000, gt=0, le=50000), limit: int = Query(default=10, ge=1, le=50), session: AsyncSession = Depends(get_session)) -> list[NearbyShelterResponse]:
    return await shelterService.nearbyShelters(session, latitude, longitude, radiusM, limit)
