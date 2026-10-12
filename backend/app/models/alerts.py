import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel


AlertResponseValue = Literal['SAFE', 'EVACUATING', 'NEEDS_HELP']


class AlertResponseCreate(BaseModel):
    response: AlertResponseValue


class AlertItem(BaseModel):
    id: uuid.UUID
    level: Literal['waspada', 'siaga', 'awas']
    hazardType: str
    source: str
    simulation: bool = False
    area: str | None
    issuedAt: datetime | None
    validUntil: datetime | None
    latitude: float
    longitude: float
    myResponse: AlertResponseValue | None


class AlertLocation(BaseModel):
    observedAt: datetime | None


class AlertList(BaseModel):
    items: list[AlertItem]
    location: AlertLocation
