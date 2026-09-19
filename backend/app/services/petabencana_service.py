"""Fetch and normalize crowdsourced incident reports from PetaBencana."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from app.config import (
    HTTP_TIMEOUT_SECONDS,
    PETABENCANA_ADMIN,
    PETABENCANA_BASE_URL,
    PROCESSED_DATA_DIR,
    RAW_DATA_DIR,
    USER_AGENT,
    ensure_data_directories,
)


@dataclass
class PetaBencanaFetchResult:
    reports: list[dict[str, Any]] | None
    error: str | None = None

    @property
    def available(self) -> bool:
        return self.reports is not None and self.error is None


def _write_json(path: Path, payload: Any) -> None:
    ensure_data_directories()
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _as_number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _report_age_minutes(timestamp: Any) -> float | None:
    if not timestamp:
        return None
    try:
        parsed = datetime.fromisoformat(str(timestamp).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return max(
        0.0,
        round(
            (datetime.now(timezone.utc) - parsed.astimezone(timezone.utc)).total_seconds()
            / 60,
            2,
        ),
    )


def normalize_reports(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Normalize the GeoJSON response requested from the documented endpoint."""
    result = payload.get("result") or {}
    features = result.get("features") if result.get("type") == "FeatureCollection" else []
    normalized: list[dict[str, Any]] = []

    for feature in features or []:
        properties = feature.get("properties") or {}
        geometry = feature.get("geometry") or {}
        coordinates = geometry.get("coordinates") or []
        longitude = latitude = None
        if geometry.get("type") == "Point" and len(coordinates) >= 2:
            longitude, latitude = _as_number(coordinates[0]), _as_number(coordinates[1])

        created_at = properties.get("created_at")
        report_id = properties.get("pkey") or properties.get("report_id") or properties.get("id")
        normalized.append(
            {
                "report_id": str(report_id) if report_id is not None else None,
                "disaster_type": properties.get("disaster_type"),
                "latitude": latitude,
                "longitude": longitude,
                "created_at": created_at,
                "status": properties.get("status"),
                "source": "PetaBencana",
                "report_age_minutes": _report_age_minutes(created_at),
            }
        )
    return normalized


async def fetch_reports() -> PetaBencanaFetchResult:
    """Call the public reports endpoint with a required identifying User-Agent."""
    params: dict[str, str] = {"geoformat": "geojson"}
    if PETABENCANA_ADMIN:
        params["admin"] = PETABENCANA_ADMIN
    try:
        async with httpx.AsyncClient(
            timeout=HTTP_TIMEOUT_SECONDS, headers={"User-Agent": USER_AGENT}
        ) as client:
            response = await client.get(f"{PETABENCANA_BASE_URL}/reports", params=params)
            response.raise_for_status()
            raw_payload = response.json()
        _write_json(RAW_DATA_DIR / "petabencana_raw.json", raw_payload)
        reports = normalize_reports(raw_payload)
        _write_json(PROCESSED_DATA_DIR / "petabencana_normalized.json", reports)
        return PetaBencanaFetchResult(reports=reports)
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        return PetaBencanaFetchResult(reports=None, error=f"PetaBencana unavailable: {exc}")

