import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, Float, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from geoalchemy2 import Geography

from app.db.base import Base


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("latitude IS NULL OR latitude BETWEEN -90 AND 90", name="ck_users_latitude"),
        CheckConstraint("longitude IS NULL OR longitude BETWEEN -180 AND 180", name="ck_users_longitude"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    location: Mapped[object | None] = mapped_column(Geography(geometry_type='POINT', srid=4326), nullable=True)
    needs_assistance: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    accessibility: Mapped[list["UserAccessibility"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    preferences: Mapped["UserPreference | None"] = relationship(back_populates="user", cascade="all, delete-orphan", uselist=False)


class UserAccessibility(Base):
    __tablename__ = "user_accessibility"
    __table_args__ = (UniqueConstraint("user_id", "type", name="uq_user_accessibility_type"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(64), nullable=False)
    severity: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    user: Mapped[User] = relationship(back_populates="accessibility")
