import uuid
from enum import Enum

from pydantic import BaseModel


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


class NavigationCreate(BaseModel):
    userId: uuid.UUID
    destinationShelterId: uuid.UUID | None = None


class NavigationDestination(BaseModel):
    shelterId: uuid.UUID
    name: str
    latitude: float
    longitude: float


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
