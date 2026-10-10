import uuid
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.models.hazard import HazardMetrics


class NavigationStatus(str, Enum):
    NOT_REQUIRED = 'NOT_REQUIRED'
    PENDING = 'PENDING'
    READY = 'READY'
    UNAVAILABLE = 'UNAVAILABLE'


class HazardStatus(str, Enum):
    NO_KNOWN_HAZARD = 'NO_KNOWN_HAZARD'
    POTENTIALLY_EXPOSED = 'POTENTIALLY_EXPOSED'
    EXPOSED = 'EXPOSED'
    UNKNOWN = 'UNKNOWN'


class AccessibilityStatus(str, Enum):
    COMPATIBLE = 'COMPATIBLE'
    POTENTIALLY_INCOMPATIBLE = 'POTENTIALLY_INCOMPATIBLE'
    UNKNOWN = 'UNKNOWN'


class RouteEvidenceKind(str, Enum):
    AUTHORITATIVE_CRITICAL = 'AUTHORITATIVE_CRITICAL'
    CONFIRMED_CLOSURE = 'CONFIRMED_CLOSURE'
    AUTHORITATIVE_NONCRITICAL = 'AUTHORITATIVE_NONCRITICAL'
    CROWDSOURCED_REPORT = 'CROWDSOURCED_REPORT'


class RouteEvidence(BaseModel):
    evidenceKind: RouteEvidenceKind
    geometry: dict
    probability: float = Field(ge=0, le=1)
    severity: float = Field(ge=0, le=1)
    confidence: float = Field(ge=0, le=1)
    source: str


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
    profile: Literal['WALKING', 'WHEELCHAIR'] = 'WALKING'


class NavigationPreviewCreate(BaseModel):
    originLatitude: float = Field(ge=-90, le=90)
    originLongitude: float = Field(ge=-180, le=180)
    destinationLatitude: float = Field(ge=-90, le=90)
    destinationLongitude: float = Field(ge=-180, le=180)
    mobilityRequired: bool = False
    scenarioHazards: list['HazardPoint'] = Field(default_factory=list, max_length=10)


class HazardPoint(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class NavigationDestination(BaseModel):
    shelterId: uuid.UUID
    name: str
    latitude: float
    longitude: float
    entranceNote: str | None = None
    entranceLatitude: float | None = None
    entranceLongitude: float | None = None


class NavigationRoute(BaseModel):
    distanceM: float
    durationSec: float
    geometry: dict
    routeScore: float
    profile: str = 'PEDESTRIAN'
    maneuvers: list[dict] = Field(default_factory=list)


class NormalizedRouteMetrics(BaseModel):
    hazardExposure: float
    hazardProximity: float
    accessibility: float
    uncertainty: float
    travelTime: float


class RouteCandidateEvaluation(BaseModel):
    routeId: str
    distanceM: float
    durationSec: float
    feasible: bool
    hazardExposure: float
    hazardProximity: float
    accessibilityPenalty: float
    uncertainty: float
    normalized: NormalizedRouteMetrics | None = None
    weightedScore: float | None = None
    riskClass: str
    flags: list[str] = Field(default_factory=list)
    reasons: list[str] = Field(default_factory=list)
    reasonCodes: list[str] = Field(default_factory=list)
    hazards: dict[str, HazardMetrics] = Field(default_factory=dict)


class NavigationEvaluation(BaseModel):
    safetyStatus: HazardStatus
    accessibilityStatus: AccessibilityStatus
    reasonCodes: list[str]
    closestHazardDistanceM: float | None = None
    hazards: dict[str, HazardMetrics] = Field(default_factory=dict)


class RejectedShelter(BaseModel):
    shelterId: uuid.UUID
    reasonCodes: list[str]


class NavigationResponse(BaseModel):
    routeStatus: NavigationStatus
    destination: NavigationDestination | None = None
    route: NavigationRoute | None = None
    evaluation: NavigationEvaluation | None = None
    selectionReasonCodes: list[str] = Field(default_factory=list)
    rejectedCandidates: list[RejectedShelter] = Field(default_factory=list)
    evaluatedCandidates: list[RouteCandidateEvaluation] = Field(default_factory=list)


class NavigationPreviewResponse(BaseModel):
    evaluatedCandidates: list[RouteCandidateEvaluation] = Field(default_factory=list)
    routeStatus: NavigationStatus
    route: NavigationRoute | None = None
    evaluation: NavigationEvaluation | None = None
    destinationVerificationStatus: str = 'UNVERIFIED'
    selectionReasonCodes: list[str] = Field(default_factory=list)
