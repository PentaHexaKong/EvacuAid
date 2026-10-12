from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

AdministrativeLevel = Literal['PROVINCE', 'CITY_REGENCY', 'DISTRICT', 'VILLAGE']
SignalLevel = Literal['NORMAL', 'WATCH', 'ELEVATED', 'CRITICAL', 'UNKNOWN']


class PublicModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class RegionSummary(PublicModel):
    id: UUID
    code: str
    name: str
    administrativeLevel: AdministrativeLevel
    parentRegionId: UUID | None
    geometry: dict
    centroid: dict
    population: int | None
    populationReferenceYear: int | None
    populationSource: str | None
    boundarySource: str
    dataMode: Literal['REFERENCE', 'SIMULATION']
    signalLevel: SignalLevel = 'UNKNOWN'
    hazardTypes: list[str] = Field(default_factory=list)
    authoritativeCriticalHazard: bool = False
    estimatedExposedPopulation: int | None = None
    exposureFraction: float | None = None
    exposureEstimationMethod: Literal['AREA_WEIGHTED_ESTIMATE', 'EXACT_GRID_OVERLAY', 'UNKNOWN'] = 'UNKNOWN'
    activeAssistanceCount: int | None = None
    recordedShelterCount: int | None = None
    evidenceFreshness: str = 'UNKNOWN'
    updatedAt: datetime | None = None
    snapshotExpiresAt: datetime | None = None
    snapshotStale: bool = True


class AssistanceAggregate(PublicModel):
    assistanceRequestedCount: int | None = None
    activeAssistanceCount: int | None = None
    evacuatingCount: int | None = None
    safeCheckInCount: int | None = None
    unknownSafetyCount: int | None = None
    mobilityNeedCount: int | None = None
    visualNeedCount: int | None = None
    hearingNeedCount: int | None = None
    elderlyNeedCount: int | None = None
    otherNeedCount: int | None = None
    categoriesOverlap: bool = True
    scope: str = 'Reported profiles and requests with location observed in the last 24 hours; not reference population.'


class ShelterSummary(PublicModel):
    id: UUID
    name: str
    geometry: dict
    status: str
    capacity: int | None
    wheelchairAccessible: bool | None = None
    source: str
    verifiedAt: datetime | None
    dataMode: str


class HazardSummary(PublicModel):
    hazardType: str
    source: str
    authority: str
    evidenceType: str
    provenanceClass: str
    geometry: dict
    severity: float | None
    confidence: float | None
    observedAt: datetime | None
    validFrom: datetime | None
    expiresAt: datetime | None
    freshness: str
    active: bool


class RegionDetail(RegionSummary):
    hierarchy: list[dict] = Field(default_factory=list)
    registeredUserCount: int | None = None
    assistance: AssistanceAggregate = Field(default_factory=AssistanceAggregate)
    totalShelterCapacity: int | None = None
    availableResponderCount: int | None = None
    assignedResponderCount: int | None = None
    feasibleRouteCount: int | None = None
    blockedRouteCount: int | None = None
    noFeasibleRouteCount: int | None = None
    hazards: list[HazardSummary] = Field(default_factory=list)
    shelters: list[ShelterSummary] = Field(default_factory=list)
    routes: list[dict] = Field(default_factory=list)
    metricProvenance: dict[str, str] = Field(default_factory=dict)
    limitations: list[str] = Field(default_factory=list)
