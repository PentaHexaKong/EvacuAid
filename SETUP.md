# Run EvacuAid locally

This guide takes a Mac from nothing to the whole EvacuAid stack running on your own machine:

- **the backend**, with its database, cache, walking-route engine and hazard worker
- **the Command Center** web dashboard
- **the iPhone app** in the iOS Simulator, connected to your backend

> [!TIP]
> **Only want to try the app?** You don't need any of this. [Install on an iPhone](README.md#install-on-an-iphone) builds the app against our hosted backend in about 30 minutes.

## Before you start

| | |
| --- | --- |
| **Computer** | A Mac with Apple Silicon (M1 or newer). The iPhone app can only be built on macOS. The backend runs anywhere Docker does. |
| **Memory** | 16 GB or more recommended. Building the routing tiles needs about 8 GB free. |
| **Disk** | About 40 GB free: roughly 20 GB for Xcode and the iOS runtime, 3 GB for map data, 3 GB for Docker images, and 5 GB for the app build. |
| **Time** | 2–3 hours the first time, mostly downloads, building the routing tiles and the first app build. After that, starting everything takes one command. |
| **Accounts** | None are required. Optional: a [Mapbox](https://account.mapbox.com/) public token for the styled map, and a [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/api/map_key/) key for wildfire hotspots. |

**Which places work.** The demo data covers **Jakarta**: gathering points, regions and the Command Center. Walking routes cover the island of **Java**. Warnings and Buddy work anywhere.

Run every command from the repository root unless a step says otherwise.

---

## 1. Install the tools

| Tool | How to install | Check it worked |
| --- | --- | --- |
| **Xcode** 27 or newer | From the [Mac App Store](https://apps.apple.com/app/xcode/id497799835). Open it once, accept the license, and install the **iOS** platform when it asks. | `xcodebuild -version` |
| Xcode command-line tools | `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` | `xcode-select -p` |
| **Homebrew** | Follow [brew.sh](https://brew.sh) | `brew -v` |
| **Node.js 24** | `brew install fnm`, add `eval "$(fnm env --use-on-cd)"` to `~/.zshrc`, open a new terminal, then `fnm install 24 && fnm default 24` | `node -v` shows `v24.x` |
| **CocoaPods** | `brew install cocoapods` | `pod --version` |
| **Docker** | `brew install --cask orbstack`, then open OrbStack once. [Docker Desktop](https://www.docker.com/products/docker-desktop/) also works. | `docker info` |

Notes:

- **No simulators listed?** The iOS runtime didn't install. Get it from **Xcode › Settings › Components**.
- **One Docker app at a time.** Use OrbStack *or* Docker Desktop, not both. They compete for the `docker` command.
- **Docker memory.** OrbStack hands out memory as needed. In Docker Desktop, set at least 8 GB in **Settings › Resources** before building the tiles.

## 2. Get the code

```bash
git clone https://github.com/PentaHexaKong/EvacuAid.git
cd EvacuAid
```

## 3. Create the configuration files

EvacuAid reads three `.env` files. Git ignores them, so your keys never end up in a commit. Create them from the examples:

```bash
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

### `.env` (Docker Compose)

The defaults work as they are. Leave `COMPOSE_PROJECT_NAME=evacuaid` unchanged: it fixes the Docker volume names this guide uses. Optionally, put your Mapbox public token (`pk.…`) in `MAPBOX_TOKEN` to give the Command Center a basemap.

### `backend/.env` (the API)

The example is set up for a production server. For your own machine, change these four lines:

```bash
APP_ENV=development
AUTH_JWT_SECRET=        # paste the output of: openssl rand -hex 32
AUTH_ALLOW_GUEST_SESSIONS=true
PILOT_DEV_SIMULATION=1
```

| Setting | What it does |
| --- | --- |
| `AUTH_JWT_SECRET` | Signs sign-in tokens. **Required:** the backend won't start without one of at least 32 bytes. Keep it private. |
| `AUTH_ALLOW_GUEST_SESSIONS` | Turns on **Continue as guest** in the app. |
| `PILOT_DEV_SIMULATION` | Turns on the app's "simulate a nearby request" button, which is useful with a single device. |
| `FIRMS_MAP_KEY` | Optional. Your NASA FIRMS key, for wildfire hotspots. |

Leave `DATABASE_URL`, `REDIS_URL` and `VALHALLA_URL` alone: Docker Compose fills them in.

### `frontend/.env` (the app)

```bash
EXPO_PUBLIC_API_BASE_URL=http://localhost:8000
IOS_BUNDLE_IDENTIFIER=dev.evacuaid.foundation
EXPO_PUBLIC_MAPBOX_TOKEN=          # optional; without it the map falls back to Apple Maps
```

`./dev.sh` (step 7) sets the API address by itself, so you rarely need to touch it. To run the app on a physical iPhone, use your own unique bundle ID. See [Install on an iPhone](README.md#install-on-an-iphone).

## 4. Download the map data and build the routing tiles

Walking routes come from [Valhalla](https://github.com/valhalla/valhalla), a routing engine. Valhalla can't read OpenStreetMap data directly: it needs **routing tiles** built from it. That is a one-time step.

### 4.1 Download the OpenStreetMap extract for Java

This is about 900 MB from [Geofabrik](https://download.geofabrik.de/asia/indonesia.html):

```bash
mkdir -p backend/data/valhallaData
curl -L -o backend/data/valhallaData/java-latest.osm.pbf \
  https://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf
```

### 4.2 Build the tiles

This takes about 20–40 minutes and keeps the CPU busy. It writes one file, `tiles.tar` (about 1 GB), into a Docker volume that the routing service reads.

```bash
docker volume create evacuaid_valhalla_tiles
docker run --rm \
  -v evacuaid_valhalla_tiles:/data/valhalla \
  -v "$PWD/backend/data/valhallaData:/input:ro" \
  --entrypoint sh ghcr.io/valhalla/valhalla:3.9.0 -c '
    set -e
    valhalla_build_config --mjolnir-tile-dir /data/valhalla --mjolnir-tile-extract /data/valhalla/tiles.tar > /tmp/valhalla.json
    valhalla_build_tiles -c /tmp/valhalla.json /input/java-latest.osm.pbf
    valhalla_build_extract -c /tmp/valhalla.json -v
    find /data/valhalla -mindepth 1 -maxdepth 1 -type d -exec rm -rf {} +'
```

The run ends with `Finished tarring … tiles to /data/valhalla/tiles.tar`. Check the result:

```bash
docker run --rm -v evacuaid_valhalla_tiles:/v alpine ls -lh /v     # one file: tiles.tar
```

Things to know:

- **Match the image version.** The tiles must be built with the same Valhalla version that `docker-compose.yml` runs (`3.9.0`). If you change one, rebuild the tiles.
- **Try it small first.** To test the command quickly, build from a small extract such as `maluku-latest.osm.pbf` (26 MB, done in seconds), into a different volume. Routes then only work in that region.
- **The extract file afterwards.** You can delete the `.osm.pbf` once the tiles are built.

## 5. Start the backend

```bash
docker compose --profile routing --profile hazards up -d --build --wait
```

The first start takes 3–5 minutes. It builds the images, initialises the database and runs the migrations. These containers start:

| Service | Address | What it does |
| --- | --- | --- |
| `backend` | [localhost:8000](http://localhost:8000/docs) | The API (FastAPI). Applies **database migrations automatically** every time it starts. |
| `dashboard` | [localhost:8080/command-center/](http://localhost:8080/command-center/) | The Command Center |
| `postgres` | port 5432 | PostgreSQL 16 with PostGIS |
| `redis` | port 6379 | Cache |
| `valhalla` | internal only | Walking routes, from the tiles you built |
| `hazard-worker` | none | Fetches official warnings (BMKG), community flood reports (PetaBencana) and wildfire hotspots every few minutes |

**Check that it's healthy:**

```bash
curl -s localhost:8000/health | python3 -m json.tool | head -8
```

You want `"database": "healthy"`, `"redis": "healthy"` and `"valhalla": "healthy"`. The overall status may say `"degraded"`. That's normal: it only means an optional outside source didn't answer.

**About migrations.** You never run them by hand. The backend runs `alembic -c /app/testocando/alembic.ini upgrade head` before it starts serving. That one configuration covers both the app's and the Command Center's tables. To see which version the database is on:

```bash
docker compose exec backend alembic -c /app/testocando/alembic.ini current     # ends with (head)
```

**Ports 5432 or 6379 already taken?** That happens if you run Postgres or Redis outside Docker. Create a `docker-compose.override.yml` next to `docker-compose.yml`; Git ignores it.

```yaml
services:
  postgres:
    ports: !override
      - "127.0.0.1:5433:5432"
  redis:
    ports: !reset []
```

The backend reaches both containers by name, so their host ports don't matter to it.

## 6. Load the demo data

A new database is empty. These commands fill it with what the demo uses.

```bash
# 1. Jakarta's administrative regions for the Command Center: 318 regions,
#    downloaded from the Jakarta government's public GIS. Run once; repeats are rejected.
docker compose exec backend python -m command.jakartaBoundaries --output-dir /tmp/jakarta-regions
docker compose exec backend python -m command.cli import /tmp/jakarta-regions/jakarta-regions.geojson

# 2. Six sample gathering points around central Jakarta (-6.2, 106.8), named "Titik Kumpul Contoh A–F"
docker compose exec backend python -m scripts.seed_demo_shelters

# 3. Sample field reports, help requests and check-ins for the Command Center pages (safe to rerun)
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < backend/scripts/seed_demo_operations.sql

# 4. Fetch live hazard data now, instead of waiting for the worker
docker compose exec backend python -m app.hazardCli refresh
```

All of this is clearly labelled sample data. None of it is an official shelter or region status.

**Gathering points somewhere else?** `python -m scripts.seed_demo_shelters <lat> <lon>` places the same six points around any location. Routes need that location to be inside the area your tiles cover.

### Demo accounts (optional)

Our stage demo uses two accounts: **Rina**, who is blind, and **Andi**, her Buddy. To recreate it, use the app's **Sign in or create account** to create:

| Email | Password | Setup |
| --- | --- | --- |
| `rina.demo@evacuaid.app` | any, 12+ characters | Choose the **blind / low vision** need |
| `andi.demo@evacuaid.app` | any, 12+ characters | No needs |

Then link them: from Rina's account, open Buddy › **Add Buddy** and invite Andi. After that, one script resets the demo between runs:

```bash
./scripts/reset-demo.sh             # end open help sessions and clear simulated warnings
./scripts/reset-demo.sh --warning   # the same, then raise a flood warning over the demo area for 3 hours
./scripts/reset-demo.sh --unlink    # also remove the Buddy link, to show the invite again
```

## 7. Run the app in the iOS Simulator

The app is an Expo [development build](https://docs.expo.dev/develop/development-builds/introduction/), so it does **not** run in Expo Go. You build the native app once; after that, Metro serves your JavaScript changes to it instantly.

### 7.1 First build (once)

```bash
cd frontend
npm ci
xcrun simctl create "EvacuAid iPhone 17" com.apple.CoreSimulator.SimDeviceType.iPhone-17
npx expo prebuild -p ios
npx expo run:ios --device "EvacuAid iPhone 17"
cd ..
```

- `prebuild` generates the native project in `frontend/ios/`. Git ignores that folder, and it is rebuilt from `app.config.ts`.
- The first build takes 10–20 minutes. When the app opens, stop the Metro server it started (Ctrl-C).
- **Build again** only after you pull changes to native dependencies, `app.config.ts`, `frontend/plugins/`, or the icon or splash screen. If a build fails after a dependency update, run `npx expo prebuild -p ios --clean` first.

### 7.2 Every day after that

```bash
./dev.sh
```

`./dev.sh` does all of this:

1. Starts Docker if it isn't running.
2. Starts the backend and waits until it's healthy.
3. Boots the "EvacuAid iPhone 17" simulator, creating it if needed.
4. Moves the simulator to Jakarta.
5. Starts Metro and opens the app.

Other options:

| Command | Use it when |
| --- | --- |
| `./dev.sh --build` | You changed backend code. The backend image includes the source, so it has to be rebuilt. |
| `./dev.sh phone` | You're running the app on a physical iPhone on the same Wi-Fi. Uses your Mac's Wi-Fi address. |
| `SIM_NAME="iPhone 17 Pro" ./dev.sh` | You want a different simulator. |

### 7.3 Two devices for Buddy

A Buddy request needs two accounts on two devices. Install the app on a second simulator:

```bash
xcrun simctl create "EvacuAid Buddy" com.apple.CoreSimulator.SimDeviceType.iPhone-17
cd frontend && npx expo run:ios --device "EvacuAid Buddy"
```

Then sign in to a different account on each simulator.

### 7.4 Simulator tips

- **Set the location to Jakarta.** Outside Jakarta, Evacuate finds no gathering point.

  ```bash
  xcrun simctl location booted set -6.2,106.8
  ```

- **"Couldn't load the route".** The backend refuses a starting position older than 2 minutes, and a fixed simulated location keeps its first timestamp. Give the simulator a slowly moving location instead. Keep the `--`: without it, the negative latitude is read as an option.

  ```bash
  xcrun simctl location booted start --speed=0.1 --interval=5 -- -6.2,106.8 -6.2,106.802
  ```

- **Ask for permissions again.** This makes the app ask for location access as if it were freshly installed:

  ```bash
  xcrun simctl privacy booted reset location dev.evacuaid.foundation
  ```

- **What the Simulator can't do.** Bluetooth nearby help, voice commands (microphone), haptics and real GPS need a physical iPhone.

## 8. Check that everything works

1. **Backend.** `curl -s localhost:8000/health` reports database, Redis and Valhalla as healthy.
2. **App.** It opens, **Continue as guest** works, and Home shows no "Cannot reach EvacuAid API" banner.
3. **Routing.** Discover lists the "Titik Kumpul Contoh" points, and **Start evacuation** draws a walking route.
4. **Warnings.** Raise a test warning, keep the app open, and it appears in **Alerts** within a minute:

   ```bash
   docker compose exec backend python scripts/simulate_alerts.py awas --lat -6.2 --lon 106.8
   ```

   Remove it afterwards with `... simulate_alerts.py clear`.
5. **Command Center.** In [localhost:8080/command-center/](http://localhost:8080/command-center/), Overview shows the Jakarta regions on the map, and **Field reports** lists the sample reports.

### Run the tests

**App:**

```bash
cd frontend
npx tsc --noEmit
npm test
```

**Backend and Command Center.** These use their own throwaway database and never touch your data:

```bash
docker compose -p evacuaid-test -f testocando/docker-compose.test.yml up -d postgres
sleep 25    # give Postgres time to accept connections
docker compose -p evacuaid-test -f testocando/docker-compose.test.yml run --rm tests
docker compose -p evacuaid-test -f testocando/docker-compose.test.yml down -v
```

**End-to-end tests (optional).** These drive the app in a booted simulator. Their agent steps run on a ChatGPT subscription, so log in once with `npx e2e login openai`. Then, from `frontend`:

```bash
npx e2e run tests/buddy.e2e.ts
```

The app must already be signed in. If a run fails at launch with `ENGINE_FAILURE`, run `npx agent-device daemon stop` and try again. Run these on an otherwise idle machine.

## Stop, restart and reset

| Goal | Command |
| --- | --- |
| Stop everything, keeping your data | `docker compose --profile routing --profile hazards down` |
| Start again | `./dev.sh`, or the command in step 5 |
| See the backend's logs | `docker compose logs -f backend` |
| **Delete all local data** (database **and** routing tiles) | `docker compose --profile routing --profile hazards down -v`. After this, repeat steps 4.2, 5 and 6. |

## Troubleshooting

| Problem | Fix |
| --- | --- |
| The backend keeps restarting, and its logs mention `AUTH_JWT_SECRET` | Set a secret of 32+ bytes in `backend/.env` (step 3), then run `docker compose up -d backend`. |
| `/health` shows Valhalla unhealthy, or routes say "unavailable" | The tiles are missing. Check that `docker run --rm -v evacuaid_valhalla_tiles:/v alpine ls -lh /v` lists `tiles.tar`, and that `.env` has `COMPOSE_PROJECT_NAME=evacuaid`. |
| The tile build stops with a "Killed" message | Docker ran out of memory. Give it at least 8 GB (step 1), then build again. |
| The region import fails to download | The Jakarta GIS server is unavailable. Try again later. Everything except the Command Center's region map works without it. |
| The region import says the codes already exist | They were already imported. Nothing to do. |
| The app shows "Cannot reach EvacuAid API" | **Simulator:** check that the backend is up on port 8000. **Phone:** your Mac's Wi-Fi address changed. Restart `./dev.sh phone`; no rebuild is needed. |
| "Guest mode is not available on this server" | Set `AUTH_ALLOW_GUEST_SESSIONS=true` in `backend/.env`, then run `docker compose up -d backend`. |
| The "simulate" button in Buddy shows "Not Found" | Set `PILOT_DEV_SIMULATION=1` in `backend/.env`, then run `docker compose up -d backend`. |
| White screen on iOS 27, or `pod install` fails | `cd frontend && npx expo prebuild -p ios --clean`, then build again (step 7.1). |
| Backend logs say "Multiple head revisions" | Your code is behind. Run `git pull` and start again. |
| `docker: command not found` | Open OrbStack or Docker Desktop. |
| The map is plain Apple Maps | Expected without `EXPO_PUBLIC_MAPBOX_TOKEN`. Nothing is missing except the styling. |

## Optional extras

You don't need these for the demo:

- **Elevation data (DEM)** improves tsunami and landslide scoring. Without it, those factors report "unknown". See "Prepare data" in [`backend/README.md`](backend/README.md).
- **Offline map regions** power **Downloaded regions** in the app. They are built and signed by the offline worker; see [`OFFLINE_NAVIGATION.md`](OFFLINE_NAVIGATION.md).
- **InaRISK hazard layers** add baseline hazard zones from Indonesia's disaster agency. See [`backend/README.md`](backend/README.md).

## Moving an existing setup to another Mac

To skip the tile build and the seeding on a second machine, copy the data across.

**On the machine you're copying from**, with its stack running:

```bash
mkdir -p ~/evacuaid-transfer
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl -Fc -f /tmp/evacuaid.dump'
docker compose cp postgres:/tmp/evacuaid.dump ~/evacuaid-transfer/evacuaid.dump
docker run --rm -v evacuaid_valhalla_tiles:/tiles:ro -v ~/evacuaid-transfer:/out alpine cp /tiles/tiles.tar /out/tiles.tar
tar -czf ~/evacuaid-transfer/backend-data.tgz --exclude='data/valhallaData' -C backend data
cp .env ~/evacuaid-transfer/root.env; cp backend/.env ~/evacuaid-transfer/backend.env; cp frontend/.env ~/evacuaid-transfer/frontend.env
```

The folder contains your secrets. Move it with AirDrop or an external drive, not a shared cloud folder.

**On the new machine**, after steps 1 and 2:

```bash
T=~/evacuaid-transfer
cp $T/root.env .env && cp $T/backend.env backend/.env && cp $T/frontend.env frontend/.env
grep -q '^COMPOSE_PROJECT_NAME=' .env || echo 'COMPOSE_PROJECT_NAME=evacuaid' >> .env
tar -xzf $T/backend-data.tgz -C backend
docker volume create evacuaid_valhalla_tiles
docker run --rm -v evacuaid_valhalla_tiles:/tiles -v $T:/in:ro alpine cp /in/tiles.tar /tiles/tiles.tar

# Start only the database first, so the backend can't set up an empty one before the restore
docker compose up -d --wait postgres redis
docker compose cp $T/evacuaid.dump postgres:/tmp/evacuaid.dump
docker compose exec -T postgres sh -c 'pg_restore --exit-on-error --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB" /tmp/evacuaid.dump'
```

Then continue at step 5, and skip step 6: the accounts, regions and sample data came with the database.

Restore **once**, into the fresh database. If the restore fails partway, reset with `docker compose down -v`, which also deletes the tiles volume, and repeat this section.

## More documentation

- [`README.md`](README.md): what EvacuAid does, installing on an iPhone, and the current limitations
- [`frontend/README.md`](frontend/README.md): app scripts, Android
- [`backend/README.md`](backend/README.md): the API, hazard data, how routes are chosen
- [`testocando/README.md`](testocando/README.md): the Command Center and the region import format
- [`VPS_DEPLOYMENT.md`](VPS_DEPLOYMENT.md): deploying to a server
