import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class BuddyRelationship(Base):
    __tablename__ = 'buddy_relationships'
    __table_args__ = (CheckConstraint('user_id <> buddy_user_id', name='ck_buddy_relationship_not_self'),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    userId: Mapped[uuid.UUID] = mapped_column('user_id', UUID(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    buddyUserId: Mapped[uuid.UUID] = mapped_column('buddy_user_id', UUID(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    level: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    createdAt: Mapped[datetime] = mapped_column('created_at', DateTime(timezone=True), server_default=func.now(), nullable=False)
    updatedAt: Mapped[datetime] = mapped_column('updated_at', DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    acceptedAt: Mapped[datetime | None] = mapped_column('accepted_at', DateTime(timezone=True), nullable=True)


class AssistanceRequest(Base):
    __tablename__ = 'assistance_requests'

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    userId: Mapped[uuid.UUID] = mapped_column('user_id', UUID(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    buddyUserId: Mapped[uuid.UUID | None] = mapped_column('buddy_user_id', UUID(as_uuid=True), ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    eventId: Mapped[str | None] = mapped_column('event_id', String(128), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
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
