from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, Field, model_validator


class HazardType(str, Enum):
    FLOOD = 'FLOOD'
    EARTHQUAKE = 'EARTHQUAKE'
    TSUNAMI = 'TSUNAMI'
    WILDFIRE = 'WILDFIRE'
    LANDSLIDE = 'LANDSLIDE'
    EXTREME_WEATHER = 'EXTREME_WEATHER'


class Authority(str, Enum):
    OFFICIAL = 'OFFICIAL'
    SATELLITE_OBSERVATION = 'SATELLITE_OBSERVATION'
    COMMUNITY = 'COMMUNITY'


class EvidenceType(str, Enum):
    BASELINE_HAZARD = 'BASELINE_HAZARD'
    ACTIVE_WARNING = 'ACTIVE_WARNING'
    OBSERVATION = 'OBSERVATION'
    CONFIRMED_CLOSURE = 'CONFIRMED_CLOSURE'
    CRITICAL_HAZARD = 'CRITICAL_HAZARD'


class HazardEvidence(BaseModel):
    sourceId: str = Field(min_length=1, max_length=256)
    hazardType: HazardType
    source: str = Field(min_length=1, max_length=64)
    authority: Authority
    evidenceType: EvidenceType
    geometry: dict
    severity: float | None = Field(default=None, ge=0, le=1)
    confidence: float | None = Field(default=None, ge=0, le=1)
    observedAt: datetime | None = None
    validFrom: datetime | None = None
    validUntil: datetime | None = None
    metadata: dict = Field(default_factory=dict)

    @model_validator(mode='after')
    def validateEvidence(self):
        for value in (self.observedAt, self.validFrom, self.validUntil):
            if value is not None and value.tzinfo is None:
                raise ValueError('evidence timestamps require timezone')
        if self.validFrom and self.validUntil and self.validFrom >= self.validUntil:
            raise ValueError('evidence validity interval is empty')
        if self.evidenceType in {EvidenceType.CRITICAL_HAZARD, EvidenceType.CONFIRMED_CLOSURE, EvidenceType.ACTIVE_WARNING}:
            if self.authority != Authority.OFFICIAL:
                raise ValueError('warnings and hard exclusions require official evidence')
            if self.validUntil is None:
                raise ValueError('warnings and hard exclusions require explicit expiry')
        if self.authority != Authority.OFFICIAL and self.geometry.get('type') != 'Point':
            raise ValueError('community and hotspot observations must remain points')
        return self

    def active(self, now: datetime | None = None) -> bool:
        now = now or datetime.now(timezone.utc)
        return (self.validFrom is None or self.validFrom <= now) and (self.validUntil is None or now < self.validUntil)

    def hard(self) -> bool:
        if self.authority != Authority.OFFICIAL:
            return False
        if self.hazardType == HazardType.EARTHQUAKE:
            return self.evidenceType == EvidenceType.CONFIRMED_CLOSURE or (self.evidenceType == EvidenceType.CRITICAL_HAZARD and self.metadata.get('confirmedDamage') is True)
        return self.evidenceType in {EvidenceType.CRITICAL_HAZARD, EvidenceType.CONFIRMED_CLOSURE}


class HazardMetrics(BaseModel):
    state: str = 'UNKNOWN'
    exposure: float | None = None
    intersectionRatio: float = 0
    proximity: float | None = None
    communityContribution: float = 0
    severityExposure: float | None = None
    firstExitDistanceM: float | None = None
    firstExitTimeSec: float | None = None
    reentered: bool | None = None
    elevationGainM: float | None = None
    elevationPenalty: float | None = None
    unknownElevationPenalty: float = 0
    slopeMeanDegrees: float | None = None
    sources: list[str] = Field(default_factory=list)
    reasonCodes: list[str] = Field(default_factory=list)
