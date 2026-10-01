import uuid
from datetime import datetime, timedelta, timezone
from enum import Enum

from pydantic import BaseModel, Field, field_validator


class NavigationStatus(str, Enum):
    NOT_REQUIRED = 'NOT_REQUIRED'
    PENDING = 'PENDING'
    READY = 'READY'
    UNAVAILABLE = 'UNAVAILABLE'


class HazardStatus(str, Enum):
    NO_KNOWN_HAZARD = 'NO_KNOWN_HAZARD'
    POTENTIALLY_EXPOSED = 'POTENTIALLY_EXPOSED'
    UNKNOWN = 'UNKNOWN'


class AccessibilityStatus(str, Enum):
    COMPATIBLE = 'COMPATIBLE'
    POTENTIALLY_INCOMPATIBLE = 'POTENTIALLY_INCOMPATIBLE'
    UNKNOWN = 'UNKNOWN'


class NavigationOrigin(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracyM: float | None = Field(default=None, ge=0)
    observedAt: datetime

    @field_validator('observedAt')
    @classmethod
    def observedAtIsAwareFreshAndNotFuture(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError('observedAt must include a timezone')
        now = datetime.now(timezone.utc)
        if value > now + timedelta(seconds=30):
            raise ValueError('observedAt cannot be in the future')
        if value < now - timedelta(minutes=2):
            raise ValueError('observedAt is too old')
        return value


class NavigationCreate(BaseModel):
    userId: uuid.UUID
    origin: NavigationOrigin | None = None
    destinationShelterId: uuid.UUID | None = None


class NavigationDestination(BaseModel):
    shelterId: uuid.UUID
    name: str
    latitude: float
    longitude: float
    source: str | None = None


class NavigationRoute(BaseModel):
    distanceM: float
    durationSec: float
    geometry: dict
    profile: str = 'PEDESTRIAN'


class NavigationEvaluation(BaseModel):
    safetyStatus: HazardStatus
    accessibilityStatus: AccessibilityStatus
    reasonCodes: list[str]


class RejectedShelter(BaseModel):
    shelterId: uuid.UUID
    reasonCodes: list[str]


class NavigationResponse(BaseModel):
    routeStatus: NavigationStatus
    destination: NavigationDestination | None = None
    route: NavigationRoute | None = None
    evaluation: NavigationEvaluation | None = None
    selectionReasonCodes: list[str] = []
    rejectedCandidates: list[RejectedShelter] = []
