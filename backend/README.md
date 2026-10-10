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
docker compose run --rm --no-deps -e DATABASE_URL=postgresql+asyncpg://evacuaid:change-me@postgres:5432/evacuaid_hazards_test backend python -m pytest -q
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

Buddy endpoints use `/v1/buddy`; `/v1/buddy-pilot` still answers for older app builds.

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

External notification delivery remains future work. Shelters, pedestrian navigation, normalized hazard ingestion and five hazard evaluators are implemented. Context returns `NOT_REQUESTED` only where there is no active assistance request and `NOT_REQUIRED` navigation unless the decision service requires evacuation.

## Shelters and navigation

Shelters are persistent PostGIS geography points with source provenance. Production imports must use verified shelter data; test fixtures use `source=TEST_FIXTURE` and are not official destinations. Nearby discovery uses `ST_DWithin` and `ST_Distance` rather than loading all shelters into Python.

Shelters are rejected when closed, full, capacity-exhausted, explicitly not wheelchair-accessible for a mobility-limited user, or inside an applicable official critical geometry. Unknown occupancy and accessibility remain unknown in the response; they are never treated as available or compatible.

`POST /v1/navigation/routes` accepts `userId` and optional `destinationShelterId`. The backend jointly evaluates suitable shelters and Valhalla pedestrian candidates against persisted hazard evidence and accessibility. A nearby report makes the route `POTENTIALLY_EXPOSED`; it is supporting evidence, not a flood polygon or authoritative unsafe declaration.

OpenStreetMap supplies road data. Valhalla performs road-graph routing and geometry generation. EvacuAid selects shelters and evaluates accessibility and hazard evidence. EvacuAid requests bounded alternatives and, when all ordinary candidates are infeasible, attempts waypoint detours. Complete returned geometries are re-evaluated before selection.

Valhalla is an optional Compose profile because routing tiles must be prepared once from a bounded OSM extract. It uses a persistent `valhalla_tiles` volume and does not download the planet or rebuild tiles on normal backend startup. With the provided Java extract at `backend/data/valhallaData/java-260920.osm.pbf`, prepare tiles and start routing with:

```powershell
docker run --rm --cpus 1 -v evacuaid_valhalla_tiles:/data/valhalla -v "${PWD}/backend/data/valhallaData:/input:ro" --entrypoint valhalla_build_tiles ghcr.io/interline-io/valhalla-docker/valhalla:latest -j 1 -c /build/valhalla.json /input/java-260920.osm.pbf
docker compose --profile routing up -d valhalla
```

Until tiles are prepared, `/health` reports Valhalla unavailable and the backend as degraded; profile, context, risk, buddy, and assistance APIs remain available. Navigation then truthfully returns `UNAVAILABLE` when invoked.


## Five-hazard evidence pipeline

External providers -> normalized `HazardEvidence` -> PostGIS -> shared metric geometry calculations -> hazard-specific evaluators -> hard feasibility -> lexicographic ranking -> explanation.

`20261002_05` extends the existing `20260924_04` head with `hazard_evidence`. It stores local geometries in EPSG:4326, provenance, nullable severity/confidence, observed time and validity. Unique `(source, source_id)` prevents duplicate ingestion. Geometry and geography GIST indexes support spatial filters; temporal and hazard/source indexes support active evidence access. No national raster is stored in a database row.

