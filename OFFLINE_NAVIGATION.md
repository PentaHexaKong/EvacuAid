# Downloadable regional evacuation packages

## Implementation status

Phase 1 code is implemented across the backend and phone app. Actual Android/iOS installation, GPS and offline map behavior remain unverified on-device.

**Phase 2 is BLOCKED. No native offline recalculation is implemented or demonstrated.** See [OFFLINE_FEASIBILITY.md](OFFLINE_FEASIBILITY.md) for the build evidence and prerequisites.

The app has a Downloaded Regions screen, reached from Profile or from the account entry screen without signing in. This latter path allows public downloaded reference data to remain accessible when account restoration cannot contact the server.

## Public API

| Method | Path | Behavior |
| --- | --- | --- |
| GET | /v1/offline/regions?limit=500&offset=0 | Paginated reference-region discovery with published manifests |
| GET | /v1/offline/packages/{regionId}/manifest | Latest signed manifest, or 404 if not built |
| GET | /v1/offline/packages/{regionId}/download | Streamed ZIP for external consumers; supports byte ranges |
| GET | /v1/offline/packages/{regionId}/assets/{sha256}?packageId={packageId} | Immutable, version-bound, streamed asset; supports byte ranges |
| GET | /v1/offline/packages/{regionId}/build-status | Persisted build jobs; ADMIN authentication required |

The app downloads verified files individually; it does not unpack the ZIP. File-set installation rejects traversal paths and duplicate paths before writing.

The APIs export public reference data. Package creation is controlled by the trusted operator CLI, not a public graph-build endpoint.

## Package format

Schema version 1 is an application-private directory:

~~~text
manifest.json
map/
  streets.geojson
  boundary.geojson
  coverage.geojson
