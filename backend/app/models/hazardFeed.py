from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel


class HazardType(str, Enum):
    EARTHQUAKE = 'earthquake'
    FLOOD = 'flood'
    VOLCANO = 'volcano'
    HAZE = 'haze'
    FIRE = 'fire'
    WIND = 'wind'


class HazardItem(BaseModel):
    id: str
    type: HazardType
    occurredAt: datetime
    source: Literal['BMKG', 'PetaBencana']
    latitude: float | None = None
    longitude: float | None = None
    magnitude: float | None = None
    depthKm: float | None = None
    region: str | None = None
    felt: str | None = None
    reportCount: int | None = None


class SourceStatus(BaseModel):
    status: Literal['available', 'unavailable']
    error: str | None = None


class HazardsResponse(BaseModel):
    items: list[HazardItem]
    sources: dict[str, SourceStatus]