| Source | Evidence authority | Preparation and freshness |
| --- | --- | --- |
| [BNPB InaRISK](https://gis.bnpb.go.id/server/rest/services/inarisk) | OFFICIAL baseline susceptibility | Prepare bounded structured feature queries or raw ImageServer TIFF assets independently of routing. Default health freshness 30 days. |
| [BMKG earthquake JSON](https://data.bmkg.go.id/gempabumi/) | OFFICIAL event observations | Five-minute refresh; records expire after two refresh periods or the event-age limit, whichever comes first. Attribution is preserved. |
| [BMKG CAP nowcast](https://data.bmkg.go.id/peringatan-dini-cuaca/) | OFFICIAL active extreme-weather warnings | Five-minute RSS/detail refresh; preserve effective/expires; cancelled, test and expired messages are inactive. CAP severity/certainty remain source categories, not invented numeric probabilities. |
| [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/api/area/) | SATELLITE_OBSERVATION point hotspots | Environment MAP_KEY, bounded configured area, 30-minute refresh, maximum observation age. VIIRS quality mapping is experimental. |
| [PetaBencana](https://docs.petabencana.id/) | COMMUNITY supporting point observations | Five-minute normalized refresh and observation-age limit. The existing snapshot fallback is used only while fresh. |
| [Copernicus-compatible prepared DEM](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/DEM.html) | Source-labelled elevation asset | Local georeferenced one-band raster in meters; source and vertical datum must be declared. Raster reads run outside the async event loop. No elevation is invented when missing. |

The single optional `hazard-worker` Compose service polls live sources. Each source has a central TTL and a persisted next-attempt timestamp, including failed refreshes. Successful full live-source snapshots atomically replace that source's evidence. Failed refreshes retain the last evidence only until each record's own expiry. PostgreSQL is canonical; Redis stores best-effort provider status with TTL. Routing does not contact BMKG, FIRMS, InaRISK or DEM APIs. It loads indexed spatial evidence around the origin and then around the full batch of candidate geometries, including detours outside the initial search area.

The adapters inspect ArcGIS metadata: only a queryable Feature Layer uses `/query`; a MapServer raster is not a polygon layer. ImageServer `/exportImage` retrieves a bounded raw TIFF, not a rendered screenshot. Raster polygonization uses an explicitly chosen source-value threshold and marks it EXPERIMENTAL; it creates baseline geometries, never active critical zones. GeoJSON imports accept an optional severity field only when the source actually defines a normalized 0..1 severity value. Otherwise severity and confidence remain null. Static imports atomically replace their ingestion scope while preserving other prepared areas. The default scope combines hazard, source URL and asset filename; use --scope for a stable explicit area identifier. Reimporting identical records is idempotent and updating a threshold removes the old scoped extraction.

## Calculations and hazard policies

Lengths and distances use a local WGS84 azimuthal equidistant projection in meters. PostGIS queries use geography. Polygon/MultiPolygon holes are preserved; invalid polygon repair uses Shapely `make_valid` conservatively. Unsupported/invalid critical geometry fails feasibility. Empty or invalid routes are unavailable. Self-intersecting route geometries are rejected because ambiguous repeated traversal would invalidate first-exit calculations. This implementation targets bounded Indonesian evacuation routes, not antimeridian/global routing.

For each hazard, exact line/polygon exposure is `I = length(route intersection hazard union) / length(route)`. Proximity is a bounded aggregate of length-weighted `exp(-segmentDistance / sigma)` over route samples. Samples preserve the original bends and default to 50 m, capped at 2,000. For source-supported numeric severity/confidence, `severityExposure` integrates their product over intersection length; unknown values remain null. Missing hazards contribute no measured exposure but increase uncertainty; this does not assert zero risk or safety.

Five named evaluators share these calculations:

- Flood: `alpha * I + beta * B + gamma * C`, with bounded community contribution `C <= 0.25`. Missing community quality uses the existing experimental community policy parameters, never fills source severity/confidence. Nearby reports produce `POTENTIALLY_EXPOSED` and cannot create a closure.
- Earthquake: baseline intersection plus event proximity context. Reasons distinguish nearby event, baseline exposure, unknown damage, and confirmed infrastructure closure. Epicenter observations never close roads. Earthquake critical evidence additionally requires explicit confirmed damage; official confirmed closures are hard exclusions.
- Tsunami: `alpha * I + beta * B + gamma * (1 - min(1, max(0, z_end-z_start)/G_ref))` when endpoint elevations exist. When elevation is missing, measured elevation/gain/penalty remain null and an explicitly separate conservative `unknownElevationPenalty=gamma` policy bound is used with `ELEVATION_DATA_UNKNOWN`, so missing DEM cannot masquerade as maximum elevation gain; `G_ref=30 m` is a normalization parameter, not a safe-height threshold. For origins inside the union of official critical tsunami zones, compute first-exit distance, approximate exit time proportional to route duration, in-zone fraction and re-entry. A route must exit, end outside and never re-enter. Among feasible escape routes, earlier exit distance is the first ranking criterion. Confirmed closures and other hazards still apply.
- Wildfire: satellite hotspot risk is `1 - product(1 - q_j * exp(-d_j/sigma_fire))`, clamped to 0..1. Baseline exposure also contributes. Raw satellite confidence categories remain in provenance; categorical source confidence stays null in the normalized model and numeric q is stored separately as an experimental metadata quality weight. Unknown q uses FIRMS_UNKNOWN_QUALITY. No hotspot polygon or fire-spread forecast is generated.
- Landslide: route-length-weighted susceptibility times quality when the source supplies both; otherwise report geometric baseline exposure and retain unknown numeric severity. Active rain polygons contribute warning context/reasons. DEM supplies actual relative elevation and longitudinal route-grade samples when available; this is not a full terrain-gradient or landslide forecast model, and grade does not modify hazard severity.

`HAZARD_<TYPE>_{ALPHA,BETA,GAMMA,WEIGHT,SIGMA_METERS}` are centralized experimental policy parameters. They are not scientifically validated. Exposure/proximity weights across hazards are configurable; explanation fields show the actual per-hazard calculations used.

## Hard avoidance, detours and ranking

An active OFFICIAL `CRITICAL_HAZARD` or `CONFIRMED_CLOSURE` geometry rejects every intersecting route and covered shelter. Critical points/lines receive the existing configurable metric buffer. Boundary touches are conservatively excluded. Baselines, weather warnings without an explicit critical designation, satellite observations and community reports are soft evidence. Hard exclusions and active warnings require explicit expiry. Mobility-required routes with explicit traversability impossibility are also rejected; missing segment accessibility remains UNKNOWN and receives the existing separate accessibility penalty.

Selection:

1. Filter shelters by status, capacity, accessibility and hard hazard location.
2. Request up to `ROUTE_MAX_ALTERNATIVES=3` ordinary pedestrian routes per shelter; deduplicate within 5 m metric Hausdorff distance.
3. Load hazard evidence for the complete candidate batch and reject hard intersections, invalid geometry and hard operational limits.
4. If no ordinary candidate is feasible, derive at most `DETOUR_MAX_WAYPOINT_CANDIDATES=8` waypoint sets around the metric buffered obstacle envelope. Each set has two waypoints offset on either side of the origin/destination direction, with increasing clearance. Every waypoint must lie outside all hazards buffered by `DETOUR_CLEARANCE_METERS=100`. These are boundary-envelope offsets, not arbitrary polygon vertices. Snap them through Valhalla, combine every returned leg, load evidence for the full detour batch, deduplicate and re-evaluate. Snapping does not waive exclusions. Routes whose endpoints are farther than ROUTE_ENDPOINT_TOLERANCE_METERS=100 from the requested endpoints are rejected, and hard hazards along endpoint connectors cannot be silently skipped.
5. If no feasible candidate remains, return `UNAVAILABLE` / `NO_FEASIBLE_ROUTE`, with no recommended route.
6. Rank feasible candidates lexicographically by tsunami first-exit distance when applicable, multi-hazard exposure, proximity, separate accessibility penalty, uncertainty, travel time, then deterministic route ID. Exposure/accessibility/uncertainty use configurable tolerance bins; tsunami distance uses 10 m bins. Weighted normalized `J = .45 R + .20 B + .15 A + .10 U + .10 T` remains diagnostic only.

The ratio/seconds detour preference marks `PREFERRED_DETOUR_BOUND_EXCEEDED` in navigation without overriding safety ranking. The separate hard operational maximum `ROUTE_OPERATIONAL_MAX_SECONDS=14400` rejects overlong routes, including safe detours. `applyRanking` retains its previous strict preference option for existing analytical callers. Unsafe routes never become fallbacks because a detour is too long. These bounds are operational policy, not certified evacuation reachability.

The deployed local Valhalla 3.9.0 was checked with `/status` and actual pedestrian alternatives. The implementation uses [documented alternatives and waypoint routing](https://valhalla.github.io/valhalla/api/route/api-reference/), with complete polyline6 leg decoding. Native dynamic polygon exclusion is not assumed; the provider-independent detour fallback is always available. Waypoint attempts are bounded and may miss a feasible route on a complex road network. `UNAVAILABLE` is preferable to recommending a known excluded route.

## API extensions and decisions

Existing request fields and response fields remain. Navigation candidates now add `hazards`, `reasonCodes` (alongside existing `reasons`), feasibility and existing weighted-score diagnostics. `NavigationEvaluation.hazards` describes the selected route; preview responses now expose `evaluatedCandidates`, including rejected ones. `EXPOSED` is an additional hazard status for measured baseline exposure. It is not an active-disaster declaration. `UNKNOWN` remains the absence of adequate evidence, even when an ordinary route is geometrically feasible.

Stable codes include `AUTHORITATIVE_HAZARD_INTERSECTION`, `ROUTE_REJECTED_CRITICAL_HAZARD`, `HAZARD_DETOUR_GENERATED`, `NO_FEASIBLE_ROUTE`, `BASELINE_HAZARD_EXPOSURE`, `ACTIVE_WARNING_INTERSECTION`, `COMMUNITY_REPORT_NEAR_ROUTE`, earthquake event/baseline/damage/closure codes, tsunami exposure/exit/re-entry codes, `ELEVATION_DATA_UNKNOWN`, `FIRMS_HOTSPOT_NEAR_ROUTE`, and `LANDSLIDE_SUSCEPTIBILITY_EXPOSURE`.

`/v1/context` delegates to services. A persisted active, spatially applicable OFFICIAL warning must explicitly provide `metadata.officialStatus=AWAS` or `SIAGA` to use the existing decision semantics; no severity category or CAP instruction text is guessed into this status. CAP severe weather, baseline InaRISK, earthquake events and PetaBencana alone do not trigger EVACUATE. Navigation remains NOT_REQUIRED unless the decision service requires evacuation. Required navigation returns READY or UNAVAILABLE; PENDING is retained in the contract.

`/health.sources` adds INARISK, BMKG_EARTHQUAKE, BMKG_CAP, FIRMS and DEM. Provider states distinguish available, stale, degraded, unconfigured and unknown. Optional external failures make health degraded while core database availability is reported separately; they do not crash the app. Health uses persisted hazard refresh status instead of probing every hazard provider. Existing BMKG weather/PetaBencana health checks remain.

Logs record provider refresh result, active evidence counts, candidate counts, hard rejections, detour attempts/results and route-evaluation duration. They do not contain precise user coordinates or MAP_KEY; HTTP client logs redact the FIRMS key. Synthetic fixtures live only in the isolated test database with SYNTHETIC/TEST provenance.

## Prepare data and run the complete stack

From `D:\Hackathons\EvacuAid`, create `.env` only if it does not already exist; set credentials and provider policy through that environment. `.env.example` lists every new setting.

```powershell
if (-not (Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
docker compose --profile routing --profile hazards up --build -d
docker compose exec backend alembic current
docker compose exec backend python -m app.hazardCli refresh
```

The existing populated `evacuaid_valhalla_tiles` volume is used. On a new machine, first build tiles from a bounded verified OSM extract using the earlier command. API: `http://localhost:8000`; docs: `http://localhost:8000/docs`. Configure `FIRMS_MAP_KEY` to enable FIRMS. No API key is committed or added to `.env` by this implementation. Run exactly one hazard worker to respect BMKG's documented shared 60 requests/minute/IP limit.

Prepare a local InaRISK area, independently from route requests. The threshold below is an explicit example experimental index policy, not an official active-hazard cutoff. Review source metadata and choose the policy before production use.

```powershell
$hazardNames = @{
  FLOOD = 'layer_bahaya_banjir'
  EARTHQUAKE = 'layer_bahaya_gempabumi'
  TSUNAMI = 'layer_bahaya_tsunami'
  WILDFIRE = 'layer_bahaya_kebakaran_hutan_dan_lahan'
  LANDSLIDE = 'layer_bahaya_tanah_longsor'
}
foreach ($hazardType in $hazardNames.Keys) {
  $assetPath = '/app/data/processed/hazards/' + $hazardType.ToLower() + '.tif'
  $sourceUrl = 'https://gis.bnpb.go.id/server/rest/services/inarisk/' + $hazardNames[$hazardType] + '/ImageServer'
  docker compose exec backend python -m app.hazardCli prepare-inarisk --hazard $hazardType --bbox '106.6,-6.5,107.1,-6.0' --output $assetPath --service-url $sourceUrl
  if ($LASTEXITCODE -ne 0) { throw "Preparation failed for $hazardType" }
  docker compose exec backend python -m app.hazardCli import-inarisk --hazard $hazardType --path $assetPath --source-url $sourceUrl --minimum 0.6
  if ($LASTEXITCODE -ne 0) { throw "Import failed for $hazardType" }
}
```

Queryable feature layers can use `--service-url <.../MapServer/layerId>` and a `.geojson` output instead. Supply `--severity-field` only for a defensible normalized severity field. This preparation intentionally restricts requests to at most two degrees per axis and 1024x1024 raster outputs; source raster resolution remains in the manifest, and resampling does not create new scientific detail.

For DEM, obtain a licensed georeferenced local Copernicus DEM tile independently, preserving its download provenance. Place it at `backend/data/raw/dem/copernicus.tif`. The code supports prepared assets rather than silently fetching or claiming remote Copernicus data. Prepare a COG with explicit provenance:

```powershell
docker compose exec backend python -m app.hazardCli prepare-dem --path /app/data/raw/dem/copernicus.tif --output /app/data/processed/dem/copernicus.tif --source COPERNICUS_DEM --source-url https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model --vertical-datum EGM2008
```

Set `DEM_ASSET_PATH=/app/data/processed/dem/copernicus.tif`, `DEM_SOURCE=COPERNICUS_DEM`, and `DEM_VERTICAL_DATUM=EGM2008` in deployment configuration only after verifying that actual asset's units and datum. Then:

```powershell
docker compose up -d --force-recreate backend
docker compose exec backend python -m app.hazardCli inspect-dem --latitude -6.2 --longitude 106.8
```

The generic official-evidence import is an operator command, not an unauthenticated HTTP endpoint. Supply independently verified normalized records with source URL, attribution, stable source IDs and explicit validity; use it for authoritative critical areas or confirmed closures when such a source exists:

```powershell
docker compose exec backend python -m app.hazardCli import-evidence --path /app/data/processed/verified-official-evidence.json
```

Importing JSON cannot prove the declared authority; operators must verify provenance. Expired hard records stop applying automatically. Do not repurpose baseline susceptibility or citizen reports as critical evidence.

Tests require a dedicated `_test` database and refuse to truncate application data:

```powershell
docker compose exec -T postgres createdb -U evacuaid evacuaid_hazards_test
docker compose run --rm --no-deps -e DATABASE_URL=postgresql+asyncpg://evacuaid:change-me@postgres:5432/evacuaid_hazards_test backend alembic upgrade head
docker compose run --rm --no-deps -e DATABASE_URL=postgresql+asyncpg://evacuaid:change-me@postgres:5432/evacuaid_hazards_test backend python -m pytest -q
```

Run `createdb` only once. Use your configured database user/password if changed. The new migration's downgrade drops only the new hazard table and loses its evidence; application tables from earlier revisions are preserved.

## Limits and interpretation

EvacuAid does not predict earthquakes. Epicenter proximity does not prove road damage. FIRMS hotspots are not exact wildfire boundaries. InaRISK susceptibility does not prove an active disaster. PetaBencana reports are community evidence. Missing evidence does not prove safety. Elevation does not establish universal tsunami safety. Routing recommendations depend on available/current evidence.

No fire-spread model, universal tsunami safe elevation, complete live infrastructure-damage feed or complete route-segment accessibility inventory is available. CAP is extreme-weather context, not automatically a flood or landslide perimeter. Remote Sentinel Hub OAuth ingestion is not implemented; the elevation boundary uses prepared, source-labelled DEM assets. FIRMS requires an operator key. Spatial coverage and source age matter; configured extraction areas do not imply national coverage. Tsunami first-exit time is an estimate based on total route duration, not segment-specific travel times. Experimental policy scores and safety clearances need local validation. Detour generation is a bounded search and cannot guarantee finding every feasible route.
