import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field

from app.models.navigation import NavigationOrigin


class InviteRedeem(BaseModel):
    code: str = Field(min_length=6, max_length=64)


class InviteDirect(BaseModel):
    code: str = Field(min_length=8, max_length=16)
    relation: Literal['KELUARGA', 'TEMAN', 'TETANGGA', 'PENDAMPING', 'LAINNYA']
    direction: Literal['SEEK_HELP', 'OFFER_HELP']


class AvailabilityUpdate(BaseModel):
    optedIn: bool
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    observedAt: datetime | None = None
    accuracyM: float | None = Field(default=None, ge=0, le=100)
    refreshOnly: bool = False


class RequestCreate(BaseModel):
    helperUserId: uuid.UUID | None = None
    message: str = Field(default='', max_length=1000)
    supportNeeds: list[str] = Field(default_factory=list, max_length=20)
    sharingConsent: bool
    idempotencyKey: str = Field(min_length=8, max_length=128)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)


class AttemptAction(BaseModel):
    attemptId: uuid.UUID
    sharingConsent: bool = False


class SessionLocation(NavigationOrigin):
    sharingVersion: int | None = Field(default=None, ge=0)
    accuracyM: float = Field(ge=0, le=1000)
    sharingConsent: bool = False


class MessageCreate(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    idempotencyKey: str | None = Field(default=None, min_length=8, max_length=128)


class PhoneSharing(BaseModel):
    enabled: bool


class PushToken(BaseModel):
    token: str = Field(pattern=r'^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$', max_length=256)


class SessionRoute(BaseModel):
    leg: Literal['TO_REQUESTER', 'TO_SHELTER']
    profile: Literal['WALKING', 'WHEELCHAIR']
    destinationShelterId: uuid.UUID | None = None
    origin: NavigationOrigin | None = None


class NearbySearch(NavigationOrigin):
    pass


class BeaconSearch(BaseModel):
    beaconIds: list[Annotated[int, Field(strict=True, ge=1, le=4294967295)]] = Field(max_length=10)


class NearbyHelperSelection(BaseModel):
    beaconId: int = Field(strict=True, ge=1, le=4294967295)
