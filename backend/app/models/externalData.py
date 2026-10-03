from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class ExternalSourceStatus(BaseModel):
    available: bool
    fetchedAt: datetime | None = None
    error: str | None = None


class ExternalMapData(BaseModel):
    adm4: str
    weather: dict[str, Any] | None = None
    weatherStatus: ExternalSourceStatus
    reports: list[dict[str, Any]] = Field(default_factory=list)
    reportsStatus: ExternalSourceStatus