routing/
  0/.../*.gph
  1/.../*.gph
  2/.../*.gph
hazards/
  evidence.json
shelters/
  shelters.json
cached-routes/
  routes.json
~~~

Manifest fields include packageId, schemaVersion, regionId, regionName, bbox, generatedAt, expiresAt, mapDataVersion, routingEngine, routingEngineVersion, graphVersion, graphCompatibility, hazardSnapshotAt, hazardEvidenceValidUntil, packageSizeBytes, assets, contentChecksums, packageSignature, sourceProvenance, capabilities and warnings.

- packageId identifies the immutable package revision.
- mapDataVersion and graphVersion are content digests of their asset inventories.
- packageSizeBytes is the sum of file payload bytes. It excludes the manifest and ZIP container overhead, and is not a promise about installed disk usage.
- Each asset has a safe relative path, kind, SHA-256 and exact byte size.
- The manifest is signed using Ed25519 over RFC 8785 canonical JSON, excluding only packageSignature.
- The signing key is separate from the account JWT secret.
- The app verifies against a public key pinned at build time, never a key downloaded from the server.
- Expired packages cannot be newly installed. Previously installed expired packages remain available as historical map/shelter snapshots with an expiry notice.

### Freshness

These times have different meanings:

| Field | Meaning |
| --- | --- |
| generatedAt | Package assembly time |
| sourceProvenance.mapDatasetGeneratedAt | Upstream map dataset time, when known |
| sourceProvenance.graphDatasetGeneratedAt | Graph dataset time, when known |
| sourceProvenance.staticDatasetGeneratedAt | Operator-provided static asset snapshot time, possibly null |
| hazardSnapshotAt | Database hazard snapshot export time |
| hazards[].observedAt | Individual observation time |
| hazards[].validFrom / validUntil | Individual source validity |
| hazardEvidenceValidUntil | Earliest expiry only when all exported records have an explicit expiry; otherwise null/unknown |
| expiresAt | Package distribution lifetime |

Missing evidence expiry is UNKNOWN. A current downloaded validity interval does not establish real-world safety.

## Build pipeline and privacy

The modular backend remains a single application. A separate worker process runs package jobs using the same database and source graph.

Build statuses are persisted as atomic JSON records under the package directory: QUEUED, BUILDING, READY or FAILED. A single OS-level worker lock prevents simultaneous builders in that directory. After worker restart, interrupted BUILDING jobs are retried.

The builder reads a repeatable-read database snapshot, resolves reference region geometry and applies a configurable metre buffer. Static asset coverage must include that buffered bbox.

It reuses Valhalla 3.9.0 tiles intersecting the buffered bbox at all three road hierarchy levels. The tile hierarchy addressing and version field were inspected against the [Valhalla 3.9.0 source](https://github.com/valhalla/valhalla/blob/3.9.0/src/baldr/tilehierarchy.cc). Tile selection does not prove native-reader compatibility, cross-boundary connectivity or a feasible pedestrian route.

Map data is clipped from a public GeoJSON street source. Static graph files are hashed and stored as immutable objects; hazard changes do not rebuild the graph. Download clients reuse verified unchanged objects.

Public shelter exports retain known status, occupancy, accessibility, entrance coordinates and observation/verification times.

Hazard exports retain authority, severity, confidence, observation/validity times, geometry, source identity and confirmedDamage where present. Community/citizen observations are excluded to avoid distributing potentially private exact locations. Simulation evidence is excluded. URL credentials, query strings and fragments are stripped.

The generator does not read user, credential, buddy or citizen route-log tables. Free-form map metadata is stripped.

There is currently no separate public evacuation-route cache in the repository. The package includes an empty cached-routes inventory and declares cachedRoutes=false; citizen route logs are not used as a replacement. The offline map adapter can render supplied cached route geometry, but this build pipeline does not create or claim cached public routes.

## Configure and build a package

These PowerShell commands run from the EvacuAid root. Keep the existing local database and routing services running.

### 1. Build the code

~~~powershell
cd D:\Hackathons\EvacuAid
docker compose build backend offline-worker
docker compose up -d backend
~~~

On a VPS, use your production Compose override as well.

### 2. Generate the dedicated signing key

~~~powershell
New-Item -ItemType Directory -Force .secrets | Out-Null

docker compose run --rm --no-deps -v "${PWD}/.secrets:/keys" backend python -m app.offlineCli keygen --private /keys/offline-signing.pem
~~~

The command prints only the public key. The private key is stored in the ignored .secrets directory and refuses to overwrite an existing key.

Pin the returned public key in frontend/.env:

~~~dotenv
EXPO_PUBLIC_OFFLINE_KEY_ID=offline-v1
EXPO_PUBLIC_OFFLINE_PUBLIC_KEY=PASTE_THE_64_CHARACTER_PUBLIC_KEY_HEX
~~~

Also set the backend's OFFLINE_SIGNING_KEY_ID to the same key ID. Never commit the private key or distribute it to phones.

### 3. Identify a region

~~~powershell
Invoke-RestMethod http://127.0.0.1:8000/v1/offline/regions?limit=500
~~~

Use a reference-region UUID from the response. Its administrative boundary must already exist in the shared database.

### 4. Prepare a public street-map source

Create the directory:

~~~powershell
New-Item -ItemType Directory -Force backend/data/offline-assets | Out-Null
~~~

The following example bbox covers Cipete Selatan and its default 1,000 m buffer. Use the appropriate bbox for other regions.

~~~powershell
docker compose run --rm --no-deps backend python -m app.offlineCli prepare-map --bbox 106.78,-6.29,106.83,-6.24 --output /app/data/offline-assets/cipete-streets-v1.geojson
~~~

This is an explicit operator download from Overpass, not an automatic phone download. It creates GeoJSON and a provenance sidecar, with bounded response size and feature count. Review the map coverage and license before publishing.

Alternatively, supply a licensed public street GeoJSON FeatureCollection within the size limits. Native graph bytes are never derived from this display file.

### 5. Configure the static asset catalog

~~~powershell
Copy-Item backend/offline-assets.example.json backend/data/offline-assets/catalog.json
~~~

Edit catalog.json:

- Replace REPLACE_WITH_REGION_UUID with the selected UUID.
- Use the correct buffered coverage bbox and GeoJSON path.
- Keep graphDirectory=/app/offline-graph for the root worker's existing Valhalla volume.
- Record provenance and dataset timestamps only when known. Preserve null for unknown graph dataset generation time.
- Copy mapDatasetGeneratedAt from the prepare-map provenance sidecar.

For a different existing source graph, its tiles must have the supported 3.9.0 header. A version check is not native compatibility verification.

### 6. Enqueue and run the background build

~~~powershell
docker compose run --rm --no-deps backend python -m app.offlineCli enqueue YOUR_REGION_UUID

docker compose --profile offline up -d offline-worker
docker compose logs --tail=100 offline-worker
~~~

For a single worker pass:

~~~powershell
docker compose --profile offline run --rm offline-worker python -m app.offlineCli worker --once
~~~

Stop the persistent worker first if using the single-pass command against the same package directory; the single-worker lock intentionally rejects concurrent workers.

Build output is stored under backend/data/offline-packages. The latest package pointer is published only after assets, manifest and ZIP are complete. A failed update retains the previously published package.

### 7. Download in the phone app

Rebuild the development client for the new native storage/connectivity dependencies:

~~~powershell
cd frontend
npm install
npm run android
~~~

Android Studio/SDK and an emulator or device are required. On macOS with Xcode:

~~~bash
cd frontend
npm install
npm run ios
~~~

Then start the bundler:

~~~powershell
npm start -- --clear
~~~

Open Profile → Downloaded regions, or use Downloaded regions on the account screen. Select a published region and download it. Metered connections require explicit consent.

## Device installation behavior

- Assets are streamed to persistent application-private files.
- Downloads use explicit 4 MiB HTTP ranges; completed bytes survive interruptions. A partially copied range is recovered through the partial file's byte offset and final checksum.
- Graph hashes are computed incrementally using 64 KiB native file reads. The whole graph is never loaded into JavaScript memory.
- Installation checks signatures, supported versions, safe paths, sizes, checksums and free space.
- Shared content-addressed objects avoid repeated network graph downloads on hazard-only updates.
- Staged files are copied into an immutable version directory.
- An append-only commit record is published via native rename after all files verify. There is no delete-then-replace pointer gap.
- A previous valid installed version is retained for explicit rollback.
- If the current manifest becomes corrupt, discovery can restore the preceding package after verifying its signature and complete asset inventory.
- Delete removes the region and garbage-collects unreferenced shared objects when no installation is active.
- Storage reporting counts actual stored files, including retained versions and partial downloads.
- Small displayed assets are rechecked on map opening; graph integrity is checked during installation and rollback.
- Update discovery runs when connectivity returns or the app becomes active. It does not automatically download updates or replace an already-open map snapshot.

Per-asset downloads reuse native transfer primitives. Actual background lifecycle, process-death recovery and native rename behavior still require device testing.

## Offline map and routing behavior

The offline screen uses a dedicated local GeoJSON/SVG adapter with pan and accessible zoom controls. Existing online Mapbox/react-native-maps components remain unchanged.

This adapter renders downloaded streets, region and package boundaries, hazard geometry, shelter markers and GPS position without remote tile or style URLs. It provides a simpler street/geometry view, not the existing online basemap's terrain or building styling. Shelter names/status and map attribution have text alternatives.

It does not use MBTiles/PMTiles or assume an online URL works offline. Display data is limited to 10,000 map features and 16 MiB per displayed asset.

The online route API transport now adds routing mode and uncertainty metadata. Actual network failures can select the conservative local response; HTTP authentication/policy failures do not bypass the server. Explicit offline-only requests do not invoke online routing.

The current online response does not expose an aggregate evidence-expiry timestamp, so the transport reports evidence freshness as UNKNOWN and includes EVIDENCE_FRESHNESS_NOT_EXPOSED rather than inventing a freshness claim. Existing backend route contracts remain compatible.

The local engine facade always reports ROUTING_UNAVAILABLE because the native spike is blocked. It never returns cached geometry as a new route. Local hazard feasibility, avoidance and tsunami policy are not implemented. The server's existing hard hazard policies remain unchanged.

## Tests and validation

Run the backend/command suite against the dedicated temporary test database:

~~~powershell
docker compose -p evacuaid-auth-test -f testocando/docker-compose.test.yml up -d --wait postgres
docker compose -p evacuaid-auth-test -f testocando/docker-compose.test.yml run --rm tests sh -c 'alembic -c ../testocando/alembic.ini upgrade head && pytest -p no:cacheprovider tests ../testocando/tests -q'
~~~

Run phone checks:

~~~powershell
cd frontend
npm run typecheck
npm test -- --silent
npm run export:native
~~~

New tests cover manifest signatures/tampering, Python-to-JavaScript signing compatibility, unsafe paths, checksum/size failures, graph header rejection, immutable static graph reuse, publication failure recovery, persisted worker failure, ranged HTTP responses, public snapshot privacy, metered consent, insufficient storage, interrupted transfers, bounded graph hashing, rollback/deletion, local map rendering without fetch, and conservative routing-mode behavior.

The mandatory Android airplane-mode new-route test and native performance measurements are **not completed**. iOS native routing is **unverified**. Online/offline hazard parity is **unverified**, rather than inferred from similar code.

### Verification in this workspace

- Combined backend and command regression suite: **334 tests passed**.
- A subsequent focused backend package run passed **20 tests**, including an additional source-expiry timezone regression.
- Final full phone JavaScript suite: **692 tests across 73 suites passed**. Jest retains Expo's preset and transforms lazy imports inside its test VM.
- TypeScript passed. Android and iOS Expo JavaScript exports passed; these are not APK or iOS native builds.
- Lint of the new production offline files passed. The existing repository-wide lint limitations remain separate.
- Backend, dashboard and existing routing services remained healthy after backend rebuild.
- The offline worker is running in the root Compose stack.
- A real **Cipete Selatan** package is published for region UUID 2ad428bb-87e4-4a91-8b72-8cf0681c6ccf.
- Package payload: **82,303,784 bytes**; ZIP: **82,308,679 bytes**, approximately 78.5 MiB. It contains three regional graph tiles.
- Backend assembly took approximately **7.41 seconds** in this run.
- The frontend's actual verification source accepted the live package signature; the live ZIP endpoint passed a byte-range download check.
- The local ignored frontend environment has the generated worker's public key pinned. The private key remains in the ignored .secrets directory.
- The package declares nativeRouting=false and hazardEvaluation=false; evidence freshness is UNKNOWN.

To use the package on a phone, rebuild the development client with the new native dependencies and restart Expo. Device installation, GPS and map behavior are still pending Android/iOS device validation.

## Source files

| Area | Created or modified files |
| --- | --- |
| Backend package modules | app/offline/manifest.py, store.py, builder.py, graph.py and package initializer |
| Backend entrypoints | app/offlineCli.py, app/routers/offline.py, app/main.py |
| Backend configuration | requirements.txt, .env.example, .dockerignore, offline-assets.example.json |
| Backend tests | tests/test_offline_packages.py |
| Shared deployment | Root docker-compose.yml adds the optional offline worker; .gitignore excludes private signing keys and retains documentation |
| Phone package modules | src/features/offline/manifest.ts, package-manager.ts, routing.ts, offline-map.tsx |
| Phone screen | src/screens/offline-regions.tsx and src/app/offline-regions.tsx |
| Phone integration | src/app/_layout.tsx, src/screens/auth.tsx, src/screens/profile.tsx, src/features/navigation/api.ts |
| Phone configuration | package.json, package-lock.json, jest.config.js, .env.example and English/Indonesian localization |
| Phone tests | Offline manifest, package-manager, routing and map suites, test fixture helper, downloaded-region screen, navigation transport and account-screen access regressions |
| Documentation | OFFLINE_NAVIGATION.md and OFFLINE_FEASIBILITY.md |

Generated Android prebuild output is ignored. Data assets, packages, the asset catalog and private signing key are local operational files rather than committed fixtures.
