# Offline routing feasibility spike

## Decision

**Phase 2 is BLOCKED at native build and device verification.**

Valhalla Mobile remains a plausible candidate. It has not been proved incompatible, and EvacuAid has not switched to another engine. No new on-device pedestrian route has been demonstrated with networking disabled. Cached geometry is not counted as recalculation.

The Phase 1 implementation provides signed regional file-set packages, a background builder, streamed downloads, a device package manager and an offline vector-map adapter.

## Repository findings

| Area | Inspected finding |
| --- | --- |
| Runtime | Expo 57.0.26 development client, React Native 0.86.3 |
| Native projects before spike | No checked-in/generated Android or iOS project present |
| Native generation | Android prebuild succeeded during the spike; generated files remain ignored |
| Android configuration | Generated Gradle project has New Architecture and Hermes enabled |
| iOS | Expo configuration exists; no Xcode/macOS environment is available |
| Navigation | Expo Router, existing page-local screens |
| Maps | @rnmapbox/maps 10.3.5 when a Mapbox public token is configured; react-native-maps 1.27.2 fallback |
| Persistence before change | AsyncStorage and SecureStore; no regional package manager |
| Online routes | FastAPI navigation service calls Valhalla using pedestrian costing and evaluates hazard evidence before ranking |
| Wheelchair profile | Existing online provider still uses pedestrian costing; local accessibility validation must not be assumed |
| Server engine | Running Valhalla reports version 3.9.0 |
| Running image | ghcr.io/interline-io/valhalla-docker/valhalla; pinned digest is recorded in VPS_DEPLOYMENT.md |
| Graph storage | Named volume evacuaid_valhalla_tiles, graph directories 0, 1 and 2 |
| Graph size | Approximately 1,021 MiB across the existing source volume; this is not a mobile regional-package size |
| Tile header | A real level-2 tile contains version 3.9.0 in its fixed version field |
| Tile extracts | Config names tiles.tar and traffic.tar, but neither exists; server reads directory tiles |
| Request format | Locations with lat/lon, pedestrian costing, kilometre units, geometry format request |
| Response format | Valhalla trip legs; existing provider handles encoded shapes and returns GeoJSON LineString |
| Hazard policy | Official hard geometry and confirmed closures reject routes before ranking; tsunami escape/no-reentry rules already exist online |

## Native build attempt

Executed from the frontend:

~~~powershell
$env:CI='1'
npx expo run:android --no-install
~~~

Observed:

1. Android native directory generation succeeded.
2. Package manifest required no prebuild changes.
3. Prebuild completed.
4. The build stopped because the default Android SDK directory was absent.
5. adb was not installed or available on PATH.

Relevant diagnostic:

~~~text
Failed to resolve the Android SDK path.
Default install location not found:
C:\Users\xenox\AppData\Local\Android\Sdk
Error: 'adb' is not recognized as an internal or external command
~~~

Desktop Java, CMake and Clang are present. They do not establish Android NDK, emulator or JNI compatibility.

## Engine evaluation

[Valhalla Mobile](https://github.com/Rallista/valhalla-mobile) exposes on-device route operations for Android and Apple platforms. Its documentation describes native tile-based routing, rather than a remote HTTP wrapper.

The inspected Android build configuration uses compileSdk 36, minSdk 24 and Java 21. Its development instructions identify Android Studio/NDK for Android and Xcode/macOS for Apple builds:

- [Android library build configuration](https://github.com/Rallista/valhalla-mobile/blob/main/android/valhalla/build.gradle.kts)
- [Native development requirements](https://github.com/Rallista/valhalla-mobile/blob/main/docs/development.md)

The inspected mobile repository's Valhalla submodule pointed to commit bafb69902220615a48307d5c790fb6c943802ba4. This does not prove ABI or tile compatibility with this repository's server-built 3.9.0 graph. A future integration must pin an engine revision and verify the downloaded tiles through that actual native reader.

No alternative engine was introduced. There is no demonstrated Valhalla incompatibility that would justify switching engines; the immediate blocker is the missing native build/test toolchain.

## Measurements

| Measurement | Result |
| --- | --- |
| Source graph volume size | Approximately 1,021 MiB |
| Real regional package size | Cipete Selatan: 82,303,784 payload bytes; ZIP 82,308,679 bytes (about 78.5 MiB), measured on the backend |
| Backend package assembly | Approximately 7.41 seconds for this build; not native route latency |
| Android native routing build | Blocked before native compilation |
| iOS native routing build | Not attempted; macOS/Xcode unavailable |
| Native engine memory | Unmeasured |
| Native engine cold start | Unmeasured |
| Native route latency | Unmeasured |
| Airplane-mode new-route test | Not run; acceptance criterion unmet |
| Online/offline route parity | Unverified |

Desktop unit tests and Expo JavaScript exports do not replace these measurements.

The real package was generated from the existing source graph plus public street geometry. The actual frontend manifest-verification source accepted the live backend signature, and the live ZIP endpoint returned HTTP 206 for a requested byte range. This verifies server generation and cross-runtime authenticity, not mobile graph-reader compatibility.

## Conservative behavior while blocked

- Packages declare nativeRouting=false, hazardEvaluation=false and wheelchairRouting=false.
- Graph tile header checks and per-file checksums are implemented; native graph-reader compatibility remains UNVERIFIED.
- The local routing facade returns ROUTING_UNAVAILABLE and no geometry.
- Missing packages and endpoints outside the package bbox have explicit reason codes.
- Cached routes cannot become calculated routes.
- No local hazard evaluator, hard-hazard avoidance, tsunami exit/reentry or detour parity is claimed.
- Existing server routing and hard-hazard behavior remain in place.
- Phase 1 map display represents downloaded evidence, including stale evidence; it does not establish safety.

## Required next verification

1. Provision Android Studio, the SDK, an emulator/device, the candidate's required JDK and matching NDK.
2. Pin and compile the native routing library and React Native/Expo bridge.
3. Load a small signed 3.9.0 graph extract and verify reader compatibility, rather than trusting a version label.
4. Compute new pedestrian routes for multiple coordinate pairs with Wi-Fi and mobile data disabled.
5. Record package size, native heap/process memory, cold start and repeated route latency.
6. Add cancellable native background routing and full final-geometry hazard evaluation.
7. Prove hard closure rejection, tsunami escape/no-reentry and bounded avoidance alternatives.
8. Test on-device accessibility requirements without claiming unsupported wheelchair compatibility.
9. Perform iOS build and device verification on macOS separately.

The full Phase 2 implementation must remain gated until this spike succeeds.
