import uuid
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class ShelterStatus(str, Enum):
    OPEN = 'OPEN'
    FULL = 'FULL'
    CLOSED = 'CLOSED'
    UNKNOWN = 'UNKNOWN'


class ShelterCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    address: str | None = Field(default=None, max_length=500)
    shelterType: str = Field(min_length=1, max_length=64)
    status: ShelterStatus
    capacity: int | None = Field(default=None, ge=0)
    currentOccupancy: int | None = Field(default=None, ge=0)
    wheelchairAccessible: bool | None = None
    medicalSupport: bool | None = None
    source: str = Field(min_length=1, max_length=128)
    sourceReference: str | None = Field(default=None, max_length=500)


class ShelterResponse(BaseModel):
    id: uuid.UUID
    name: str
    latitude: float
    longitude: float
    status: ShelterStatus
    wheelchairAccessible: bool | None
    capacity: int | None
    currentOccupancy: int | None
    source: str


class NearbyShelterResponse(ShelterResponse):
    distanceM: float
