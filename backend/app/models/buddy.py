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


class SafetyStatus(str, Enum):
    UNKNOWN = 'UNKNOWN'
    SAFE = 'SAFE'
    POTENTIALLY_EXPOSED = 'POTENTIALLY_EXPOSED'


class BuddyInvitationCreate(BaseModel):
    buddyUserId: uuid.UUID
    level: BuddyLevel


class BuddyRelationshipResponse(BaseModel):
    id: uuid.UUID
    userId: uuid.UUID
    buddyUserId: uuid.UUID
    level: BuddyLevel
    status: BuddyStatus
    createdAt: datetime
    updatedAt: datetime
    acceptedAt: datetime | None
class BuddyCandidate(BaseModel):
    buddyUserId: uuid.UUID
    relationshipId: uuid.UUID
    level: BuddyLevel
    distanceM: float | None
    locationAvailable: bool
    available: bool
    activeAssignments: int
    safetyStatus: SafetyStatus = SafetyStatus.UNKNOWN
    rank: int
    selectionReasons: list[str]


class BuddyCandidatesResponse(BaseModel):
    candidates: list[BuddyCandidate]
