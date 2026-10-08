import uuid
from datetime import datetime

from geoalchemy2 import Geometry
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

import app.db.models
from app.db.base import Base


class Region(Base):
    __tablename__ = 'command_regions'
    __table_args__ = (
        CheckConstraint("administrative_level IN ('PROVINCE','CITY_REGENCY','DISTRICT','VILLAGE')", name='ck_command_region_level'),
        CheckConstraint("data_mode IN ('REFERENCE','SIMULATION')", name='ck_command_region_mode'),
        CheckConstraint("population IS NULL OR (population >= 0 AND population_reference_year IS NOT NULL AND population_reference_year BETWEEN 1900 AND 2200 AND population_source IS NOT NULL AND length(trim(population_source)) > 0)", name='ck_command_population_provenance'),
        CheckConstraint('parent_id IS NULL OR parent_id <> id', name='ck_command_region_not_self'),
        Index('ix_command_region_parent', 'parent_id'),
        Index('ix_command_region_geometry', 'geometry', postgresql_using='gist'),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    administrativeLevel: Mapped[str] = mapped_column('administrative_level', String(24))
    parentId: Mapped[uuid.UUID | None] = mapped_column('parent_id', UUID(as_uuid=True), ForeignKey('command_regions.id', ondelete='RESTRICT'))
    geometry: Mapped[object] = mapped_column(Geometry('MULTIPOLYGON', srid=4326, spatial_index=False))
    centroid: Mapped[object] = mapped_column(Geometry('POINT', srid=4326, spatial_index=False))
    population: Mapped[int | None] = mapped_column(Integer)
    populationReferenceYear: Mapped[int | None] = mapped_column('population_reference_year', Integer)
    populationSource: Mapped[str | None] = mapped_column('population_source', String(256))
    boundarySource: Mapped[str] = mapped_column('boundary_source', String(256))
    dataMode: Mapped[str] = mapped_column('data_mode', String(16))
    createdAt: Mapped[datetime] = mapped_column('created_at', DateTime(timezone=True), server_default=func.now())
    updatedAt: Mapped[datetime] = mapped_column('updated_at', DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class RegionalOperationalSnapshot(Base):
    __tablename__ = 'command_snapshots'
    regionId: Mapped[uuid.UUID] = mapped_column('region_id', UUID(as_uuid=True), ForeignKey('command_regions.id', ondelete='CASCADE'), primary_key=True)
    payload: Mapped[dict] = mapped_column(JSONB)
    updatedAt: Mapped[datetime] = mapped_column('updated_at', DateTime(timezone=True))
    expiresAt: Mapped[datetime] = mapped_column('expires_at', DateTime(timezone=True))
