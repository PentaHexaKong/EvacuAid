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

- `POST /v1/guest-sessions` — create a guest profile and return its private bearer token once
- `GET /v1/me` — load the profile owned by the bearer token
- `DELETE /v1/guest-sessions/current` — delete the signed-in guest profile
- `GET /v1/users/{userId}`
- `PATCH /v1/users/{userId}`
- `PUT /v1/users/{userId}/location`
- `DELETE /v1/users/{userId}/location`
- `GET|PUT /v1/users/{userId}/accessibility`
- `GET|PUT /v1/users/{userId}/preferences`
- `GET /v1/context`
- `POST /v1/users/{userId}/buddies/invitations`
- `GET /v1/users/{userId}/buddies`
- `GET /v1/users/{userId}/buddies/{relationshipId}`
- `DELETE /v1/users/{userId}/buddies/{relationshipId}`
- `GET /v1/users/{buddyUserId}/buddy-invitations`
- `POST /v1/buddy-invitations/{relationshipId}/accept`
- `POST /v1/buddy-invitations/{relationshipId}/reject`
- `GET /v1/users/{userId}/buddy-candidates`
- `POST /v1/assistance/requests`
- `GET /v1/assistance/requests/{requestId}`
- `GET /v1/users/{userId}/assistance/requests`
- `GET /v1/users/{buddyUserId}/assistance/assignments`
- `POST /v1/assistance/requests/{requestId}/{notify|accept|decline|depart|arrive|evacuating|safe|cancel}`

`/v1/context` loads the persisted user, location, accessibility, and preferences, then delegates exposure and recommendation generation to the risk service. Its action includes stable `reason_codes` and presentation requirements. Accessibility changes delivery requirements, not hazard severity.

All profile, context, buddy, and assistance endpoints require `Authorization: Bearer <token>`. The API derives the caller from that token; a user ID in a path or request body never grants ownership. The token is returned only when the guest session is created and only its hash is stored in PostgreSQL. The frontend stores the token with Expo SecureStore. Guest profiles have no account recovery: losing the device token means the old profile cannot be reopened. Production deployments must use HTTPS. Set `EXPO_PUBLIC_API_BASE_URL` in the frontend environment; `.env.example` contains only the Android emulator development address.

## Buddy and assistance

Buddy relationships are directional: `buddyUserId` assists `userId`; they are not reciprocal. A relationship moves from `PENDING` to `ACTIVE` only when the invited user accepts. It can instead become `REJECTED` or be preserved as `REVOKED` when removed.

Location is a user-saved point, not live tracking; context and buddy distance exclude points older than 15 minutes.

Assistance requests use this transition graph:

```text
REQUESTED -> NOTIFIED -> ACCEPTED -> EN_ROUTE -> ARRIVED -> EVACUATING -> SAFE
REQUESTED -> CANCELLED
NOTIFIED -> DECLINED | CANCELLED | EXPIRED
ACCEPTED | EN_ROUTE -> CANCELLED
ARRIVED -> SAFE
```

`NOTIFIED` is internal application state only. It does not confirm delivery by push, SMS, WhatsApp, or any external provider.

Candidate discovery only includes active relationships. It calculates distance with PostGIS `ST_Distance` on geography points, then ranks primary before secondary before community, available before busy, and nearer before farther. Safety remains truthfully `UNKNOWN`; automatic dispatch is not implemented.

## Schema and current scope

The initial Alembic revision creates:

- `users`: UUID profile, optional coordinates, assistance flag, timestamps
- `user_accessibility`: normalized multi-value attributes with one type per user
- `user_preferences`: one-to-one voice, vibration, text, and language preferences
- `buddy_relationships`: directional invitation and active-assistance network
- `assistance_requests`: canonical assistance workflow, timestamps, and status history
- `users.location`: indexed PostGIS geography point synchronized when the location API is used

Implemented: profile persistence, profile APIs, buddy invitations, assistance state transitions, PostGIS candidate discovery, v2 explainable risk fields, source caching with graceful Redis failure, and unified context.

Partial: authoritative warning ingestion is future-ready only; no official source is fabricated.

Future: external notification delivery, shelter routing, and navigation. Context returns `NOT_REQUESTED` only where there is no active persisted request, and `NOT_REQUIRED` navigation until routing exists.

## Shelters and navigation

Shelters are persistent PostGIS geography points with source provenance. Production imports must use verified shelter data; test fixtures use `source=TEST_FIXTURE` and are not official destinations. Nearby discovery uses `ST_DWithin` and `ST_Distance` rather than loading all shelters into Python.

Shelters are rejected when closed, full, capacity-exhausted, or explicitly not wheelchair-accessible for a mobility-limited user. Unknown occupancy and accessibility remain unknown in the response; they are never treated as available or compatible.

`POST /v1/navigation/routes` accepts `userId` and optional `destinationShelterId`. The backend selects a suitable shelter, asks Valhalla for a pedestrian route, then evaluates accessibility and nearby PetaBencana report points. A nearby report makes the route `POTENTIALLY_EXPOSED`; it is supporting evidence, not a flood polygon or authoritative unsafe declaration.

OpenStreetMap supplies road data. Valhalla performs road-graph routing and geometry generation. EvacuAid selects shelters and evaluates accessibility and hazard evidence. The first implementation requests one pedestrian route; alternative routes and authoritative hazard polygons are future work.

Valhalla is an optional Compose profile because routing tiles must be prepared once from a bounded OSM extract. It uses a persistent `valhalla_tiles` volume and does not download the planet or rebuild tiles on normal backend startup. With the provided Java extract at `backend/data/valhallaData/java-260920.osm.pbf`, prepare tiles and start routing with:

```powershell
docker run --rm --cpus 1 -v evacuaid_valhalla_tiles:/data/valhalla -v "${PWD}/backend/data/valhallaData:/input:ro" --entrypoint valhalla_build_tiles ghcr.io/interline-io/valhalla-docker/valhalla:latest -j 1 -c /build/valhalla.json /input/java-260920.osm.pbf
docker compose --profile routing up -d valhalla
```

Until tiles are prepared, `/health` reports Valhalla unavailable and the backend as degraded; profile, context, risk, buddy, and assistance APIs remain available. Navigation then truthfully returns `UNAVAILABLE` when invoked.
