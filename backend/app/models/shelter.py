import uuid
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field, field_validator, model_validator


class ShelterStatus(str, Enum):
    OPEN = 'OPEN'
    FULL = 'FULL'
    CLOSED = 'CLOSED'
    UNKNOWN = 'UNKNOWN'


class ShelterCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    entranceLatitude: float | None = Field(default=None, ge=-90, le=90)
    entranceLongitude: float | None = Field(default=None, ge=-180, le=180)
    entranceNote: str | None = Field(default=None, max_length=200)
    address: str | None = Field(default=None, max_length=500)
    shelterType: str = Field(min_length=1, max_length=64)
    status: ShelterStatus
    capacity: int | None = Field(default=None, ge=0)
    currentOccupancy: int | None = Field(default=None, ge=0)
    wheelchairAccessible: bool | None = None
    medicalSupport: bool | None = None
    source: str = Field(min_length=1, max_length=128)
    sourceReference: str | None = Field(default=None, max_length=500)

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


class ShelterResponse(BaseModel):
    id: uuid.UUID
    name: str
    latitude: float
    longitude: float
    entranceLatitude: float | None = None
    entranceLongitude: float | None = None
    entranceNote: str | None = None
    status: ShelterStatus
    wheelchairAccessible: bool | None
    capacity: int | None
    currentOccupancy: int | None
    source: str


class NearbyShelterResponse(ShelterResponse):
    distanceM: float
