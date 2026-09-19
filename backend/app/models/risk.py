"""Pydantic request and response models for the public API."""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field, model_validator


class UserProfile(str, Enum):
    NORMAL = "NORMAL"
    BLIND = "BLIND"
    DEAF = "DEAF"
    MOBILITY_LIMITATION = "MOBILITY_LIMITATION"
    ELDERLY = "ELDERLY"


class SignalLevel(str, Enum):
    NORMAL = "NORMAL"
    WATCH = "WATCH"
    ELEVATED = "ELEVATED"
    OFFICIAL_ALERT = "OFFICIAL_ALERT"
    ACTION_REQUIRED = "ACTION_REQUIRED"


class ExposureStatus(str, Enum):
    UNKNOWN = "UNKNOWN"
    NO_KNOWN_EXPOSURE = "NO_KNOWN_EXPOSURE"
    NEARBY = "NEARBY"
    AFFECTED_AREA = "AFFECTED_AREA"


class RecommendedAction(str, Enum):
    MONITOR = "MONITOR"
    PREPARE = "PREPARE"
    FOLLOW_OFFICIAL_INSTRUCTION = "FOLLOW_OFFICIAL_INSTRUCTION"
    SEEK_ASSISTANCE = "SEEK_ASSISTANCE"
    EVACUATE = "EVACUATE"


class ConfidenceLevel(str, Enum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


class RiskRequest(BaseModel):
    adm4: str = Field(min_length=1, max_length=32)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    user_profile: UserProfile = UserProfile.NORMAL
    needs_assistance: bool = False

    @model_validator(mode="after")
    def coordinates_are_a_pair(self) -> "RiskRequest":
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("latitude and longitude must be supplied together")
        return self


class EventData(BaseModel):
    hazard_type: str | None = None
    official_status: str | None = None
    signal_level: SignalLevel


class ExposureData(BaseModel):
    status: ExposureStatus
    nearest_event_distance_m: float | None = None
    nearby_report_count: int = Field(ge=0)


class WeatherData(BaseModel):
    condition: str | None = None
    temperature_c: float | None = None
    humidity_pct: float | None = None
    precipitation: float | None = None
    wind_speed: float | None = None


class ActionData(BaseModel):
    recommended_action: RecommendedAction
    assistance_required: bool


class AssistanceData(BaseModel):
    buddy_status: str | None = None


class NavigationData(BaseModel):
    route_status: str = "NOT_REQUIRED"


class QualityData(BaseModel):
    confidence: ConfidenceLevel
    sources: list[str]
    updated_at: str


class RiskResponse(BaseModel):
    event: EventData
    exposure: ExposureData
    weather: WeatherData | None = None
    action: ActionData
    assistance: AssistanceData
    navigation: NavigationData
    quality: QualityData

