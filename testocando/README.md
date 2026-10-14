# EvacuAid Command Center

The dashboard at `http://127.0.0.1:8080/command-center/` connects to the existing EvacuAid backend at port **8000** and its existing PostgreSQL/PostGIS database. Command routes share the same FastAPI app, database session, citizen routes, Redis lifecycle, and pilot worker. The old preview API/database are stopped.

The feature implementation remains under `testocando`. The root `docker-compose.yml` contains the bootstrap wiring so ordinary backend restarts retain command routes and recognize the combined migration graph. Citizen feature modules and the Expo frontend are unchanged.

## Start the connected backend and dashboard

From PowerShell, with Docker Desktop running and the existing `backend/.env` configured:

```powershell
cd D:\Hackathons\EvacuAid
docker compose up -d --build --wait dashboard
```

The root Compose command builds/starts the dashboard, backend, PostgreSQL, and Redis, and waits for container health. The startup script runs the same command. Open the dashboard and regional data loads automatically. No command token, Connect dialog, or credential file is required.

The dashboard container owns port 8080; do not run the standalone Python map server on that port alongside it. Both `http://127.0.0.1:8080/` and `/command-center/` open the government dashboard. The older routing sandbox remains at `/index.html`. API documentation: `http://127.0.0.1:8000/docs`.

Ordinary backend startup also retains the command extension:

```powershell
docker compose up -d --build backend
```

The backend automatically applies the combined migrations using `testocando/alembic.ini`. Command endpoints are open without authentication, as requested for this dashboard; existing citizen authentication remains unchanged.

The actual database has been migrated to `20261005_08_precision` and now contains **318 real Jakarta reference regions: 1 province, 6 cities/regencies, 44 districts, and 267 kelurahan**. Their snapshots aggregate the existing normalized hazards, shelters, and assistance tables. At the live verification on 2026-10-05, 44 kelurahan showed baseline WATCH and 223 showed UNKNOWN, with no stale snapshots. These counts change as evidence changes. No population values were invented; the boundary source supplies none.

## Shared phone and government deployment

Root `docker-compose.yml` owns the `dashboard`, `backend`, `postgres`, and `redis` services in one Compose project. The dashboard proxies command, external-data, and navigation calls to `http://backend:8000` on that network. It has no independent API or database. The phone app connects to the same published backend on port 8000. Dashboard health includes a successful call to that backend's `/health` endpoint.

A physical phone must use the host's LAN address, not `localhost` or the Docker hostname `backend`. The local `frontend/.env` now sets `EXPO_PUBLIC_API_BASE_URL=http://192.168.1.11:8000` for this machine's Wi-Fi address. A government browser on the same LAN can use `http://192.168.1.11:8080/`. Restart Expo after changing the client environment. If the host IP changes, update that value. Android emulators can use `http://10.0.2.2:8000`.

```powershell
# From the EvacuAid root: start the shared infrastructure and dashboard
docker compose up -d --build --wait dashboard
# Run the native development client from its existing project
cd frontend
npm start
```

The native app runs on the phone; Compose runs its shared backend and the government web dashboard. No second backend stack is needed. Container-to-backend connectivity is verified here; physical-phone connectivity still depends on its network and native build.

## Import real administrative data

