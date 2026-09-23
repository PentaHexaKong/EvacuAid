import uuid
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field

from app.models.buddy import BuddyLevel


class AssistanceStatus(str, Enum):
    REQUESTED = 'REQUESTED'
    NOTIFIED = 'NOTIFIED'
    ACCEPTED = 'ACCEPTED'
    EN_ROUTE = 'EN_ROUTE'
    ARRIVED = 'ARRIVED'
    EVACUATING = 'EVACUATING'
    SAFE = 'SAFE'
    DECLINED = 'DECLINED'
    CANCELLED = 'CANCELLED'
    EXPIRED = 'EXPIRED'


class AssistanceCreate(BaseModel):
    buddyUserId: uuid.UUID | None = None
    eventId: str | None = Field(default=None, max_length=128)


class AssistanceNotify(BaseModel):
    buddyUserId: uuid.UUID | None = None


class AssistanceResponse(BaseModel):
    id: uuid.UUID
    userId: uuid.UUID
    buddyUserId: uuid.UUID | None
    eventId: str | None
    status: AssistanceStatus
    requestedAt: datetime
    notifiedAt: datetime | None
    acceptedAt: datetime | None
    enRouteAt: datetime | None
    arrivedAt: datetime | None
    evacuatingAt: datetime | None
    safeAt: datetime | None
    cancelledAt: datetime | None
    expiredAt: datetime | None
    updatedAt: datetime


class ContextBuddy(BaseModel):
    userId: uuid.UUID
    level: BuddyLevel
