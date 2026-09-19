"""Transparent, conservative aggregation logic for EvacuAid's MVP risk response."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable

from app.config import (
    DEFAULT_NEARBY_RADIUS_METERS,
    FINAL_OUTPUT_PATH,
    MAX_DATA_AGE_MINUTES,
    ensure_data_directories,
)
from app.models.risk import (
    ActionData,
    AssistanceData,
    ConfidenceLevel,
    EventData,
    ExposureData,
    ExposureStatus,
    NavigationData,
    QualityData,
    RecommendedAction,
    RiskRequest,
    RiskResponse,
    SignalLevel,
    UserProfile,
    WeatherData,
)
from app.services.bmkg_service import BmkgFetchResult, fetch_weather
from app.services.petabencana_service import PetaBencanaFetchResult, fetch_reports
from app.utils.geo import calculate_distance_meters


WeatherFetcher = Callable[[str], Awaitable[BmkgFetchResult]]
ReportsFetcher = Callable[[], Awaitable[PetaBencanaFetchResult]]


def _write_final_output(response: RiskResponse) -> None:
    ensure_data_directories()
    FINAL_OUTPUT_PATH.write_text(
        json.dumps(response.model_dump(mode="json"), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def reports_with_distances(
    reports: list[dict[str, Any]], latitude: float | None, longitude: float | None
) -> list[dict[str, Any]]:
    """Copy reports and attach a distance only when both points are usable."""
    annotated: list[dict[str, Any]] = []
    for report in reports:
        item = dict(report)
        event_lat, event_lon = item.get("latitude"), item.get("longitude")
        if (
            latitude is not None
            and longitude is not None
            and event_lat is not None
            and event_lon is not None
        ):
            item["distance_to_user_m"] = round(
                calculate_distance_meters(latitude, longitude, event_lat, event_lon), 2
            )
        annotated.append(item)
    return annotated


def _weather_data(normalized_weather: dict[str, Any] | None) -> WeatherData | None:
    if not normalized_weather:
        return None
    forecast = next(iter(normalized_weather.get("forecasts") or []), None)
    if not forecast:
        return None
    return WeatherData(
        condition=forecast.get("weather_desc"),
        temperature_c=forecast.get("temperature_c"),
        humidity_pct=forecast.get("humidity_pct"),
        precipitation=forecast.get("precipitation"),
        wind_speed=forecast.get("wind_speed"),
    )


def _data_is_stale(
    weather: dict[str, Any] | None, reports: list[dict[str, Any]] | None
) -> bool:
    ages: list[float] = []
    for forecast in (weather or {}).get("forecasts") or []:
        if isinstance(forecast.get("forecast_age_minutes"), (int, float)):
            ages.append(forecast["forecast_age_minutes"])
    for report in reports or []:
        if isinstance(report.get("report_age_minutes"), (int, float)):
            ages.append(report["report_age_minutes"])
    return bool(ages) and min(ages) > MAX_DATA_AGE_MINUTES


def _confidence(
    bmkg: BmkgFetchResult,
    reports: PetaBencanaFetchResult,
    has_location: bool,
) -> ConfidenceLevel:
    if not bmkg.available or not reports.available or not has_location:
        return ConfidenceLevel.LOW
    if _data_is_stale(bmkg.data, reports.reports):
        return ConfidenceLevel.LOW
    # This MVP has no authoritative warning feed. BMKG is contextual data and
    # PetaBencana's /reports endpoint is crowdsourced, so HIGH is deliberately
    # reserved until such a source is integrated.
    return ConfidenceLevel.MEDIUM


def _action_for(signal_level: SignalLevel, official_status: str | None) -> RecommendedAction:
    if official_status:
        return RecommendedAction.FOLLOW_OFFICIAL_INSTRUCTION
    if signal_level == SignalLevel.ELEVATED:
        return RecommendedAction.PREPARE
    return RecommendedAction.MONITOR


async def aggregate_risk(
    request: RiskRequest,
    weather_fetcher: WeatherFetcher = fetch_weather,
    reports_fetcher: ReportsFetcher = fetch_reports,
) -> RiskResponse:
    """Combine live source results and user context without inferring official alerts."""
    bmkg_result, reports_result = await asyncio.gather(
        weather_fetcher(request.adm4), reports_fetcher()
    )
    reports = reports_result.reports or []
    annotated_reports = reports_with_distances(reports, request.latitude, request.longitude)
    reports_by_distance = sorted(
        (report for report in annotated_reports if report.get("distance_to_user_m") is not None),
        key=lambda report: report["distance_to_user_m"],
    )
    nearby_reports = [
        report
        for report in reports_by_distance
        if report["distance_to_user_m"] <= DEFAULT_NEARBY_RADIUS_METERS
    ]
    nearest = reports_by_distance[0] if reports_by_distance else None
    has_location = request.latitude is not None and request.longitude is not None

    if not has_location:
        exposure_status = ExposureStatus.UNKNOWN
    elif nearby_reports:
        exposure_status = ExposureStatus.NEARBY
    else:
        exposure_status = ExposureStatus.NO_KNOWN_EXPOSURE

    weather = _weather_data(bmkg_result.data)
    if nearby_reports:
        signal_level = SignalLevel.ELEVATED
    elif weather is not None:
        signal_level = SignalLevel.WATCH
    else:
        signal_level = SignalLevel.NORMAL

    official_status = None
    assistance_required = (
        request.needs_assistance
        or request.user_profile == UserProfile.MOBILITY_LIMITATION
    )
    sources = []
    if bmkg_result.available:
        sources.append("BMKG")
    if reports_result.available:
        sources.append("PetaBencana")

    response = RiskResponse(
        event=EventData(
            hazard_type=(
                str(nearest.get("disaster_type")).upper()
                if nearest and nearest.get("disaster_type")
                else None
            ),
            official_status=official_status,
            signal_level=signal_level,
        ),
        exposure=ExposureData(
            status=exposure_status,
            nearest_event_distance_m=(
                nearest.get("distance_to_user_m") if nearest else None
            ),
            nearby_report_count=len(nearby_reports),
        ),
        weather=weather,
        action=ActionData(
            recommended_action=_action_for(signal_level, official_status),
            assistance_required=assistance_required,
        ),
        assistance=AssistanceData(buddy_status=None),
        navigation=NavigationData(route_status="NOT_REQUIRED"),
        quality=QualityData(
            confidence=_confidence(bmkg_result, reports_result, has_location),
            sources=sources,
            updated_at=datetime.now(timezone.utc).isoformat(),
        ),
    )
    _write_final_output(response)
    return response

