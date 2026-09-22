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
AUTH_JWT_SECRET = os.getenv('AUTH_JWT_SECRET', '')
AUTH_ACCESS_TOKEN_MINUTES = int(os.getenv('AUTH_ACCESS_TOKEN_MINUTES', '15'))
AUTH_REFRESH_DAYS = int(os.getenv('AUTH_REFRESH_DAYS', '30'))
AUTH_SHORT_REFRESH_DAYS = int(os.getenv('AUTH_SHORT_REFRESH_DAYS', '7'))
AUTH_ALLOWED_ORIGINS = [value.strip() for value in os.getenv('AUTH_ALLOWED_ORIGINS', '').split(',') if value.strip()]
GOOGLE_CLIENT_IDS = [value.strip() for value in os.getenv('GOOGLE_CLIENT_IDS', '').split(',') if value.strip()]
SMTP_HOST = os.getenv('SMTP_HOST', '').strip()
SMTP_PORT = int(os.getenv('SMTP_PORT', '587'))
SMTP_USERNAME = os.getenv('SMTP_USERNAME', '').strip()
SMTP_PASSWORD = os.getenv('SMTP_PASSWORD', '')
SMTP_FROM = os.getenv('SMTP_FROM', '').strip()
SMTP_STARTTLS = os.getenv('SMTP_STARTTLS', 'true').strip().lower() == 'true'
PASSWORD_RESET_URL_BASE = os.getenv('PASSWORD_RESET_URL_BASE', 'evacuaid://reset-password').strip()


def ensure_data_directories() -> None:
    """Create runtime output folders when the app first needs them."""
    RAW_DATA_DIR.mkdir(parents=True, exist_ok=True)
    PROCESSED_DATA_DIR.mkdir(parents=True, exist_ok=True)
