import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.models.buddy import AssistanceRequest as PilotRequest


class PilotInvitation(Base):
    __tablename__ = 'pilot_invitations'
    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID, ForeignKey('users.id', ondelete='CASCADE'))
    code_hash: Mapped[str] = mapped_column(String(64), unique=True)
    redeemer_id: Mapped[uuid.UUID | None] = mapped_column(UUID, ForeignKey('users.id', ondelete='CASCADE'))
    status: Mapped[str] = mapped_column(String(24), default='PENDING')
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PilotAvailability(Base):
    __tablename__ = 'pilot_availability'
    user_id: Mapped[uuid.UUID] = mapped_column(UUID, ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    enrolled: Mapped[bool] = mapped_column(Boolean, default=False)
    opted_in: Mapped[bool] = mapped_column(Boolean, default=False)
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    observed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    accuracy_m: Mapped[float | None] = mapped_column(Float)


class PilotAttempt(Base):
    __tablename__ = 'pilot_attempts'
    __table_args__ = (Index('uq_pilot_pending_attempt', 'request_id', unique=True, postgresql_where=text("status = 'PENDING'")),)
    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, default=uuid.uuid4)
    request_id: Mapped[uuid.UUID] = mapped_column(UUID, ForeignKey('assistance_requests.id', ondelete='CASCADE'))
    helper_id: Mapped[uuid.UUID] = mapped_column(UUID, ForeignKey('users.id', ondelete='CASCADE'))
    status: Mapped[str] = mapped_column(String(24), default='PENDING')
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PilotInbox(Base):
    __tablename__ = 'pilot_inbox'
    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID, ForeignKey('users.id', ondelete='CASCADE'))
    request_id: Mapped[uuid.UUID | None] = mapped_column(UUID, ForeignKey('assistance_requests.id', ondelete='CASCADE'))
    kind: Mapped[str] = mapped_column(String(32))
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PilotOutbox(Base):
    __tablename__ = 'pilot_outbox'
    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, default=uuid.uuid4)
    inbox_id: Mapped[uuid.UUID] = mapped_column(UUID, ForeignKey('pilot_inbox.id', ondelete='CASCADE'), unique=True)
    attempts: Mapped[int] = mapped_column(default=0)
    next_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    tickets: Mapped[list] = mapped_column(JSONB, default=list)


class PilotPushToken(Base):
    __tablename__ = 'pilot_push_tokens'
    token: Mapped[str] = mapped_column(String(256), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID, ForeignKey('users.id', ondelete='CASCADE'))


class PilotLocation(Base):
    __tablename__ = 'pilot_locations'
    request_id: Mapped[uuid.UUID] = mapped_column(UUID, ForeignKey('assistance_requests.id', ondelete='CASCADE'), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID, ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    accuracy_m: Mapped[float] = mapped_column(Float)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class PilotMessage(Base):
    __tablename__ = 'pilot_messages'
    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, default=uuid.uuid4)
    request_id: Mapped[uuid.UUID] = mapped_column(UUID, ForeignKey('assistance_requests.id', ondelete='CASCADE'))
    user_id: Mapped[uuid.UUID] = mapped_column(UUID, ForeignKey('users.id', ondelete='CASCADE'))
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
