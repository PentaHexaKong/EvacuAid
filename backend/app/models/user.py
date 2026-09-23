from __future__ import annotations
import uuid
from datetime import datetime, timedelta, timezone
from enum import Enum
from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator, model_validator


class AccessibilityType(str, Enum):
    VISUAL_IMPAIRMENT = "VISUAL_IMPAIRMENT"
    HEARING_IMPAIRMENT = "HEARING_IMPAIRMENT"
    MOBILITY_LIMITATION = "MOBILITY_LIMITATION"
    ELDERLY = "ELDERLY"
    OTHER = "OTHER"


class AccessibilityItem(BaseModel):
    type: AccessibilityType
    severity: str | None = Field(default=None, max_length=32)


class AccessibilityUpdate(BaseModel):
    items: list[AccessibilityItem] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def types_are_unique(self) -> "AccessibilityUpdate":
        if len({item.type for item in self.items}) != len(self.items):
            raise ValueError("accessibility types must be unique")
        return self


class PreferencesUpdate(BaseModel):
    voice_enabled: bool = True
    vibration_enabled: bool = True
    text_enabled: bool = True
    language: str = Field(default="id", pattern='^(id|en)$')
    larger_text: bool = False
    stronger_contrast: bool = False


class PreferencesResponse(PreferencesUpdate):
    user_id: uuid.UUID
    model_config = ConfigDict(from_attributes=True)


class LocationUpdate(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_m: float | None = Field(default=None, ge=0)
    observed_at: datetime

    @field_validator('observed_at')
    @classmethod
    def location_time_is_aware_and_not_future(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError('observed_at must include a timezone')
        if value > datetime.now(timezone.utc) + timedelta(seconds=30):
            raise ValueError('observed_at cannot be in the future')
        return value


class UserCreate(BaseModel):
    name: str | None = Field(default=None, max_length=60)
    phone: str | None = Field(default=None, max_length=32)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    needs_assistance: bool = False

    @model_validator(mode="after")
    def coordinates_are_a_pair(self) -> "UserCreate":
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("latitude and longitude must be supplied together")
        return self

    @field_validator('name')
    @classmethod
    def clean_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.replace('\r', ' ').replace('\n', ' ').strip()
        return value or None


class UserUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=60)
    phone: str | None = Field(default=None, max_length=32)
    needs_assistance: bool | None = None
    share_location_with_buddies: bool | None = None
    accessibility: list[AccessibilityItem] | None = Field(default=None, max_length=20)

    @field_validator('accessibility')
    @classmethod
    def accessibility_types_are_unique(cls, value: list[AccessibilityItem] | None) -> list[AccessibilityItem] | None:
        if value is not None and len({item.type for item in value}) != len(value):
            raise ValueError('accessibility types must be unique')
        return value

    @field_validator('name')
    @classmethod
    def clean_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.replace('\r', ' ').replace('\n', ' ').strip()
        return value or None


class UserResponse(BaseModel):
    id: uuid.UUID
    name: str | None
    phone: str | None
    latitude: float | None
    longitude: float | None
    location_observed_at: datetime | None = Field(validation_alias=AliasChoices('locationObservedAt', 'location_observed_at'))
    location_accuracy_m: float | None = Field(validation_alias=AliasChoices('locationAccuracyM', 'location_accuracy_m'))
    share_location_with_buddies: bool = Field(validation_alias=AliasChoices('shareLocationWithBuddies', 'share_location_with_buddies'))
    needs_assistance: bool
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)
