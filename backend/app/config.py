"""Small, environment-based configuration for the MVP."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv


BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

DATA_DIR = BACKEND_DIR / "data"
RAW_DATA_DIR = DATA_DIR / "raw"
PROCESSED_DATA_DIR = DATA_DIR / "processed"
FINAL_OUTPUT_PATH = DATA_DIR / "final_output.json"

BMKG_BASE_URL = os.getenv("BMKG_BASE_URL", "https://api.bmkg.go.id").rstrip("/")
PETABENCANA_BASE_URL = os.getenv(
    "PETABENCANA_BASE_URL", "https://api.petabencana.id"
).rstrip("/")
PETABENCANA_ADMIN = os.getenv("PETABENCANA_ADMIN", "").strip()
DEFAULT_ADM4 = os.getenv("DEFAULT_ADM4", "31.71.03.1001")
DEFAULT_NEARBY_RADIUS_METERS = float(
    os.getenv("DEFAULT_NEARBY_RADIUS_METERS", "5000")
)
HTTP_TIMEOUT_SECONDS = float(os.getenv("HTTP_TIMEOUT_SECONDS", "10"))
# BMKG's forecast analysis is published on a daily cycle, so this is a data
# freshness guard, not a short-lived event-alert expiry.
MAX_DATA_AGE_MINUTES = float(os.getenv("MAX_DATA_AGE_MINUTES", "1440"))
USER_AGENT = os.getenv(
    "USER_AGENT", "EvacuAid-MVP/0.1 (hackathon prototype)"
)
DATABASE_URL = os.getenv(
    'DATABASE_URL', 'postgresql+asyncpg://evacuaid:change-me@postgres:5432/evacuaid'
)
REDIS_URL = os.getenv('REDIS_URL', 'redis://redis:6379/0')
CONTEXT_CACHE_TTL_SECONDS = int(os.getenv('CONTEXT_CACHE_TTL_SECONDS', '60'))
VALHALLA_URL = os.getenv('VALHALLA_URL', 'http://valhalla:8002').rstrip('/')
VALHALLA_TIMEOUT_SECONDS = float(os.getenv('VALHALLA_TIMEOUT_SECONDS', '10'))
ROUTE_HAZARD_RADIUS_METERS = float(os.getenv('ROUTE_HAZARD_RADIUS_METERS', '100'))


def ensure_data_directories() -> None:
    """Create runtime output folders when the app first needs them."""
    RAW_DATA_DIR.mkdir(parents=True, exist_ok=True)
    PROCESSED_DATA_DIR.mkdir(parents=True, exist_ok=True)
