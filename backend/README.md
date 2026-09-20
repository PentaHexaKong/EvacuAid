# EvacuAid Backend

EvacuAid is a Docker-first FastAPI backend for personalized disaster context. PostgreSQL with PostGIS is the canonical profile store. Redis is a best-effort cache for BMKG and PetaBencana source responses.

## Architecture

```text
Frontend -> FastAPI -> PostgreSQL + PostGIS
                    -> Redis cache
                    -> BMKG and PetaBencana
```

Community reports are supporting evidence only: without an authoritative warning, they can produce `WATCH`, `ELEVATED`, or `PREPARE`, never `EVACUATE`.

## Start

From `backend`:

```powershell
Copy-Item .env.example .env
```

From the repository root:

```powershell
docker compose up --build
```

The API is available at `http://127.0.0.1:8000`; Swagger is at `/docs`.

## Docker services

- `backend`: FastAPI, migrations applied before Uvicorn starts
- `postgres`: PostgreSQL 16 with PostGIS 3.4
- `redis`: transient cache only

Compose defaults are development-only. Configure `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD` in the root environment or Compose invocation; configure `DATABASE_URL` and `REDIS_URL` in `backend/.env` for non-Compose deployment.

## Migrations and tests

```powershell
docker compose exec backend alembic upgrade head
docker compose exec backend pytest
```

The test suite covers profile persistence, coordinate validation, multiple accessibility attributes, preferences, context orchestration, Redis fallback, explainable decision reasons, and the invariant that citizen reports cannot independently trigger evacuation.

## API

Existing MVP endpoints remain available:

- `GET /`
- `GET /health`
- `GET /api/weather`
- `GET /api/reports`
- `POST /api/risk`

Profile endpoints:

- `POST /v1/users`
- `GET /v1/users/{userId}`
- `PATCH /v1/users/{userId}`
- `PUT /v1/users/{userId}/location`
- `GET|PUT /v1/users/{userId}/accessibility`
- `GET|PUT /v1/users/{userId}/preferences`
- `GET /v1/context?user_id={uuid}`

`/v1/context` loads the persisted user, location, accessibility, and preferences, then delegates exposure and recommendation generation to the risk service. Its action includes stable `reason_codes` and presentation requirements. Accessibility changes delivery requirements, not hazard severity.

## Schema and current scope

The initial Alembic revision creates:

- `users`: UUID profile, optional coordinates, assistance flag, timestamps
- `user_accessibility`: normalized multi-value attributes with one type per user
- `user_preferences`: one-to-one voice, vibration, text, and language preferences

Implemented: profile persistence, profile APIs, v2 explainable risk fields, source caching with graceful Redis failure, and unified context.

Partial: authoritative warning ingestion is future-ready only; no official source is fabricated.

Future: buddy relationships, assistance workflow, shelter routing, and notification delivery. Context truthfully returns `NOT_REQUESTED` assistance and `NOT_REQUIRED` navigation until those systems exist.
