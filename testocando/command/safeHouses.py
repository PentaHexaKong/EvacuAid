from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from geoalchemy2.elements import WKTElement
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Shelter
from app.db.session import get_session
from app.models.shelter import ShelterStatus, ShelterResponse
from app.services.shelterService import shelterResponse
from command.aggregation import refreshSnapshots

router = APIRouter(prefix='/v1/command/safe-houses', tags=['Command center'])


class SafeHouseCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: UUID
    name: str = Field(min_length=1, max_length=200)
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
    entranceLatitude: float | None = Field(default=None, ge=-90, le=90)
    entranceLongitude: float | None = Field(default=None, ge=-180, le=180)
    entranceNote: str | None = Field(default=None, max_length=200)
    address: str | None = Field(default=None, max_length=500)
    status: ShelterStatus = ShelterStatus.UNKNOWN
    capacity: int | None = Field(default=None, ge=0, le=1000000, strict=True)
    wheelchairAccessible: bool | None = None
    verifiedNow: bool = False

    @field_validator('entranceNote')
    @classmethod
    def cleanEntranceNote(cls, value):
        if value is not None:
            if any(character in value for character in ('\n', '\r', '\v', '\f', '\x85', '\u2028', '\u2029')):
                raise ValueError('Entrance note must not contain newlines')
            return value.strip()
        return value

    @model_validator(mode='after')
    def entrancePair(self):
        if (self.entranceLatitude is None) != (self.entranceLongitude is None):
            raise ValueError('Entrance coordinates must both be present or both null')
        return self

    @field_validator('name')
    @classmethod
    def cleanName(cls, value):
        if not value.strip():
            raise ValueError('Safe-house name is required')
        return value.strip()

@router.get('', response_model=list[ShelterResponse])
async def listSafeHouses(limit: int = Query(200, ge=1, le=1000), offset: int = Query(0, ge=0), session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(select(Shelter).where(Shelter.shelterType == 'SAFE_HOUSE').order_by(Shelter.createdAt, Shelter.id).limit(limit).offset(offset))).scalars()
    return [shelterResponse(row) for row in rows]


@router.post('', response_model=ShelterResponse, status_code=201)
async def addSafeHouse(payload: SafeHouseCreate, session: AsyncSession = Depends(get_session)):
    values = payload.model_dump(exclude={'verifiedNow'})
    await session.execute(select(func.pg_advisory_xact_lock(payload.id.int & ((1 << 63) - 1))))
    existing = await session.get(Shelter, payload.id)
    if existing:
        if existing.shelterType != 'SAFE_HOUSE' or existing.source != 'GOVERNMENT_DASHBOARD_REPORTED' or (existing.verifiedAt is not None) != payload.verifiedNow or any(getattr(existing, key) != value for key, value in values.items()):
            raise HTTPException(409, 'This safe-house submission ID already has different data')
        return shelterResponse(existing)
    # Unlike the periodic worker, a save must wait for the projection writer
    # rather than silently skipping its immediate regional refresh.
    await session.execute(select(func.pg_advisory_xact_lock(173401, 1)))
    shelter = Shelter(**values, shelterType='SAFE_HOUSE', source='GOVERNMENT_DASHBOARD_REPORTED',
        verifiedAt=datetime.now(timezone.utc) if payload.verifiedNow else None,
        location=WKTElement(f'POINT({payload.longitude} {payload.latitude})', srid=4326))
    session.add(shelter)
    await session.flush()
    await refreshSnapshots(session)
    await session.commit()
    return shelterResponse(shelter)
