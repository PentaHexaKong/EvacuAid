from datetime import datetime, timezone, timedelta
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, field_validator
from app.models.hazard import HazardType


class Input(BaseModel):
    model_config = ConfigDict(extra='forbid')


class ReportCreate(Input):
    id: UUID
    kind: Literal['BLOCKED_ROAD', 'INACCESSIBLE_ROUTE', 'FLOODING', 'DAMAGED_INFRASTRUCTURE', 'SHELTER_CROWDING', 'OTHER']
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
    description: str = Field(min_length=5, max_length=1000)
    hazardType: HazardType = HazardType.EARTHQUAKE
    observedAt: datetime
    publicLocationConsent: Literal[True]

    @field_validator('observedAt')
    @classmethod
    def valid_time(cls, value):
        now = datetime.now(timezone.utc)
        if value.tzinfo is None or value > now + timedelta(seconds=30) or value < now - timedelta(days=7):
            raise ValueError('Observation needs a timezone and must be within the last seven days')
        return value


class Review(Input):
    status: Literal['CONFIRMED', 'REJECTED', 'RESOLVED']
    note: str = Field(min_length=5, max_length=500)
    expectedUpdatedAt: datetime
    barrier: bool = False
    radiusM: float = Field(default=30, ge=5, le=2000, allow_inf_nan=False)
    validUntil: datetime | None = None


class CheckInCreate(Input):
    id: UUID
    status: Literal['NEEDS_ASSISTANCE', 'EVACUATING', 'ARRIVED', 'SAFE_REPORTED', 'UNKNOWN']
    regionId: UUID
    observedAt: datetime
    shareAggregateConsent: Literal[True]
    _time = field_validator('observedAt')(ReportCreate.valid_time.__func__)


class RouteSet(Input):
    id: UUID
    name: str = Field(min_length=3, max_length=120)
    regionId: UUID
    shelterId: UUID
    originLatitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    originLongitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
    mobilityRequired: bool = False


class CaseUpdate(Input):
    status: Literal['ACKNOWLEDGED', 'DISPATCHED', 'COMPLETED', 'CANCELLED']
    note: str = Field(min_length=3, max_length=500)
    expectedUpdatedAt: datetime | None = None
    assignedRouteId: UUID | None = None
