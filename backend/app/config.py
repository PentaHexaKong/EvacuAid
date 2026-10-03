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
BMKG_QUAKE_URL = os.getenv("BMKG_QUAKE_URL", "https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json")
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
ROUTE_HAZARD_PROXIMITY_SIGMA_METERS = float(os.getenv('ROUTE_HAZARD_PROXIMITY_SIGMA_METERS', '500'))
ROUTE_CRITICAL_GEOMETRY_BUFFER_METERS = float(os.getenv('ROUTE_CRITICAL_GEOMETRY_BUFFER_METERS', '25'))
ROUTE_CROWDSOURCED_PROBABILITY = float(os.getenv('ROUTE_CROWDSOURCED_PROBABILITY', '0.4'))
ROUTE_CROWDSOURCED_SEVERITY = float(os.getenv('ROUTE_CROWDSOURCED_SEVERITY', '0.7'))
ROUTE_CROWDSOURCED_CONFIDENCE = float(os.getenv('ROUTE_CROWDSOURCED_CONFIDENCE', '0.5'))
ROUTE_UNKNOWN_UNCERTAINTY = float(os.getenv('ROUTE_UNKNOWN_UNCERTAINTY', '1'))
ROUTE_CROWDSOURCED_UNCERTAINTY = float(os.getenv('ROUTE_CROWDSOURCED_UNCERTAINTY', '0.7'))
ROUTE_ACCESSIBILITY_UNKNOWN_PENALTY = float(os.getenv('ROUTE_ACCESSIBILITY_UNKNOWN_PENALTY', '1'))
ROUTE_RISK_WEIGHT_EXPOSURE = float(os.getenv('ROUTE_RISK_WEIGHT_EXPOSURE', '0.45'))
ROUTE_RISK_WEIGHT_PROXIMITY = float(os.getenv('ROUTE_RISK_WEIGHT_PROXIMITY', '0.2'))
ROUTE_RISK_WEIGHT_ACCESSIBILITY = float(os.getenv('ROUTE_RISK_WEIGHT_ACCESSIBILITY', '0.15'))
ROUTE_RISK_WEIGHT_UNCERTAINTY = float(os.getenv('ROUTE_RISK_WEIGHT_UNCERTAINTY', '0.1'))
ROUTE_RISK_WEIGHT_TIME = float(os.getenv('ROUTE_RISK_WEIGHT_TIME', '0.1'))
ROUTE_RISK_TOLERANCE = float(os.getenv('ROUTE_RISK_TOLERANCE', '0.01'))
ROUTE_ACCESSIBILITY_TOLERANCE = float(os.getenv('ROUTE_ACCESSIBILITY_TOLERANCE', '0.01'))
ROUTE_DETOUR_POLICY = os.getenv('ROUTE_DETOUR_POLICY', 'ratio').strip().lower()
ROUTE_MAX_DETOUR_RATIO = float(os.getenv('ROUTE_MAX_DETOUR_RATIO', '0.5'))
ROUTE_MAX_DETOUR_SECONDS = float(os.getenv('ROUTE_MAX_DETOUR_SECONDS', '900'))

ROUTE_RISK_WEIGHTS = (
    ROUTE_RISK_WEIGHT_EXPOSURE,
    ROUTE_RISK_WEIGHT_PROXIMITY,
    ROUTE_RISK_WEIGHT_ACCESSIBILITY,
    ROUTE_RISK_WEIGHT_UNCERTAINTY,
    ROUTE_RISK_WEIGHT_TIME,
)

if any(weight < 0 for weight in ROUTE_RISK_WEIGHTS) or abs(sum(ROUTE_RISK_WEIGHTS) - 1) > 1e-6:
    raise ValueError('route risk weights must be non-negative and sum to 1')

if ROUTE_DETOUR_POLICY not in {'ratio', 'seconds', 'disabled'}:
    raise ValueError('ROUTE_DETOUR_POLICY must be ratio, seconds, or disabled')


def ensure_data_directories() -> None:
    """Create runtime output folders when the app first needs them."""
    RAW_DATA_DIR.mkdir(parents=True, exist_ok=True)
    PROCESSED_DATA_DIR.mkdir(parents=True, exist_ok=True)

