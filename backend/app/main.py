"""FastAPI entrypoint for the EvacuAid hackathon backend MVP."""

from __future__ import annotations

import asyncio

from fastapi import FastAPI, HTTPException, Query

from app.config import DEFAULT_ADM4
from app.models.risk import RiskRequest, RiskResponse
from app.services.bmkg_service import fetch_weather
from app.services.petabencana_service import fetch_reports
from app.services.risk_service import aggregate_risk, reports_with_distances


app = FastAPI(title="EvacuAid Backend", version="0.1.0")


@app.get("/")
async def root() -> dict[str, str]:
    return {"service": "EvacuAid Backend", "status": "running"}


@app.get("/health")
async def health() -> dict[str, object]:
    bmkg, reports = await asyncio.gather(fetch_weather(DEFAULT_ADM4), fetch_reports())
    return {
        "service": "EvacuAid Backend",
        "status": "running",
        "sources": {
            "BMKG": {"status": "available" if bmkg.available else "unavailable", "error": bmkg.error},
            "PetaBencana": {
                "status": "available" if reports.available else "unavailable",
                "error": reports.error,
            },
        },
    }


@app.get("/api/weather")
async def weather(adm4: str = Query(default=DEFAULT_ADM4, min_length=1)) -> dict[str, object]:
    result = await fetch_weather(adm4)
    if not result.available:
        return {"status": "unavailable", "data": None, "error": result.error}
    return result.data


@app.get("/api/reports")
async def reports(
    latitude: float | None = Query(default=None, ge=-90, le=90),
    longitude: float | None = Query(default=None, ge=-180, le=180),
    radius_m: float | None = Query(default=None, gt=0),
    disaster_type: str | None = Query(default=None, min_length=1),
) -> dict[str, object]:
    if (latitude is None) != (longitude is None):
        raise HTTPException(status_code=422, detail="latitude and longitude must be supplied together")
    if radius_m is not None and latitude is None:
        raise HTTPException(status_code=422, detail="radius_m requires latitude and longitude")

    result = await fetch_reports()
    if not result.available:
        return {"status": "unavailable", "reports": [], "error": result.error}
    output = reports_with_distances(result.reports or [], latitude, longitude)
    if disaster_type:
        wanted_type = disaster_type.lower()
        output = [
            report
            for report in output
            if str(report.get("disaster_type", "")).lower() == wanted_type
        ]
    if radius_m is not None:
        output = [
            report
            for report in output
            if report.get("distance_to_user_m") is not None
            and report["distance_to_user_m"] <= radius_m
        ]
    return {"status": "available", "reports": output}


@app.post("/api/risk", response_model=RiskResponse)
async def risk(request: RiskRequest) -> RiskResponse:
    return await aggregate_risk(request)

