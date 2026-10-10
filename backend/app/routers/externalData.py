from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import DEFAULT_ADM4
from app.auth import require_roles
from app.db.session import get_session
from app.models.externalData import ExternalMapData
from app.services import externalDataService


router = APIRouter(prefix='/v1/external-data', tags=['external-data'])


@router.post('/sync', response_model=ExternalMapData, dependencies=[Depends(require_roles('ADMIN'))])
async def sync(adm4: str = Query(default=DEFAULT_ADM4, min_length=1), session: AsyncSession = Depends(get_session)) -> ExternalMapData:
    return await externalDataService.syncExternalData(session, adm4)


@router.get('/map', response_model=ExternalMapData)
async def mapData(adm4: str = Query(default=DEFAULT_ADM4, min_length=1), session: AsyncSession = Depends(get_session)) -> ExternalMapData:
    return await externalDataService.mapData(session, adm4)
