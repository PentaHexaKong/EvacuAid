# SigApp Backend MVP

Small FastAPI backend for EvacuAid/SigApp. It fetches contextual BMKG weather and current PetaBencana community reports, normalizes them, compares reports to an optional user location, and returns a transparent response for the frontend.

It is **not** a hazard-prediction system and does not create official warnings. `official_status` stays `null` because this MVP does not integrate an authoritative warning/instruction feed. BMKG forecasts are contextual weather data; PetaBencana `/reports` data is community reporting. A nearby report can result in `ELEVATED` and `PREPARE`, never `EVACUATE`.

## Folder structure

```text
backend/
├── app/                 # FastAPI routes, models, fetchers, aggregation logic
├── data/
│   ├── raw/             # Untouched successful API responses (generated at runtime)
│   ├── processed/       # Normalized API responses (generated at runtime)
│   └── final_output.json # Latest POST /api/risk response (generated at runtime)
├── tests/
├── requirements.txt
└── .env.example
```

## Install and run

```powershell
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app.main:app --reload
```

Open Swagger at <http://127.0.0.1:8000/docs>.

## API examples

```powershell
curl "http://127.0.0.1:8000/api/weather?adm4=31.71.03.1001"

curl "http://127.0.0.1:8000/api/reports?latitude=-6.1647214778&longitude=106.8453837867&radius_m=5000"

curl -X POST "http://127.0.0.1:8000/api/risk" `
  -H "Content-Type: application/json" `
  -d '{"adm4":"31.71.03.1001","latitude":-6.1647214778,"longitude":106.8453837867,"user_profile":"MOBILITY_LIMITATION","needs_assistance":true}'
```

## Configuration and limitations

- `DEFAULT_NEARBY_RADIUS_METERS` is an application search radius, not a scientific danger radius.
- `MAX_DATA_AGE_MINUTES=1440` reflects BMKG's daily forecast-analysis cycle; it is a data-quality guard, not an alert expiry.
- PetaBencana documents `GET https://api.petabencana.id/reports` and asks clients to provide a `User-Agent`; this backend requests `geoformat=geojson` for reliable point extraction.
- PetaBencana can validly return zero current reports. That means no report was returned by that query, not that there is no disaster anywhere.
- A normal successful response is `MEDIUM` confidence because no authoritative warning source is integrated. `HIGH` is deliberately reserved for future authoritative, fresh warning data.
- If one source is unavailable, `/api/risk` still returns all usable information with `LOW` confidence. No disaster reports are fabricated.

## Tests

```powershell
pytest
```

Tests use mocked source results and never call live APIs.
