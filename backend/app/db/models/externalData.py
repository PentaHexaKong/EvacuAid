import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ExternalDataSnapshot(Base):
    __tablename__ = 'external_data_snapshots'
    __table_args__ = (UniqueConstraint('source', 'scope', name='uq_external_data_snapshot_source_scope'),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source: Mapped[str] = mapped_column(String(64), nullable=False)
    scope: Mapped[str] = mapped_column(String(128), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    fetchedAt: Mapped[datetime] = mapped_column('fetched_at', DateTime(timezone=True), server_default=func.now(), nullable=False)
    updatedAt: Mapped[datetime] = mapped_column('updated_at', DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