The Jakarta adapter downloads the [official DPMPTSP public village boundary layer](https://gis-dpmptsp.jakarta.go.id/arcgis/rest/services/Hosted/Batas_Administrasi_Kelurahan_DKI_Jakarta/FeatureServer/85), retaining official village codes and names. It derives district, city/regency, and province boundaries by dissolving their constituent villages. The output records source URL, checksum, preparation timestamp, and topology repairs in a provenance sidecar. One self-intersecting source village required `make_valid`; polygon components were retained. Population and boundary reference year remain UNKNOWN because the layer does not supply them.

To prepare and import these boundaries into a fresh database:

```powershell
docker compose exec backend python -m command.jakartaBoundaries --output-dir /tmp/jakarta-regions
docker compose exec backend python -m command.cli import /tmp/jakarta-regions/jakarta-regions.geojson
```

The current workspace already has this import. Do not import it again: duplicate codes are intentionally rejected. Local source and prepared files are retained under ignored `testocando/data/`; `--source-file` permits deterministic regeneration from the captured source without another download. Import refreshes snapshots immediately, and the periodic worker continues refreshing them.

Provide RFC 7946 / EPSG:4326 GeoJSON containing valid Polygon/MultiPolygon boundaries. Each feature must have:

```json
{
  "code": "official-region-code",
  "name": "Official administrative name",
  "administrativeLevel": "VILLAGE",
  "parentCode": "official-district-code",
  "dataMode": "REFERENCE",
  "boundarySource": "Authoritative dataset name and edition",
  "population": null,
  "populationReferenceYear": null,
  "populationSource": null
}
```

Include all four hierarchy levels in one file or import parents first. Levels: `PROVINCE → CITY_REGENCY → DISTRICT → VILLAGE`. A province has no parent. Children must be covered by their parent boundary. Codes are unique; imports are insert-only. Population is optional. A provided population requires a nonnegative integer, reference year, and source; it is never inferred from registrations. No real administrative dataset is bundled.

Place the GeoJSON inside the repository so the backend container can read it, then:

```powershell
docker compose exec backend python -m command.cli import /app/testocando/fixtures/my-regions.geojson
docker compose exec backend python -m command.cli refresh
```

The CLI owns a transaction: invalid hierarchy, boundary, provenance, or duplicate codes roll back the import. Database constraints and a trigger also enforce hierarchy, geometry validity, and population provenance. The stored representative point is inside the polygon, useful for map labels on concave boundaries.

## Map editing and mock mode

The map supports panning, zooming, region selection, and point placement. **Add safe house** switches the cursor to placement mode; click a location, fill its name, optional address/capacity/occupancy/accessibility, and status, then save. **Cancel placement** exits without a write. Blank capacity/occupancy remain UNKNOWN. Check **Status and occupancy verified now** only when those values were verified; otherwise availability remains UNKNOWN. A recorded safe house is not a certification of hazard safety or route feasibility.

Operational safe houses persist in the existing `shelters` table as `SAFE_HOUSE`, with source `GOVERNMENT_DASHBOARD_REPORTED`. Creation and regional projection refresh share one database transaction. Client-generated submission IDs make identical retries replay the same record; changed data with the same ID returns 409. Coordinates, names, numeric bounds, and capacity/occupancy consistency are validated. All saved safe houses appear on the map, including those outside imported region coverage; only intersecting regions gain shelter metrics.

Turn **Mock mode** on to enable **Add mock disaster**. Click the map and choose its type, radius (50?50,000 metres), and mock severity. Purple dashed circles represent the mock footprint. Safe houses added while this toggle is on are mock items too. Mock items persist in this browser's local storage, can be focused or removed individually, and can be cleared together. They never write to hazard/shelter tables, change official region signals, or influence citizen routing. Switching mock mode off hides them. A browser storage failure leaves items available only for the current tab and is reported on screen.

The older **SIMULATION / DEMO** data-environment dropdown remains a separate filter for imported synthetic administrative boundaries. Mock mode overlays a scenario on whichever boundaries are currently displayed; it does not invent exposed-population totals.

## Optional simulation fixture

The fixture has seven synthetic administrative records, including four rectangular village sectors near Jakarta. These are **not official administrative boundaries**. Three village populations are deliberately synthetic; the fourth is UNKNOWN. No disaster events, responders, citizen activity, assistance requests, or shelter occupancy are seeded.

```powershell
docker compose exec backend python -m command.cli import /app/testocando/fixtures/regions.simulation.geojson
```

Choose **SIMULATION / DEMO** in the dashboard. Every imported feature includes simulation provenance. Simulation regions are excluded from the default operational listing and never aggregate live citizens, hazards, or shelters. Import this fixture once; repeated imports correctly reject duplicate codes.

## Implementation inventory

Created:

| Files | Purpose |
| --- | --- |
| `command/__init__.py`, `models.py`, `schemas.py` | Domain tables and explicit public response contracts |
| `command/aggregation.py` | Set-based spatial projection, exposure, assistance, shelter, and priority rules |
| `command/importer.py`, `cli.py`, `jakartaBoundaries.py` | Validated transactional import, manual refresh, and official Jakarta boundary adapter |
| `command/api.py`, `main.py` | Protected command API and periodic projection worker |
| `command/migrations/env.py`, `command/migrations/versions/20261005_07_command_regions.py`, `20261005_08_boundary_precision.py`, `alembic.ini` | Combined Alembic graph, additive command schema, and precision tolerance |
| `mapshit/dashboard/` | React command center (Vite, BoardUI). `npm run dev` proxies to `server.py`; `npm run build` writes the untracked `mapshit/command-center/` that `server.py` serves |
| `command/safeHouses.py` | Validated safe-house creation, replay handling, and public map listing |
| `fixtures/regions.simulation.geojson` | Explicitly synthetic development fixture |
| `tests/conftest.py`, `tests/test_command.py` | Unit, PostGIS, automatic access, privacy, and API tests |
| `start-command-center.ps1`, `docker-compose.test.yml` | Existing-backend startup and disposable test infrastructure |
| `mapshit/Dockerfile`, `mapshit/.dockerignore` | Dashboard image used by the root Compose service; a Node stage builds `dashboard/` |
| `.gitignore`, `README.md` | Ignore local artifacts; implementation and run instructions |

Modified: `mapshit/server.py` adds the command-center page alias and JSON proxy to the existing backend at port 8000. Root `docker-compose.yml` loads the command module, combined migrations into the existing backend service. The existing sandbox's external-data, navigation, and Valhalla proxy routes remain intact.

Migration `20261005_07_command` follows existing merged head `20261005_06`. It creates `command_regions`, its parent/GiST indexes, `command_snapshots`, and a hierarchy-validation trigger. It does not modify citizen tables. Downgrade removes command tables and therefore loses imported command data and snapshots; test it only in an isolated database when those records may be discarded.

Migration `20261005_08_precision` allows a `1e-9` degree tolerance (at most about 0.12 mm) in parent/child coverage checks, accommodating floating-point slivers created by dissolving real boundaries. Stored geometries remain unchanged. Substantive out-of-parent boundaries still fail; both acceptance of microscopic noise and rejection of a metre-scale excursion have regression coverage.

## New endpoints

Command endpoints require no token and return `Cache-Control: no-store`.

| Endpoint | Response |
| --- | --- |
| `GET /v1/command/regions` | Lightweight regional summaries, ordered by operational priority |
| `GET /v1/command/regions/{regionId}` | Detailed aggregate snapshot and administrative lineage |
| `GET /v1/command/regions/{regionId}/hazards` | Normalized intersecting evidence with provenance, validity, and freshness |
| `GET /v1/command/regions/{regionId}/shelters` | Public shelter records and recorded capacity status |
| `GET /v1/command/regions/{regionId}/assistance` | Aggregate counts only; never individual cases |
| `GET /v1/command/safe-houses` | Paginated safe-house map records (`limit`, `offset`) |
| `POST /v1/command/safe-houses` | Save a reported safe house and atomically refresh regional snapshots |

List filters: `administrativeLevel`, `parentRegionId`, `hazardType`, `signalLevel`, `dataMode`. Pagination: `limit` (1–1000; default 200), `offset`. Default data mode is REFERENCE. The browser loads summary pages for the chosen scope. Hazard and shelter overlays load for the selected region; overview requests do not expose individual citizen or household records.

## Projection, exposure, and priority design

PostgreSQL/PostGIS remains canonical. The command module extends the existing backend FastAPI app and shares its models, session factory, lifecycle, and port. There is no separate command API process or operational database. A worker refreshes projections every 60 seconds. Manual import refreshes immediately. An advisory transaction lock prevents concurrent projection writers. Refreshes and snapshot replacement are atomic. HTTP requests read stored JSON projections, not spatial hazard/assistance aggregations. Summary filtering, ordering, and pagination happen in PostgreSQL. Redis is unnecessary for this initial projection.

Spatial operations reuse `hazard_evidence` and `HazardEvidence`, including its active and hard-exclusion semantics. Region intersections use PostGIS. Current official warning/exclusion **polygons** are unioned before calculating:

```text
exposureFraction = clamp(area(region ∩ union(active official hazard polygons)) / area(region), 0, 1)
estimatedExposedPopulation = round(referencePopulation × exposureFraction)
method = AREA_WEIGHTED_ESTIMATE
```

Areas use PostGIS geography in square metres. Baseline susceptibility, community observations, satellite points, expired evidence, future evidence, and simulation evidence do not inflate active population exposure. Unconfirmed critical earthquake damage follows the existing hazard model's restriction. Point evidence still appears in regional evidence but cannot provide an exposed-population estimate. No polygon coverage or missing population yields UNKNOWN rather than zero. No population grid exists in this checkout, so `EXACT_GRID_OVERLAY` is reserved in the contract, not claimed as implemented.

Signals are deterministic: existing official hard evidence → CRITICAL; current official warnings → ELEVATED; baseline susceptibility or fresh observations → WATCH; absence/unusable evidence → UNKNOWN. NORMAL is supported in the contract and legend but not inferred without monitored-safe evidence coverage. Baseline WATCH means susceptibility awareness, not an active disaster declaration.

Static baseline evidence without an observation timestamp remains REFERENCE rather than being hidden as unusable. It never becomes an active warning or contributes to active exposed-population estimates. The signal KPI counts known WATCH/ELEVATED/CRITICAL regions and discloses UNKNOWN coverage; it does not represent a count of active disasters. Zero shelter counts describe available recorded shelters, not proof that a city has no shelters.

Priority: signal (CRITICAL, ELEVATED, WATCH, UNKNOWN, NORMAL), official critical evidence, descending known estimated exposure, descending known active assistance, maximum known shelter occupancy/capacity ratio, uncertainty before fresh evidence on ties, then region code. Missing numeric values rank after known values within the same preceding criteria. These rules have a unit-testable key and equivalent SQL ordering.

Snapshots expire after five minutes or earlier at the next evidence expiry. Stale reads mask operational signal, exposure, assistance, and occupancy as UNKNOWN until a successful refresh. The UI shows projection time and stale state. There is no claim of streaming or continuously verified provider availability.

## Assistance and shelter semantics

Users with location observed in the past 24 hours are assigned to one VILLAGE using `ST_Covers`; code resolves shared-edge ties. Membership rolls up through parents, so leaf counts do not double-count boundary points. The API never returns these individual locations.

`registeredUserCount` is the count of recently located profiles assigned to the region, **not all registrations or reference population**. Assistance metrics count request statuses updated in the last 24 hours. SAFE and EVACUATING are recorded request statuses, not a new independent citizen safety feed. Unknown safety uses each profile's latest recent request status. Profiles with missing/stale locations cannot be assigned and are outside these counts, not presumed safe.

Reported needs combine `user_accessibility` with recent request `support_needs`, counting each user once per category. Categories overlap, so their sum is not a unique-person total. Unrecognized free-form categories are not guessed into a demographic class.

Shelter records retain source and verification timestamps. Occupancy/status verification older than 24 hours becomes UNKNOWN. Null occupancy is never zero. Capacity totals require all contributing capacities to be known; known occupancy is labeled as a subtotal, with a separate unknown-record count. Unknown open-shelter availability makes the regional available count UNKNOWN. Availability describes recorded operational capacity; it is not a guarantee of hazard safety or feasible evacuation routing. Simulation/demo shelter sources are excluded from operational snapshots.

## Privacy guarantees and dashboard components

Public response models explicitly whitelist fields and reject extra keys. Stored projections contain regional counts and public hazard/shelter information. They omit citizen names, phone numbers, user IDs, exact citizen coordinates, buddy identities, household memberships, personal accessibility profiles, messages, and consent fields. Geometry in responses refers only to administrative boundaries, hazard evidence, or public shelters. No operational individual-case endpoint is introduced; existing case permissions are unchanged.

The dashboard provides KPI cards with explicit unknown handling, regional Leaflet polygons, four-level hierarchy and hazard/signal filters, explainable priority ordering, population provenance and exposure method, aggregated assistance/safety statuses, overlapping reported needs, shelter capacity statuses, evidence provenance/freshness, and responsive desktop/mobile layouts. Official active polygons, dashed purple baseline susceptibility, community points, satellite points, and shelters have separate toggles. Regional routes are explicitly UNKNOWN with a disabled toggle because no regional route projection exists.

## Tests and verification

Run the complete backend and command suite in a **new disposable test project**:

```powershell
cd D:\Hackathons\EvacuAid
docker compose -p evacuaid-command-verify -f testocando/docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from tests
```

This project uses tmpfs PostGIS storage and an isolated `_test` database. It never attaches the normal EvacuAid database volume. Existing backend tests write generated data into a separate writable tmpfs path. Starting a stopped test project initializes fresh temporary state; do not use this configuration for persistent data.

Existing frontend verification:

```powershell
cd D:\Hackathons\EvacuAid\frontend
npm ci --no-audit --no-fund
npm test -- --silent
npm run typecheck
```

Coverage includes hierarchy and database constraints, PostGIS intersection and union, exposure fraction and population estimate, source/year validation, missing/expired data, assistance and overlapping profile/request needs, shelter aggregation, deterministic priority, automatic access and API privacy, simulation isolation, baseline-versus-active evidence, latest-request safety, and stale shelter handling. Browser verification artifacts are saved locally under ignored `testocando/output/playwright/`.

Verified on 2026-10-05:

- Complete backend + command suite after real boundary integration: **159 passed** (139 existing, 20 command tests).
- Command migration upgrade → downgrade to `20261005_06` → upgrade: passed in the disposable database; command suite afterward: **15 passed**.
- Existing frontend: **33 suites, 177 tests passed**; TypeScript `tsc --noEmit`: passed.
- Real browser at **1440 × 1000** and **390 × 844**: connected to the simulation API, selected polygons and priority rows, checked missing population, hierarchy/signal filters and region layer toggles. No horizontal page overflow; final browser console: zero errors/warnings.
- Real backend/browser verification: **267 official kelurahan**, 44 baseline WATCH and 223 UNKNOWN, zero stale snapshots; selected real regions, filtered WATCH, switched hierarchy, and checked both desktop/mobile layouts. No horizontal overflow or browser console errors/warnings.
- Compose configuration validation, Python compilation, JavaScript syntax, and `git diff --check`: passed.
- Existing Python 3.14 / pytest-asyncio and Alembic deprecation warnings remain; no production provider probes or operational dataset coverage are claimed.

Verified on 2026-10-08 after map-editing changes:

- Complete backend + command suite: **162 passed** (139 existing, 23 command tests).
- Command reads load without credentials. Live safe-house POST through the dashboard proxy returned **201**, persisted its record, and refreshed the containing region's shelter snapshot. The temporary verification record was subsequently removed.
- Browser checks cover automatic loading, disaster placement, radius/severity, mock safe-house placement, occupancy validation, local-storage reload, individual removal/reset, mock/live isolation, and operational submission/error handling. Desktop and mobile layouts have no horizontal overflow.
- Command saves allow a bounded 120-second upstream request because a full projection refresh exceeded the older 15-second proxy timeout in live verification. Timeouts return JSON 504 rather than closing the connection; identical submission IDs replay the saved record. Saves wait for the projection writer instead of silently skipping refresh.
- One existing buddy-pilot concurrent-acceptance test failed on the initial cold-start run; subsequent complete runs passed. Existing Python/pytest/Alembic deprecation warnings remain.

Root Compose integration verified on 2026-10-08:

- Dashboard image builds from `testocando/mapshit/Dockerfile`; `dashboard`, `backend`, PostgreSQL, and Redis are healthy in the root Compose project.
- The standalone host map process has been stopped; container port 8080 serves the dashboard at `/` and `/command-center/`.
- Container dashboard health, static assets, region/safe-house reads, and POST forwarding reach the shared backend. All 267 village IDs match the direct backend response.
- Focused command/PostGIS/proxy suite: **24 passed**. Browser verification confirms automatic loading and mock tools from the container page. Physical-phone use is configured but has not been tested on a device.

## Remaining limitations

- Official Jakarta boundaries have been downloaded and imported locally, with source provenance; they are not bundled in Git. Population and boundary reference year remain UNKNOWN. Verify source suitability and add authoritative population data before population-based operational use.
- No spatial population grid, authoritative responder inventory, persisted regional route projection, independent safety check-in feed, or shelter inventory completeness contract exists. Corresponding unsupported metrics remain UNKNOWN.
- Simulation fixtures provide synthetic boundaries and reference populations only. Live activity is deliberately excluded.
- Command reads and safe-house creation are intentionally unauthenticated. Access is available to anyone who can reach this backend.
- The projection refresh currently handles the imported dataset in one transaction. Province-wide or nationwide deployments need measured refresh batching and map boundary simplification; no unmeasured nationwide performance claim is made.
- The command module shares the existing citizen OpenAPI routes, database, and application lifecycle.
- No new live provider integration is added. Source labels describe stored normalized evidence, not a successful live provider probe.
- Leaflet, map tiles, and fonts require network access. The citizen application remains the existing Expo/native app; the command-center web page follows the already-progressed `testocando` Leaflet sandbox.
