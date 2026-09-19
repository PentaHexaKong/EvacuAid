import asyncio

import pytest
from pydantic import ValidationError

from app.models.risk import (
    ConfidenceLevel,
    ExposureStatus,
    RecommendedAction,
    RiskRequest,
    RiskResponse,
)
from app.services.bmkg_service import BmkgFetchResult
from app.services.petabencana_service import PetaBencanaFetchResult
from app.services import risk_service
from app.utils.geo import calculate_distance_meters


WEATHER = {
    "forecasts": [
        {
            "weather_desc": "Cloudy",
            "temperature_c": 26.0,
            "humidity_pct": 84.0,
            "precipitation": 0.9,
            "wind_speed": 3.5,
            "forecast_age_minutes": 1.0,
        }
    ]
}
NEARBY_FLOOD = {
    "report_id": "report-1",
    "disaster_type": "flood",
    "latitude": -6.1648,
    "longitude": 106.8454,
    "created_at": "2026-09-19T00:00:00Z",
    "status": "confirmed",
    "source": "PetaBencana",
    "report_age_minutes": 1.0,
}


def run(coroutine):
    return asyncio.run(coroutine)


def request(**overrides):
    base = {
        "adm4": "31.71.03.1001",
        "latitude": -6.1647214778,
        "longitude": 106.8453837867,
    }
    base.update(overrides)
    return RiskRequest(**base)


def fetchers(weather_result, reports_result):
    async def weather_fetcher(_adm4):
        return weather_result

    async def reports_fetcher():
        return reports_result

    return weather_fetcher, reports_fetcher


def aggregate(tmp_path, risk_request, weather_result, reports_result, monkeypatch):
    monkeypatch.setattr(risk_service, "FINAL_OUTPUT_PATH", tmp_path / "final_output.json")
    weather_fetcher, reports_fetcher = fetchers(weather_result, reports_result)
    return run(risk_service.aggregate_risk(risk_request, weather_fetcher, reports_fetcher))


def test_valid_coordinates():
    payload = request()
    assert payload.latitude == pytest.approx(-6.1647214778)


def test_invalid_latitude_rejected():
    with pytest.raises(ValidationError):
        request(latitude=91)


def test_invalid_longitude_rejected():
    with pytest.raises(ValidationError):
        request(longitude=181)


def test_haversine_calculation():
    assert calculate_distance_meters(0, 0, 0, 0) == 0
    assert calculate_distance_meters(0, 0, 0, 1) == pytest.approx(111_195, abs=200)


def test_no_reports_means_no_known_exposure(tmp_path, monkeypatch):
    response = aggregate(
        tmp_path,
        request(),
        BmkgFetchResult(WEATHER),
        PetaBencanaFetchResult([]),
        monkeypatch,
    )
    assert response.exposure.status == ExposureStatus.NO_KNOWN_EXPOSURE
    assert response.action.recommended_action == RecommendedAction.MONITOR


def test_nearby_report_is_elevated_and_prepare(tmp_path, monkeypatch):
    response = aggregate(
        tmp_path,
        request(),
        BmkgFetchResult(WEATHER),
        PetaBencanaFetchResult([NEARBY_FLOOD]),
        monkeypatch,
    )
    assert response.exposure.status == ExposureStatus.NEARBY
    assert response.event.signal_level.value == "ELEVATED"
    assert response.action.recommended_action == RecommendedAction.PREPARE


def test_citizen_report_does_not_trigger_evacuation(tmp_path, monkeypatch):
    response = aggregate(
        tmp_path,
        request(),
        BmkgFetchResult(WEATHER),
        PetaBencanaFetchResult([NEARBY_FLOOD]),
        monkeypatch,
    )
    assert response.event.official_status is None
    assert response.action.recommended_action != RecommendedAction.EVACUATE


def test_external_api_failure_falls_back_without_crashing(tmp_path, monkeypatch):
    response = aggregate(
        tmp_path,
        request(),
        BmkgFetchResult(WEATHER),
        PetaBencanaFetchResult(None, "PetaBencana unavailable: timeout"),
        monkeypatch,
    )
    assert response.quality.confidence == ConfidenceLevel.LOW
    assert response.quality.sources == ["BMKG"]
    assert response.weather is not None


def test_mobility_limitation_activates_assistance(tmp_path, monkeypatch):
    response = aggregate(
        tmp_path,
        request(user_profile="MOBILITY_LIMITATION"),
        BmkgFetchResult(WEATHER),
        PetaBencanaFetchResult([]),
        monkeypatch,
    )
    assert response.action.assistance_required is True


def test_final_response_schema_and_file(tmp_path, monkeypatch):
    output_path = tmp_path / "final_output.json"
    monkeypatch.setattr(risk_service, "FINAL_OUTPUT_PATH", output_path)
    weather_fetcher, reports_fetcher = fetchers(BmkgFetchResult(WEATHER), PetaBencanaFetchResult([]))
    response = run(risk_service.aggregate_risk(request(), weather_fetcher, reports_fetcher))
    assert RiskResponse.model_validate(response.model_dump()) == response
    assert output_path.exists()