INARISK_BASE_URL = os.getenv('INARISK_BASE_URL', 'https://gis.bnpb.go.id/server/rest/services/inarisk').rstrip('/')
BMKG_EARTHQUAKE_URL = os.getenv('BMKG_EARTHQUAKE_URL', 'https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json')
BMKG_CAP_URL = os.getenv('BMKG_CAP_URL', 'https://www.bmkg.go.id/alerts/nowcast/id')
FIRMS_BASE_URL = os.getenv('FIRMS_BASE_URL', 'https://firms.modaps.eosdis.nasa.gov').rstrip('/')
FIRMS_MAP_KEY = os.getenv('FIRMS_MAP_KEY', '')
FIRMS_SOURCE = os.getenv('FIRMS_SOURCE', 'VIIRS_NOAA20_NRT')
FIRMS_UNKNOWN_QUALITY = float(os.getenv('FIRMS_UNKNOWN_QUALITY', '0.5'))
HAZARD_AREA = os.getenv('HAZARD_AREA', '106.6,-6.5,107.1,-6.0')
HAZARD_TTLS = {'BMKG_EARTHQUAKE': int(os.getenv('HAZARD_EARTHQUAKE_TTL_SECONDS', '300')), 'BMKG_CAP': int(os.getenv('HAZARD_CAP_TTL_SECONDS', '300')), 'FIRMS': int(os.getenv('HAZARD_FIRMS_TTL_SECONDS', '1800')), 'PETABENCANA': int(os.getenv('HAZARD_COMMUNITY_TTL_SECONDS', '300')), 'INARISK': int(os.getenv('HAZARD_INARISK_TTL_SECONDS', '2592000'))}
HAZARD_EVENT_MAX_AGE_SECONDS = int(os.getenv('HAZARD_EVENT_MAX_AGE_SECONDS', '86400'))
HAZARD_COMMUNITY_MAX_AGE_SECONDS = int(os.getenv('HAZARD_COMMUNITY_MAX_AGE_SECONDS', '86400'))
HAZARD_SAMPLE_METERS = float(os.getenv('HAZARD_SAMPLE_METERS', '50'))
HAZARD_MAX_SAMPLES = int(os.getenv('HAZARD_MAX_SAMPLES', '2000'))
HAZARD_MAX_EVIDENCE = int(os.getenv('HAZARD_MAX_EVIDENCE', '10000'))
HAZARD_SEARCH_METERS = float(os.getenv('HAZARD_SEARCH_METERS', '20000'))
HAZARD_SIGMAS = {name: float(os.getenv(f'HAZARD_{name}_SIGMA_METERS', str(default))) for name, default in [('FLOOD', 500), ('EARTHQUAKE', 20000), ('TSUNAMI', 500), ('WILDFIRE', 1000), ('LANDSLIDE', 500)]}
HAZARD_WEIGHTS = {name: float(os.getenv(f'HAZARD_{name}_WEIGHT', '1')) for name in HAZARD_SIGMAS}
HAZARD_COEFFICIENTS = {name: tuple(float(os.getenv(f'HAZARD_{name}_{term}', str(default))) for term, default in [('ALPHA', 0.6), ('BETA', 0.3), ('GAMMA', 0.1)]) for name in HAZARD_SIGMAS}
HAZARD_UNCERTAINTY_TOLERANCE = float(os.getenv('HAZARD_UNCERTAINTY_TOLERANCE', '0.01'))
TSUNAMI_GAIN_REFERENCE_METERS = float(os.getenv('TSUNAMI_GAIN_REFERENCE_METERS', '30'))
DETOUR_CLEARANCE_METERS = float(os.getenv('DETOUR_CLEARANCE_METERS', '100'))
DETOUR_MAX_WAYPOINT_CANDIDATES = int(os.getenv('DETOUR_MAX_WAYPOINT_CANDIDATES', '8'))
ROUTE_MAX_ALTERNATIVES = int(os.getenv('ROUTE_MAX_ALTERNATIVES', '3'))
ROUTE_OPERATIONAL_MAX_SECONDS = float(os.getenv('ROUTE_OPERATIONAL_MAX_SECONDS', '14400'))
ROUTE_ENDPOINT_TOLERANCE_METERS = float(os.getenv('ROUTE_ENDPOINT_TOLERANCE_METERS', '100'))
DEM_ASSET_PATH = os.getenv('DEM_ASSET_PATH', '')
DEM_SOURCE = os.getenv('DEM_SOURCE', 'UNKNOWN')
DEM_VERTICAL_DATUM = os.getenv('DEM_VERTICAL_DATUM', 'UNKNOWN')

if HAZARD_SAMPLE_METERS <= 0 or HAZARD_MAX_SAMPLES < 1 or HAZARD_MAX_EVIDENCE < 1 or HAZARD_SEARCH_METERS <= 0:
    raise ValueError('hazard sampling and query bounds must be positive')
if any(value <= 0 for value in HAZARD_SIGMAS.values()) or any(value < 0 for value in HAZARD_WEIGHTS.values()):
    raise ValueError('invalid hazard policy weights or distance scales')
if any(value < 0 for values in HAZARD_COEFFICIENTS.values() for value in values):
    raise ValueError('hazard coefficients must be nonnegative')
if DETOUR_CLEARANCE_METERS <= 0 or not 1 <= DETOUR_MAX_WAYPOINT_CANDIDATES <= 32 or not 1 <= ROUTE_MAX_ALTERNATIVES <= 8:
    raise ValueError('invalid detour candidate bounds')
if min(ROUTE_RISK_TOLERANCE, ROUTE_ACCESSIBILITY_TOLERANCE, HAZARD_UNCERTAINTY_TOLERANCE, TSUNAMI_GAIN_REFERENCE_METERS, ROUTE_OPERATIONAL_MAX_SECONDS) <= 0:
    raise ValueError('ranking tolerances and operational bounds must be positive')
if any(value < 60 for value in HAZARD_TTLS.values()) or min(HAZARD_EVENT_MAX_AGE_SECONDS, HAZARD_COMMUNITY_MAX_AGE_SECONDS) <= 0:
    raise ValueError('provider TTL must be at least 60 seconds and evidence max ages must be positive')
if not 0 <= FIRMS_UNKNOWN_QUALITY <= 1 or ROUTE_ENDPOINT_TOLERANCE_METERS <= 0:
    raise ValueError('invalid hotspot quality or endpoint tolerance')
