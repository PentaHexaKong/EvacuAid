import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, Float, ForeignKey, Index, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.models.buddy import AssistanceRequest as BuddyRequest


class BuddyInvitation(Base):
    __tablename__ = 'pilot_invitations'
    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID, ForeignKey('users.id', ondelete='CASCADE'), index=True)
    code_hash: Mapped[str | None] = mapped_column(String(64), unique=True)
    redeemer_id: Mapped[uuid.UUID | None] = mapped_column(UUID, ForeignKey('users.id', ondelete='CASCADE'), index=True)
    status: Mapped[str] = mapped_column(String(24), default='PENDING')
    direction: Mapped[str] = mapped_column(String(16), default='SEEK_HELP', server_default='SEEK_HELP')
    relation: Mapped[str | None] = mapped_column(String(16))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BuddyAvailability(Base):
    __tablename__ = 'pilot_availability'
    user_id: Mapped[uuid.UUID] = mapped_column(UUID, ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    opted_in: Mapped[bool] = mapped_column(Boolean, default=False)
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    observed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    accuracy_m: Mapped[float | None] = mapped_column(Float)


class BuddyAttempt(Base):
    __tablename__ = 'pilot_attempts'
    __table_args__ = (Index('uq_pilot_pending_attempt', 'request_id', 'helper_id', unique=True, postgresql_where=text("status = 'PENDING'")), Index('ix_pilot_pending_attempt_helper', 'helper_id', postgresql_where=text("status = 'PENDING'")), CheckConstraint("source IN ('GPS','BLE')", name='ck_pilot_attempt_source'))
    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, default=uuid.uuid4)
    request_id: Mapped[uuid.UUID] = mapped_column(UUID, ForeignKey('assistance_requests.id', ondelete='CASCADE'))
    helper_id: Mapped[uuid.UUID] = mapped_column(UUID, ForeignKey('users.id', ondelete='CASCADE'))
    status: Mapped[str] = mapped_column(String(24), default='PENDING')
    source: Mapped[str] = mapped_column(String(3), default='GPS', server_default='GPS')
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BuddyInbox(Base):
    __tablename__ = 'pilot_inbox'
    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID, ForeignKey('users.id', ondelete='CASCADE'))
    request_id: Mapped[uuid.UUID | None] = mapped_column(UUID, ForeignKey('assistance_requests.id', ondelete='CASCADE'))
    kind: Mapped[str] = mapped_column(String(32))
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BuddyOutbox(Base):
    __tablename__ = 'pilot_outbox'
    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, default=uuid.uuid4)
    inbox_id: Mapped[uuid.UUID] = mapped_column(UUID, ForeignKey('pilot_inbox.id', ondelete='CASCADE'), unique=True)
    attempts: Mapped[int] = mapped_column(default=0)
    next_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    tickets: Mapped[list] = mapped_column(JSONB, default=list)


class BuddyPushToken(Base):
    __tablename__ = 'pilot_push_tokens'
    token: Mapped[str] = mapped_column(String(256), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID, ForeignKey('users.id', ondelete='CASCADE'))


class BuddyLocation(Base):
    __tablename__ = 'pilot_locations'
    request_id: Mapped[uuid.UUID] = mapped_column(UUID, ForeignKey('assistance_requests.id', ondelete='CASCADE'), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID, ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    accuracy_m: Mapped[float] = mapped_column(Float)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class BuddyMessage(Base):
    __tablename__ = 'pilot_messages'
    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, default=uuid.uuid4)
    request_id: Mapped[uuid.UUID] = mapped_column(UUID, ForeignKey('assistance_requests.id', ondelete='CASCADE'))
    user_id: Mapped[uuid.UUID] = mapped_column(UUID, ForeignKey('users.id', ondelete='CASCADE'))
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
