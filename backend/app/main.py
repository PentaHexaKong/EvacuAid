"""FastAPI entrypoint for the EvacuAid hackathon backend MVP."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from redis.asyncio import Redis
from sqlalchemy import text

from app.config import DEFAULT_ADM4, REDIS_URL
from app.db.session import engine
from app.models.risk import RiskRequest, RiskResponse
from app.routers.context import router as context_router
from app.routers.buddies import router as buddies_router
from app.routers.assistance import router as assistance_router
from app.routers.users import router as users_router
from app.services.cacheService import CacheService
from app.services.bmkg_service import fetch_weather
from app.services.petabencana_service import fetch_reports
from app.services.risk_service import aggregate_risk, reports_with_distances


@asynccontextmanager
async def lifespan(application: FastAPI):
    application.state.redisClient = Redis.from_url(REDIS_URL, decode_responses=True)
    yield
    await application.state.redisClient.aclose()
    await engine.dispose()


app = FastAPI(title="EvacuAid Backend", version="0.2.0", lifespan=lifespan)
app.include_router(users_router)
app.include_router(context_router)
app.include_router(buddies_router)
app.include_router(assistance_router)


@app.get("/")
async def root() -> dict[str, str]:
    return {"service": "EvacuAid Backend", "status": "running"}


@app.get("/health")
async def health() -> dict[str, object]:
    bmkg, reports = await asyncio.gather(fetch_weather(DEFAULT_ADM4), fetch_reports())
    try:
        async with engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
        database_status = "healthy"
    except Exception:
        database_status = "unavailable"
    redis_status = "healthy" if await CacheService(getattr(app.state, "redisClient", None)).healthy() else "unavailable"
    status = "healthy" if database_status == "healthy" and redis_status == "healthy" else "degraded"
    return {
        "service": "EvacuAid Backend",
        "status": status,
        "database": database_status,
        "redis": redis_status,
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

