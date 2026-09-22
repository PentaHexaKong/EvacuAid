from __future__ import annotations
import uuid
from datetime import datetime
from enum import Enum
from pydantic import BaseModel, ConfigDict, Field, model_validator


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
    language: str = Field(default="id", min_length=2, max_length=10)


class PreferencesResponse(PreferencesUpdate):
    user_id: uuid.UUID
    model_config = ConfigDict(from_attributes=True)


class LocationUpdate(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class UserCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    phone: str | None = Field(default=None, max_length=32)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    needs_assistance: bool = False

    @model_validator(mode="after")
    def coordinates_are_a_pair(self) -> "UserCreate":
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("latitude and longitude must be supplied together")
        return self


class UserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    phone: str | None = Field(default=None, max_length=32)
    needs_assistance: bool | None = None


class UserResponse(BaseModel):
    id: uuid.UUID
    name: str
    phone: str | None
    latitude: float | None
    longitude: float | None
    needs_assistance: bool
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)
