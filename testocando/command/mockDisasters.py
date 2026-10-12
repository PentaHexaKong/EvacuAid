from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.hazard import HazardRecord
from app.db.session import get_session
from app.models.hazard import HazardType
from app.services import alertSimulation
from app.services.alertService import alertKey
from command.access import requireCommandKey
from command.aggregation import refreshSnapshots

router = APIRouter(prefix='/v1/command/mock-disasters', tags=['Command center'], dependencies=[Depends(requireCommandKey)])


class MockDisasterCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: UUID
    name: str = Field(min_length=1, max_length=200)
    hazardType: HazardType
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
    radiusM: int = Field(ge=50, le=50000, strict=True)
    severity: Literal['WATCH', 'ELEVATED', 'CRITICAL']

    @field_validator('name', mode='before')
    @classmethod
    def cleanName(cls, value):
        return value.strip() if isinstance(value, str) else value


class MockDisasterResponse(MockDisasterCreate):
    expiresAt: datetime


def mockQuery():
    return select(HazardRecord).where(HazardRecord.source == alertSimulation.SOURCE,
        HazardRecord.evidenceMetadata['commandMock'].as_boolean() == True)


def mockResponse(row):
    metadata = row.evidenceMetadata
    return MockDisasterResponse(id=metadata['mockId'], name=metadata['name'], hazardType=row.hazardType,
        latitude=metadata['center'][1], longitude=metadata['center'][0], radiusM=metadata['radiusM'],
        severity=metadata['severity'], expiresAt=row.validUntil)


@router.post('', response_model=MockDisasterResponse, status_code=201)
async def addMockDisaster(payload: MockDisasterCreate, session: AsyncSession = Depends(get_session)):
    await session.execute(select(func.pg_advisory_xact_lock(173401, 1)))
    row = await alertSimulation.place(session, sourceId='command-mock-' + str(payload.id),
        level={'WATCH': 'waspada', 'ELEVATED': 'siaga', 'CRITICAL': 'awas'}[payload.severity],
        hazard=payload.hazardType, latitude=payload.latitude, longitude=payload.longitude,
        radiusM=payload.radiusM, area=payload.name,
        metadata={'commandMock': True, 'mockId': str(payload.id), 'name': payload.name, 'radiusM': payload.radiusM,
            'severity': payload.severity, 'center': [payload.longitude, payload.latitude]})
    await refreshSnapshots(session)
    await session.commit()
    return mockResponse(row)


@router.get('', response_model=list[MockDisasterResponse])
async def listMockDisasters(session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(mockQuery().where(HazardRecord.validUntil > datetime.now(timezone.utc))
        .order_by(HazardRecord.observedAt.desc(), HazardRecord.id))).scalars().all()
    return [mockResponse(row) for row in rows]


async def removeMocks(session, mockId=None):
    await session.execute(select(func.pg_advisory_xact_lock(173401, 1)))
    query = mockQuery()
    if mockId is not None:
        query = query.where(HazardRecord.sourceId == 'command-mock-' + str(mockId))
    rows = (await session.execute(query)).scalars().all()
    if mockId is not None and not rows:
        raise HTTPException(404, 'Mock disaster not found')
    await alertSimulation.resetAnswers(session, [alertKey(row) for row in rows])
    for row in rows:
        await session.delete(row)
    await session.flush()
    await refreshSnapshots(session)
    await session.commit()
    return Response(status_code=204)


@router.delete('/{id}', status_code=204)
async def deleteMockDisaster(id: UUID, session: AsyncSession = Depends(get_session)):
    return await removeMocks(session, id)


@router.delete('', status_code=204)
async def deleteMockDisasters(session: AsyncSession = Depends(get_session)):
    return await removeMocks(session)
