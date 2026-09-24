import uuid
from datetime import datetime

from geoalchemy2 import Geography
from sqlalchemy import Boolean, CheckConstraint, DateTime, Float, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Shelter(Base):
    __tablename__ = 'shelters'
    __table_args__ = (
        CheckConstraint('latitude BETWEEN -90 AND 90', name='ck_shelter_latitude'),
        CheckConstraint('longitude BETWEEN -180 AND 180', name='ck_shelter_longitude'),
        CheckConstraint('capacity IS NULL OR capacity >= 0', name='ck_shelter_capacity'),
        CheckConstraint('current_occupancy IS NULL OR current_occupancy >= 0', name='ck_shelter_occupancy'),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    location: Mapped[object] = mapped_column(Geography(geometry_type='POINT', srid=4326), nullable=False)
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    shelterType: Mapped[str] = mapped_column('shelter_type', String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    currentOccupancy: Mapped[int | None] = mapped_column('current_occupancy', Integer, nullable=True)
    wheelchairAccessible: Mapped[bool | None] = mapped_column('wheelchair_accessible', Boolean, nullable=True)
    medicalSupport: Mapped[bool | None] = mapped_column('medical_support', Boolean, nullable=True)
    source: Mapped[str] = mapped_column(String(128), nullable=False)
    sourceReference: Mapped[str | None] = mapped_column('source_reference', String(500), nullable=True)
    verifiedAt: Mapped[datetime | None] = mapped_column('verified_at', DateTime(timezone=True), nullable=True)
    createdAt: Mapped[datetime] = mapped_column('created_at', DateTime(timezone=True), server_default=func.now(), nullable=False)
    updatedAt: Mapped[datetime] = mapped_column('updated_at', DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
