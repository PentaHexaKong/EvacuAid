import uuid
from datetime import datetime

from geoalchemy2 import Geometry
from sqlalchemy import DateTime, Float, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class HazardRecord(Base):
    __tablename__ = 'hazard_evidence'
    __table_args__ = (UniqueConstraint('source', 'source_id', name='uq_hazard_source_id'),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sourceId: Mapped[str] = mapped_column('source_id', String(256))
    hazardType: Mapped[str] = mapped_column('hazard_type', String(32))
    source: Mapped[str] = mapped_column(String(64))
    authority: Mapped[str] = mapped_column(String(32))
    evidenceType: Mapped[str] = mapped_column('evidence_type', String(32))
    geometry: Mapped[object] = mapped_column(Geometry('GEOMETRY', srid=4326, spatial_index=False))
    severity: Mapped[float | None] = mapped_column(Float)
    confidence: Mapped[float | None] = mapped_column(Float)
    observedAt: Mapped[datetime | None] = mapped_column('observed_at', DateTime(timezone=True))
    validFrom: Mapped[datetime | None] = mapped_column('valid_from', DateTime(timezone=True))
    validUntil: Mapped[datetime | None] = mapped_column('valid_until', DateTime(timezone=True))
    evidenceMetadata: Mapped[dict] = mapped_column('metadata', JSONB)
