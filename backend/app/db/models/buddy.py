import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, synonym

from app.db.base import Base


class BuddyRelationship(Base):
    __tablename__ = 'buddy_relationships'
    __table_args__ = (CheckConstraint('user_id <> buddy_user_id', name='ck_buddy_relationship_not_self'),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    userId: Mapped[uuid.UUID] = mapped_column('user_id', UUID(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    buddyUserId: Mapped[uuid.UUID] = mapped_column('buddy_user_id', UUID(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    level: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    relation: Mapped[str | None] = mapped_column(String(16))
    createdAt: Mapped[datetime] = mapped_column('created_at', DateTime(timezone=True), server_default=func.now(), nullable=False)
    updatedAt: Mapped[datetime] = mapped_column('updated_at', DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    acceptedAt: Mapped[datetime | None] = mapped_column('accepted_at', DateTime(timezone=True), nullable=True)


class AssistanceRequest(Base):
    __tablename__ = 'assistance_requests'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    userId: Mapped[uuid.UUID] = mapped_column('user_id', UUID(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    buddyUserId: Mapped[uuid.UUID | None] = mapped_column('buddy_user_id', UUID(as_uuid=True), ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    eventId: Mapped[str | None] = mapped_column('event_id', String(128), nullable=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    requestedAt: Mapped[datetime] = mapped_column('requested_at', DateTime(timezone=True), server_default=func.now(), nullable=False)
    notifiedAt: Mapped[datetime | None] = mapped_column('notified_at', DateTime(timezone=True), nullable=True)
    acceptedAt: Mapped[datetime | None] = mapped_column('accepted_at', DateTime(timezone=True), nullable=True)
    enRouteAt: Mapped[datetime | None] = mapped_column('en_route_at', DateTime(timezone=True), nullable=True)
    arrivedAt: Mapped[datetime | None] = mapped_column('arrived_at', DateTime(timezone=True), nullable=True)
    evacuatingAt: Mapped[datetime | None] = mapped_column('evacuating_at', DateTime(timezone=True), nullable=True)
    safeAt: Mapped[datetime | None] = mapped_column('safe_at', DateTime(timezone=True), nullable=True)
    cancelledAt: Mapped[datetime | None] = mapped_column('cancelled_at', DateTime(timezone=True), nullable=True)
    expiredAt: Mapped[datetime | None] = mapped_column('expired_at', DateTime(timezone=True), nullable=True)
    updatedAt: Mapped[datetime] = mapped_column('updated_at', DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    requester_id = synonym('userId')
    helper_id = synonym('buddyUserId')
    created_at = synonym('requestedAt')
    updated_at = synonym('updatedAt')
    # True for requests made through the Buddy flow; the column keeps its original name.
    buddy_flow: Mapped[bool] = mapped_column('pilot', Boolean, default=False, server_default='false')
    message: Mapped[str] = mapped_column(Text, default='', server_default='')
    support_needs: Mapped[list] = mapped_column(JSONB, default=list, server_default='[]')
    idempotency_key: Mapped[str | None] = mapped_column(String(128), unique=True)
    sharing_consent: Mapped[bool] = mapped_column(Boolean, default=False, server_default='false')
    nearby: Mapped[bool] = mapped_column(Boolean, default=False, server_default='false')
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    candidates: Mapped[list] = mapped_column(JSONB, default=list, server_default='[]')
    selected_shelter_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey('shelters.id', ondelete='SET NULL'))
    meeting_confirmed: Mapped[bool] = mapped_column(Boolean, default=False, server_default='false')
    requester_phone_shared: Mapped[bool] = mapped_column(Boolean, default=False, server_default='false')
    helper_phone_shared: Mapped[bool] = mapped_column(Boolean, default=False, server_default='false')
    requester_location_version: Mapped[int] = mapped_column(Integer, default=0, server_default='0')
    helper_location_version: Mapped[int] = mapped_column(Integer, default=0, server_default='0')
