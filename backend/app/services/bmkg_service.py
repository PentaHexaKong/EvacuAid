"""Fetch and normalize contextual weather data from BMKG."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from app.config import (
    BMKG_BASE_URL,
    HTTP_TIMEOUT_SECONDS,
    PROCESSED_DATA_DIR,
    RAW_DATA_DIR,
    USER_AGENT,
    ensure_data_directories,
)


@dataclass
class BmkgFetchResult:
    data: dict[str, Any] | None
    error: str | None = None

    @property
    def available(self) -> bool:
        return self.data is not None and self.error is None


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


def _parse_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value).strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        try:
            parsed = datetime.strptime(text, "%m/%d/%Y %H:%M:%S")
        except ValueError:
            return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _age_minutes(timestamp: Any) -> float | None:
    parsed = _parse_datetime(timestamp)
    if parsed is None:
        return None
    return max(0.0, round((datetime.now(timezone.utc) - parsed.astimezone(timezone.utc)).total_seconds() / 60, 2))


def normalize_weather(payload: dict[str, Any]) -> dict[str, Any]:
    """Keep only the BMKG fields used by this MVP; leave unavailable data null."""
    data_rows = payload.get("data") or []
    data_row = data_rows[0] if data_rows else {}
    location = payload.get("lokasi") or data_row.get("lokasi") or {}
    forecasts: list[dict[str, Any]] = []

    for day in data_row.get("cuaca") or []:
        for forecast in day or []:
            analysis_date = forecast.get("analysis_date")
            forecasts.append(
                {
                    "local_datetime": forecast.get("local_datetime"),
                    "weather": forecast.get("weather"),
                    "weather_desc": forecast.get("weather_desc"),
                    "temperature_c": _as_number(forecast.get("t")),
                    "humidity_pct": _as_number(forecast.get("hu")),
                    "precipitation": _as_number(forecast.get("tp")),
                    "wind_speed": _as_number(forecast.get("ws")),
                    "wind_direction": forecast.get("wd"),
                    "cloud_cover": _as_number(forecast.get("tcc")),
                    "forecast_age_minutes": _age_minutes(analysis_date),
                }
            )

    first_analysis_date = None
    if data_row.get("cuaca") and data_row["cuaca"][0]:
        first_analysis_date = data_row["cuaca"][0][0].get("analysis_date")

    normalized = {
        "adm4": location.get("adm4"),
        "provinsi": location.get("provinsi"),
        "kotkab": location.get("kotkab"),
        "kecamatan": location.get("kecamatan"),
        "desa": location.get("desa"),
        "latitude": _as_number(location.get("lat")),
        "longitude": _as_number(location.get("lon")),
        "analysis_date": first_analysis_date,
        "forecasts": forecasts,
    }
    return normalized


async def fetch_weather(adm4: str) -> BmkgFetchResult:
    """Call BMKG, storing raw and normalized JSON only after a valid response."""
    try:
        async with httpx.AsyncClient(
            timeout=HTTP_TIMEOUT_SECONDS, headers={"User-Agent": USER_AGENT}
        ) as client:
            response = await client.get(
                f"{BMKG_BASE_URL}/publik/prakiraan-cuaca", params={"adm4": adm4}
            )
            response.raise_for_status()
            raw_payload = response.json()
        _write_json(RAW_DATA_DIR / "bmkg_raw.json", raw_payload)
        normalized = normalize_weather(raw_payload)
        _write_json(PROCESSED_DATA_DIR / "bmkg_normalized.json", normalized)
        return BmkgFetchResult(data=normalized)
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        return BmkgFetchResult(data=None, error=f"BMKG unavailable: {exc}")
