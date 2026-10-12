import uuid
from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, String, CheckConstraint, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class FieldReport(Base):
    __tablename__ = 'field_reports'
    __table_args__ = (CheckConstraint("status IN ('UNVERIFIED','CONFIRMED','REJECTED','RESOLVED')", name='ck_field_report_status'),)
    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True)
    userId: Mapped[uuid.UUID] = mapped_column('user_id', UUID, ForeignKey('users.id', ondelete='CASCADE'), index=True)
    payload: Mapped[dict] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(24), default='UNVERIFIED')
    review: Mapped[dict] = mapped_column(JSONB, default=dict)
    createdAt: Mapped[datetime] = mapped_column('created_at', DateTime(timezone=True), server_default=func.now())
    updatedAt: Mapped[datetime] = mapped_column('updated_at', DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class EvacuationCheckIn(Base):
    __tablename__ = 'evacuation_check_ins'
    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True)
    userId: Mapped[uuid.UUID] = mapped_column('user_id', UUID, ForeignKey('users.id', ondelete='CASCADE'), index=True)
    payload: Mapped[dict] = mapped_column(JSONB)
    createdAt: Mapped[datetime] = mapped_column('created_at', DateTime(timezone=True), server_default=func.now())


class OperationalRoute(Base):
    __tablename__ = 'operational_routes'
    __table_args__ = (CheckConstraint("status IN ('DRAFT','PUBLISHED','WITHDRAWN')", name='ck_operational_route_status'),)
    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True)
    payload: Mapped[dict] = mapped_column(JSONB)
    result: Mapped[dict] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(16), default='DRAFT')
    updatedAt: Mapped[datetime] = mapped_column('updated_at', DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class GovernmentCase(Base):
    __tablename__ = 'government_cases'
    requestId: Mapped[uuid.UUID] = mapped_column('request_id', UUID, ForeignKey('assistance_requests.id', ondelete='CASCADE'), primary_key=True)
    payload: Mapped[dict] = mapped_column(JSONB)
    updatedAt: Mapped[datetime] = mapped_column('updated_at', DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
