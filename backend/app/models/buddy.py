import uuid
from datetime import datetime
from enum import Enum

from pydantic import BaseModel


class BuddyLevel(str, Enum):
    PRIMARY = 'PRIMARY'
    SECONDARY = 'SECONDARY'
    COMMUNITY = 'COMMUNITY'


class BuddyStatus(str, Enum):
    PENDING = 'PENDING'
    ACTIVE = 'ACTIVE'
    REJECTED = 'REJECTED'
    REVOKED = 'REVOKED'


class BuddyRelationshipResponse(BaseModel):
    id: uuid.UUID
    userId: uuid.UUID
    buddyUserId: uuid.UUID
    level: BuddyLevel
    status: BuddyStatus
    createdAt: datetime
    updatedAt: datetime
    acceptedAt: datetime | None
