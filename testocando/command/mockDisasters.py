import os
from datetime import datetime, timezone
from math import cos, radians
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.hazard import HazardRecord
from app.db.session import get_session
from app.models.hazard import HazardType
from app.services import alertSimulation
from app.services.alertService import alertKey, recipientsQuery
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

    @model_validator(mode='after')
    def validateCircle(self):
        degLat = self.radiusM / 111320
        degLon = degLat / max(cos(radians(self.latitude)), 1e-6)
        if abs(self.latitude) + degLat >= 90 or abs(self.longitude) + degLon >= 180:
            raise ValueError('Mock disaster circle must not cross the antimeridian or a pole.')
        return self


class MockDisasterResponse(MockDisasterCreate):
    expiresAt: datetime
    usersInArea: int | None


MIN_REPORTED_USERS = 5


async def usersInArea(session, rows, now):
    if not rows:
        return {}
    pairs = recipientsQuery([row.id for row in rows], now).subquery()
    counts = dict((await session.execute(select(pairs.c.hazardId, func.count()).group_by(pairs.c.hazardId))).all())
    return {row.id: counts[row.id] if counts.get(row.id, 0) >= MIN_REPORTED_USERS else None for row in rows}


def mockQuery():
    return select(HazardRecord).where(HazardRecord.source == alertSimulation.SOURCE,
        HazardRecord.evidenceMetadata['commandMock'].as_boolean() == True)


def mockResponse(row, usersInArea):
    metadata = row.evidenceMetadata
    return MockDisasterResponse(id=metadata['mockId'], name=metadata['name'], hazardType=row.hazardType,
        latitude=metadata['center'][1], longitude=metadata['center'][0], radiusM=metadata['radiusM'],
        severity=metadata['severity'], expiresAt=row.validUntil, usersInArea=usersInArea)


@router.post('', response_model=MockDisasterResponse, status_code=201)
async def addMockDisaster(payload: MockDisasterCreate, session: AsyncSession = Depends(get_session)):
    if os.environ.get('COMMAND_MOCK_ALERTS_ENABLED') != '1':
        raise HTTPException(403, 'Mock disasters are disabled on this server. Set COMMAND_MOCK_ALERTS_ENABLED=1 to allow test alerts.')
    await session.execute(select(func.pg_advisory_xact_lock(173401, 1)))
    row = await alertSimulation.place(session, sourceId='command-mock-' + str(payload.id),
        level={'WATCH': 'waspada', 'ELEVATED': 'siaga', 'CRITICAL': 'awas'}[payload.severity],
        hazard=payload.hazardType, latitude=payload.latitude, longitude=payload.longitude,
        radiusM=payload.radiusM, area=payload.name,
        metadata={'commandMock': True, 'mockId': str(payload.id), 'name': payload.name, 'radiusM': payload.radiusM,
            'severity': payload.severity, 'center': [payload.longitude, payload.latitude]})
    now = datetime.now(timezone.utc)
    reach = await usersInArea(session, [row], now)
    await refreshSnapshots(session)
    await session.commit()
    return mockResponse(row, reach[row.id])


@router.get('', response_model=list[MockDisasterResponse])
async def listMockDisasters(session: AsyncSession = Depends(get_session)):
    now = datetime.now(timezone.utc)
    rows = (await session.execute(mockQuery().where(HazardRecord.validUntil > now)
        .order_by(HazardRecord.observedAt.desc(), HazardRecord.id))).scalars().all()
    reach = await usersInArea(session, rows, now)
    return [mockResponse(row, reach[row.id]) for row in rows]


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
