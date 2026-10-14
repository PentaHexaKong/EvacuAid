# EvacuAid VPS deployment

Deploy the backend and government dashboard together using the existing **root Docker Compose stack**. The phone app connects to the same backend over HTTPS.

This guide transfers the current working copy, database, backend data assets and Valhalla routing tiles from your **Mac** to a **new VPS**. It preserves your existing regions, accounts and safe houses. If your VPS already runs an older EvacuAid and you only need to bring it up to date, skip to [section 19](#19-update-an-existing-vps).

The instructions assume:

- Ubuntu 24.04 LTS on an **x86_64 / AMD64** VPS.
- A domain with access to its DNS settings.
- Docker Desktop running on your Mac.
- Your local EvacuAid services running before you export their data.
- A fresh VPS database for the initial restore.

The Compose override has not been run against a VPS. Treat the first run as a test, and read each command before you paste it.

## 1. Choose the VPS and domains

A starting resource estimate for the current Jakarta deployment is **4 vCPU, 8 GB RAM and 80 GB SSD**. This is an estimate, not a measured capacity guarantee; larger routing coverage and traffic need more resources.

Replace the following placeholders throughout this guide:

| Placeholder | Meaning | Example |
| --- | --- | --- |
| VPS_IP | Your VPS public IPv4 address | 203.0.113.50 |
| api.example.com | Your backend domain | api.yourdomain.com |
| dashboard.example.com | Your dashboard domain | dashboard.yourdomain.com |
| YOUR_PUBLIC_IP | Your home or office public IPv4 address | 198.51.100.20 |
| you@example.com | Your certificate contact email | Your own email address |

**The example IP addresses are documentation examples. Replace them with your real addresses.**

Your deployment will contain:

| Service | Purpose | Public access |
| --- | --- | --- |
| Caddy | HTTPS certificates and reverse proxy | Ports 80 and 443 |
| backend | Shared FastAPI backend and command APIs | Through Caddy |
| dashboard | Government dashboard (a React/Vite app built into the image) and its API proxy. Served at `/command-center/`; `/` redirects there. The first build is slower because it also installs and builds the web app | Through Caddy, trusted IPs (or public for a demo) |
| postgres | Shared PostGIS database | Internal Docker network |
| redis | Shared cache | Internal Docker network |
| valhalla | Road routing using existing tiles | Internal Docker network |
| hazard-worker | Background hazard provider ingestion | Internal Docker network |

The dashboard has **no login**. Its command API calls are protected by `COMMAND_API_KEY`, which the dashboard server adds on the server side when it proxies `/v1/command*`; the key never reaches the browser. This guide additionally limits the dashboard and the direct command API to **trusted IP addresses** in Caddy. The phone API remains publicly reachable with its existing account authentication. [Section 14](#14-configure-https-and-dashboard-access) also describes a public demo variant.

## 2. Create an SSH key on your Mac

**Run on your Mac in Terminal.**

If you already have an SSH key, reuse its public key. Otherwise:

~~~bash
ssh-keygen -t ed25519
~~~

Accept the suggested path unless you need another key location. Do not overwrite an existing key you still use.

Display your public key:

~~~bash
cat ~/.ssh/id_ed25519.pub
~~~

During VPS creation, select Ubuntu 24.04 and paste this public key into the provider's SSH-key field. Keep the private key on your Mac.

## 3. Point your domains to the VPS

Create these records in your domain's DNS settings:

| Type | Name | Value |
| --- | --- | --- |
| A | api | VPS_IP |
| A | dashboard | VPS_IP |

If using Cloudflare, use **DNS-only mode** for this setup. The trusted-IP rules below assume clients connect directly to Caddy.

Only add AAAA records if you have configured working IPv6. This guide's dashboard allowlist uses IPv4.

Check resolution from your Mac:

~~~bash
dig +short api.example.com A
dig +short dashboard.example.com A
~~~

Both should print your VPS IPv4 address before you configure HTTPS.

## 4. Connect and prepare the VPS

**Run on your Mac:**

~~~bash
ssh root@VPS_IP
~~~

The remaining server commands assume a root SSH session. If your provider gives you an Ubuntu account instead:

~~~bash
ssh ubuntu@VPS_IP
~~~

Then, inside the VPS:

~~~bash
sudo -i
~~~

**Run on the VPS:**

~~~bash
apt update
apt upgrade -y
apt install -y ca-certificates curl gnupg ufw openssl nano
~~~

Configure the firewall, allowing SSH before enabling it:

~~~bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
ufw status
~~~

If your provider uses a nonstandard SSH port, allow that actual port before enabling UFW.

In the VPS provider's network firewall, also allow TCP **22, 80 and 443**, or your actual SSH port instead of 22.

## 5. Install Docker and Docker Compose

**Run on the VPS.** These commands use Docker's official Ubuntu package repository.

~~~bash
install -m 0755 -d /etc/apt/keyrings

curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc

chmod a+r /etc/apt/keyrings/docker.asc

cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

apt update
apt install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin

systemctl enable --now docker
docker run --rm hello-world
docker compose version
~~~

Compose must support the override tags used below: **version 2.24.4 or newer**. The official installation supplies a current version.

Sources: [Docker installation](https://docs.docker.com/engine/install/ubuntu/) and [Compose merge rules](https://docs.docker.com/reference/compose-file/merge/).

## 6. Export the current project and data from your Mac

Leave Docker Desktop and your local EvacuAid containers running. Open a **second Terminal window** and go to your EvacuAid folder (adjust the path to where you cloned it):

~~~bash
cd ~/code/EvacuAid
docker compose ps

deployBundle=$(mktemp -d)
echo "$deployBundle"
~~~

### Package the source and backend assets

This packages your current working files, including changes that have not been committed to Git. It includes backend data assets and excludes local environment files, dependency directories and Mac metadata. `COPYFILE_DISABLE=1` stops macOS from adding hidden `._` files to the archive.

~~~bash
COPYFILE_DISABLE=1 tar \
  --exclude=".git" --exclude=".env" --exclude=".venv" --exclude="venv" \
  --exclude="node_modules" --exclude=".DS_Store" --exclude="__pycache__" \
  --exclude=".pytest_cache" \
  --exclude="testocando/mapshit/dashboard/output" \
  --exclude="testocando/mapshit/dashboard/test-results" \
  --exclude="frontend/ios" --exclude="frontend/android" \
  -czf "$deployBundle/source.tgz" docker-compose.yml backend testocando
~~~

`node_modules` is excluded at every depth. The native phone frontend is not hosted on the VPS, so it is not included. Images are built on the VPS, so you do not build for another CPU architecture on your Mac.

### Export PostgreSQL

~~~bash
docker compose exec -T postgres sh -c 'pg_dump -U $POSTGRES_USER -d $POSTGRES_DB --no-owner --no-acl -Fc -f /tmp/evacuaid.dump'

docker compose cp postgres:/tmp/evacuaid.dump "$deployBundle/evacuaid.dump"
~~~

The dump preserves existing accounts, regions, safe houses and dashboard records. Existing mock records retain their simulation labels.

The dump is created inside the container and copied out, so no binary data passes through your shell.

### Export Valhalla tiles

~~~bash
docker compose exec -T valhalla tar -czf /tmp/valhalla-tiles.tgz -C /data/valhalla .

docker compose cp valhalla:/tmp/valhalla-tiles.tgz "$deployBundle/valhalla-tiles.tgz"
~~~

Valhalla tiles do not depend on the CPU architecture, so tiles exported on an Apple Silicon Mac work on an x86_64 VPS.

Your current routing tiles are about 1 GB before compression. Source packaging and tile export may take several minutes.

Confirm the three files exist:

~~~bash
ls -lh "$deployBundle"
~~~

Expected files:

- source.tgz
- evacuaid.dump
- valhalla-tiles.tgz

Do not continue if an export command failed. Avoid making local dashboard edits during the final transfer if you need an exact cutover snapshot.

## 7. Upload the files

**On the VPS:**

~~~bash
mkdir -p /opt/evacuaid
chmod 700 /opt/evacuaid
~~~

**On your Mac:**

~~~bash
scp "$deployBundle/source.tgz" "$deployBundle/evacuaid.dump" "$deployBundle/valhalla-tiles.tgz" root@VPS_IP:/opt/evacuaid/
~~~

**On the VPS:**

~~~bash
cd /opt/evacuaid
tar -xzf source.tgz
ls
~~~

You should see the backend and testocando directories and the root docker-compose.yml.

**Keep the source tree at `/opt/evacuaid`.** The backend container bind-mounts `./testocando` and `./backend/alembic` from there (read-only), and runs the migrations and command API from those files.

## 8. Create production environment files

The project uses **two different environment files**:

| File | Purpose |
| --- | --- |
| /opt/evacuaid/.env | Compose substitution: PostgreSQL password, command API key, dashboard map settings |
| /opt/evacuaid/backend/.env | Application settings, provider keys and JWT signing secret |

Compose supplies the container database URL from the root environment values. Changing only the database URL in backend/.env does not change that Compose override.

**Run on the VPS:**

~~~bash
cd /opt/evacuaid
umask 077

cat > .env <<EOF
POSTGRES_USER=evacuaid
POSTGRES_DB=evacuaid
POSTGRES_PASSWORD=$(openssl rand -hex 32)
COMMAND_API_KEY=$(openssl rand -hex 32)
VALHALLA_URL=http://valhalla:8002
ALERT_PUSH_ENABLED=true
MAPBOX_TOKEN=
MAPBOX_STYLE=mapbox/standard
COMMAND_MOCK_ALERTS_ENABLED=1
EOF

cp backend/.env.example backend/.env

sed -i "s/^AUTH_JWT_SECRET=.*/AUTH_JWT_SECRET=$(openssl rand -hex 32)/" backend/.env
~~~

These commands generate new secrets without printing them. What the root `.env` values do:

| Variable | Meaning |
| --- | --- |
| COMMAND_API_KEY | Required for the dashboard to load data. The dashboard server sends it to the backend when it proxies `/v1/command*`; the backend rejects command requests without it. Keep it private. |
| MAPBOX_TOKEN | A **public** Mapbox token that starts with `pk.`. Any other value is ignored. Without it the dashboard still works (lists, KPIs, operations) but the map is blank. The token is visible in the dashboard page, so restrict it to the dashboard domain in your Mapbox account. Edit the file with `nano .env` to paste it. |
| MAPBOX_STYLE | Optional map style. Defaults to `mapbox/standard`. |
| COMMAND_MOCK_ALERTS_ENABLED | `1` lets the dashboard's mock disasters send **real test warnings to phones** in the drawn area. `0` disables mock disasters (the backend answers 403). Use `1` only for a demo. |

Edit the backend configuration:

~~~bash
nano backend/.env
~~~

Confirm the following settings, preserving the generated signing secret:

~~~dotenv
APP_ENV=production
AUTH_JWT_ISSUER=evacuaid
AUTH_JWT_AUDIENCE=evacuaid-app
AUTH_ACCESS_TOKEN_SECONDS=900
AUTH_REFRESH_TOKEN_DAYS=30
AUTH_ALLOW_GUEST_SESSIONS=false
CORS_ALLOWED_ORIGINS=
~~~

If PILOT_DEV_SIMULATION is present, set it to 0 (see section 9).

To use the current DEM transferred from your Mac, configure:

~~~dotenv
DEM_ASSET_PATH=/app/data/DEM/output_hh.tif
DEM_SOURCE=COPERNICUS_GLO30_OPENTOPOGRAPHY
DEM_VERTICAL_DATUM=EGM2008
~~~

Confirm the asset exists:

~~~bash
ls -lh backend/data/DEM/output_hh.tif
~~~

If you want FIRMS ingestion, add your own FIRMS_MAP_KEY. Other provider or pilot settings from your local private environment must also be configured explicitly; they were excluded from the archive.

Save in nano with **Ctrl+O, Enter, Ctrl+X**.

~~~bash
chmod 600 .env backend/.env
~~~

Empty CORS is appropriate for this setup: native mobile requests do not require browser CORS, and the dashboard calls its own same-origin API proxy.

Two optional settings in `backend/.env` are described in its `.env.example`:

- `BUDDY_PILOT_ENROLLMENT_CODE`: the enrollment code for the Buddy pilot. Leave it empty unless you run the pilot, and keep the value private.
- `OFFLINE_SIGNING_KEY_ID`: the name of the Ed25519 key that signs offline region packages (default `offline-v1`). It is only used when you build offline packages; see section 10.

## 9. Demo mode for testers

Use this when testers or judges need to try the app without creating accounts. It is a temporary state: switch back afterwards.

**Edit `/opt/evacuaid/backend/.env`:**

~~~dotenv
APP_ENV=development
AUTH_ALLOW_GUEST_SESSIONS=true
PILOT_DEV_SIMULATION=0
~~~

**Edit `/opt/evacuaid/.env`:**

~~~dotenv
COMMAND_MOCK_ALERTS_ENABLED=1
~~~

| Setting | What it does |
| --- | --- |
| APP_ENV=development | Required for guest sign-in. The backend refuses to start with guests enabled while `APP_ENV=production` (`backend/app/authConfig.py`). |
| AUTH_ALLOW_GUEST_SESSIONS=true | Lets the app create a guest session (`POST /v1/guest-sessions`) with no account. |
| PILOT_DEV_SIMULATION=0 | Keeps the development-only simulation routes unmounted. Testers do not need them, and the backend refuses to start with this set to 1 when `APP_ENV=production`. |
| COMMAND_MOCK_ALERTS_ENABLED=1 | Lets the dashboard create mock disasters that send test warnings to phones near them. |

Apply the change by recreating the services. `dc` is the deployment command defined in section 10; on a first install, finish sections 10–12 before running this:

~~~bash
dc up -d --force-recreate --wait backend hazard-worker dashboard
~~~

### Return to production

~~~dotenv
# backend/.env
APP_ENV=production
AUTH_ALLOW_GUEST_SESSIONS=false
PILOT_DEV_SIMULATION=0

# .env
COMMAND_MOCK_ALERTS_ENABLED=0
~~~

Then run the same `dc up -d --force-recreate --wait backend hazard-worker dashboard` command. Also restore the dashboard allowlist if you opened it (section 14).

## 10. Add a VPS Compose override

The existing root Compose publishes database and Redis ports. The override below removes those bindings and binds the application ports to localhost.

Docker-published ports can bypass UFW, so configure these bindings in Compose rather than relying only on the firewall. See [Docker firewall limitations](https://docs.docker.com/engine/install/ubuntu/#firewall-limitations).

**Run on the VPS:**

~~~bash
cat > docker-compose.vps.yml <<'EOF'
services:
  backend:
    restart: unless-stopped
    ports: !override
      - "127.0.0.1:8000:8000"
    environment:
      FORWARDED_ALLOW_IPS: ${TRUSTED_PROXY_IP:-127.0.0.1}

  dashboard:
    ports: !override
      - "127.0.0.1:8080:8080"

  postgres:
    restart: unless-stopped
    ports: !reset []

  redis:
    restart: unless-stopped
    ports: !reset []

  valhalla:
    image: ghcr.io/interline-io/valhalla-docker/valhalla@sha256:b2fb6ec82d46dfb98e898e5cf247155a16f28454c72b7ba26cc6f61e17171b06
    entrypoint: []
    restart: unless-stopped
EOF
~~~

The pinned Valhalla image is the image that worked on the author's machine; its registry manifest was checked. It differs from the image named in the base Compose file. The override retains the base command, volume and health check while clearing the image's default entrypoint.

The `offline-worker` service (Compose profile `offline`) is **not part of this deployment**. The `dc` function below does not enable that profile. To build signed offline region packages, follow [OFFLINE_NAVIGATION.md](OFFLINE_NAVIGATION.md).

### Define the deployment command

~~~bash
dc() {
  docker compose -p evacuaid \
    -f docker-compose.yml \
    -f docker-compose.vps.yml \
    --profile routing \
    --profile hazards \
    "$@"
}

dc config --quiet
~~~

Use this dc function for deployment commands. It consistently selects the root stack, production override, project name and service profiles.

**In a new SSH session, enter /opt/evacuaid and define the function again.** Running plain docker compose up would omit the production override.

## 11. Restore the database and routing tiles

### Start PostgreSQL and Redis

~~~bash
dc up -d --wait postgres redis
dc cp evacuaid.dump postgres:/tmp/evacuaid.dump
~~~

PostgreSQL's health check allows a start period of up to 300 seconds, so this step can take a few minutes the first time. That is normal.

### Restore the fresh database

~~~bash
dc exec -T postgres sh -c \
  'pg_restore --exit-on-error --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB" /tmp/evacuaid.dump'
~~~

Run the initial restore **once into the fresh VPS database**. If it fails, inspect the error before proceeding. Rerunning against populated tables will produce conflicts.

### Restore the routing volume

~~~bash
docker volume create evacuaid_valhalla_tiles

docker run --rm \
  -v evacuaid_valhalla_tiles:/tiles \
  -v "$PWD:/backup:ro" \
  alpine:3.22 \
  sh -c 'tar -xzf /backup/valhalla-tiles.tgz -C /tiles'
~~~

The volume name matches the fixed Compose project name evacuaid. The routing service mounts it read-only.

## 12. Configure proxy trust and start the services

Caddy on the VPS will connect to the backend through the Docker network gateway. Trust that address so authentication rate limits receive each client's actual IP.

~~~bash
gateway_ip=$(docker network inspect evacuaid_default \
  --format '{{(index .IPAM.Config 0).Gateway}}')

printf '\nTRUSTED_PROXY_IP=127.0.0.1,%s\n' "$gateway_ip" >> .env
~~~

Uvicorn reads FORWARDED_ALLOW_IPS for trusted proxy headers. See [Uvicorn settings](https://www.uvicorn.org/settings/).

If you later recreate the Docker network with a different gateway, update this root environment setting and recreate the backend.

Build all services that use your backend code or the dashboard:

~~~bash
dc build backend dashboard hazard-worker
~~~

The dashboard image has two stages: a Node stage runs `npm ci && npm run build` for the React app, and the result is copied into the small Python server image. The **first build is slower** than the others, and needs internet access to download npm packages.

Start the application:

~~~bash
dc up -d --wait --wait-timeout 300 \
  valhalla backend dashboard hazard-worker
~~~

The backend container first runs `alembic -c /app/testocando/alembic.ini upgrade head`, then starts `uvicorn command.main:app`. That Alembic configuration merges the backend migrations and the command-center migrations, so citizen routes and command routes share one application and every new migration is applied automatically on each `up`. The backend health check allows a 120 second start period for this.

Check the services:

~~~bash
dc ps
curl -f http://127.0.0.1:8000/health
curl -f http://127.0.0.1:8080/health

dc exec -T valhalla \
  wget -qO- http://localhost:8002/status

dc exec -T backend python -m command.cli refresh
~~~

If a service fails:

~~~bash
dc logs --tail=100 backend dashboard valhalla hazard-worker
~~~

The backend refreshes command snapshots periodically. Missing evidence remains UNKNOWN; deployment does not invent operational data.

## 13. Install Caddy

Caddy provides HTTPS and routes each domain to its application.

**Run on the VPS:**

~~~bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https

curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
  | gpg --dearmor \
    -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg

curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
  > /etc/apt/sources.list.d/caddy-stable.list

chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
chmod o+r /etc/apt/sources.list.d/caddy-stable.list

apt update
apt install -y caddy
~~~

Source: [Caddy installation documentation](https://caddyserver.com/docs/install#debian-ubuntu-raspbian).

## 14. Configure HTTPS and dashboard access

Find your current public IPv4 address **on your Mac**:

~~~bash
curl -4 https://api.ipify.org
~~~

This is YOUR_PUBLIC_IP, not your VPS IP or your Mac's private LAN address.

**On the VPS:**

~~~bash
nano /etc/caddy/Caddyfile
~~~

Replace its contents with the following. Substitute your domains, email and trusted public IP:

~~~caddyfile
{
    email you@example.com
}

api.example.com {
    @blockedCommand {
        path /v1/command /v1/command/*
        not remote_ip YOUR_PUBLIC_IP/32
    }

    respond @blockedCommand "Government access is restricted." 403
    reverse_proxy 127.0.0.1:8000
}

dashboard.example.com {
    @blocked {
        not remote_ip YOUR_PUBLIC_IP/32
    }

    respond @blocked "Dashboard access is restricted." 403
    reverse_proxy 127.0.0.1:8080
}
~~~

This is the access model:

- The dashboard has no login of its own.
- The command API needs `COMMAND_API_KEY`. The dashboard server adds it on the server side, so people who can open the dashboard never see the key.
- Caddy adds an IP allowlist on top, on **both** the dashboard host and the direct command API path of the backend host.

For multiple government offices, list their real public addresses on **both** allowlist lines:

~~~caddyfile
not remote_ip 203.0.113.10/32 198.51.100.20/32
~~~

These are example addresses. A stable office IP or a managed VPN access design works better than frequently changing home/mobile addresses. If an allowed address changes, update the allowlists.

Source: [Caddy IP matchers](https://caddyserver.com/docs/caddyfile/matchers#remote-ip).

### Public demo dashboard (optional)

So judges can open the dashboard from anywhere, remove the allowlist from the **dashboard host only**:

~~~caddyfile
dashboard.example.com {
    reverse_proxy 127.0.0.1:8080
}
~~~

Keep the allowlist on `api.example.com`'s `/v1/command` path, and keep `COMMAND_API_KEY` in the root `.env`. The dashboard server still adds the key; the key is never sent to browsers.

> **Warning.** With a public dashboard, anyone who has the URL can review field reports, dispatch assistance, publish and withdraw routes, and create mock disasters that send warnings to test phones near the disaster. The API key does not prevent this, because the dashboard server uses it on the visitor's behalf. Share the URL only with people you trust, and **restore the allowlist as soon as the demo ends** (then run `systemctl reload caddy`).

Save and validate:

~~~bash
caddy validate --config /etc/caddy/Caddyfile
~~~

If validation succeeds:

~~~bash
systemctl enable caddy
systemctl restart caddy
journalctl -u caddy -n 50 --no-pager
~~~

Caddy obtains and renews certificates automatically when DNS and network access are correct. See [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https).

## 15. Verify the live deployment

**Run on your Mac from an allowed network:**

~~~bash
curl -i https://api.example.com/health
curl -i https://dashboard.example.com/health
curl -i https://api.example.com/v1/auth/me
~~~

Expected results:

| Request | Expected |
| --- | --- |
| Backend health | HTTP 200 |
| Dashboard health from an allowed IP | HTTP 200 |
| Auth me without a bearer token | HTTP 401 |
| Command API from a disallowed IP | HTTP 403 |
| Dashboard from a disallowed IP | HTTP 403 (HTTP 200 if you chose the public demo variant) |

Open the dashboard:

~~~text
https://dashboard.example.com/command-center/
~~~

Confirm that:

- Regions and safe houses match the local database export.
- The map shows (this needs `MAPBOX_TOKEN`) and supports normal interaction.
- Mock mode and mock records are visibly marked as simulation.
- Missing operational evidence is shown as UNKNOWN.

A VPS with no suitable routing tiles cannot provide real road routes. Test a known route inside the transferred tile coverage through the app as part of your deployment check.

### Check internal ports are not public

**On your Mac:**

~~~bash
for port in 8000 8080 5432 6379 8002; do nc -vz -G 5 VPS_IP $port; done
~~~

Each should time out or be refused. Public application traffic goes through HTTPS on port 443.

## 16. Connect the phone app

The phone app is not hosted on the VPS. The team, or a tester, builds the iOS app on a Mac with these values in `frontend/.env`:

| Variable | Value |
| --- | --- |
| EXPO_PUBLIC_API_BASE_URL | `https://api.example.com`. It must be **HTTPS**: the iOS app only allows plain HTTP to local network addresses. |
| EXPO_PUBLIC_MAPBOX_TOKEN | A public `pk.` Mapbox token for the app map. |
| EXPO_PUBLIC_MAPBOX_STYLE_URL | Optional Mapbox Studio style URL. |
| EXPO_PUBLIC_OFFLINE_KEY_ID | Only for offline packages: the key id, matching the server's `OFFLINE_SIGNING_KEY_ID`. |
| EXPO_PUBLIC_OFFLINE_PUBLIC_KEY | Only for offline packages: the public half of the server's signing key. |

These values are baked into the JavaScript bundle. A development build reads them when Metro starts, so after changing them restart with:

~~~bash
cd ~/code/EvacuAid/frontend
npm start -- --clear
~~~

A Release build reads them at build time, so **changing the API URL means rebuilding and reinstalling a Release app**. Editing the file does not update an app that is already installed. If the app was built earlier against a local HTTP address, run `npx expo prebuild -p ios --clean` before rebuilding, because the local-network exception is generated at that step.

To install the app on an iPhone, follow the "Install on an iPhone" section of [README.md](README.md). It already points at the hosted API; change `EXPO_PUBLIC_API_BASE_URL` there if your VPS uses a different domain.

Test registration or login, profile loading, logout, and login again. In demo mode, test guest sign-in instead.

| Client | Production endpoint |
| --- | --- |
| Phone app | https://api.example.com |
| Government dashboard | https://dashboard.example.com/command-center/ |
| Database | Shared VPS PostGIS database |
| Routing | Shared internal Valhalla service |

## 17. Bootstrap an admin if needed

The dashboard has no admin login; it relies on the command API key and the Caddy allowlist (section 14).

For protected administrative app APIs, first register your operator account normally through the phone app. Then promote that existing account from the trusted VPS shell:

~~~bash
cd /opt/evacuaid
dc exec backend python -m app.authCli bootstrap-admin \
  --email operator@example.com
~~~

Replace the email with the registered operator's email. Bootstrap refuses once any admin already exists, including an admin restored from your local database.

See [backend/AUTHENTICATION.md](backend/AUTHENTICATION.md) for the account API and role-assignment contract.

## 18. Back up production data

**On the VPS, with dc defined:**

~~~bash
mkdir -p /opt/evacuaid-backups
chmod 700 /opt/evacuaid-backups
umask 077

dc exec -T postgres sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl -Fc' \
  > "/opt/evacuaid-backups/evacuaid-$(date +%F-%H%M%S).dump"
~~~

Download backups to another machine or use your provider's backup storage. A backup kept only on the same VPS does not survive loss of that VPS.

Also preserve:

- Root and backend environment files, stored privately.
- Backend data assets, including the DEM and its provenance manifest.
- Routing tiles.
- docker-compose.vps.yml and the Caddyfile.

Set up a recurring backup schedule before relying on production records. The command above is a manual backup; it does not install a scheduler.

**Do not run docker compose down -v on production.** It removes named volumes, including your database and routing tiles.

## 19. Update an existing VPS

Use this for a VPS that already runs an older EvacuAid, and for every later code update. It keeps your database, tiles and environment files. An older deployment may lack the Buddy beacon routes and have guest sessions disabled; this procedure fixes both.

1. **Back up the database first.** Follow section 18 and download the dump.

2. **Upload the new source.** Either option works.

   *Option A: upload from your Mac.* Deploy only committed code: check out the branch you want and make sure `git status` shows no changes, otherwise unfinished local work is uploaded too. Then package a code-only update, excluding production data and environment files:

   ~~~bash
   cd ~/code/EvacuAid
   deployBundle=$(mktemp -d)

   COPYFILE_DISABLE=1 tar \
     --exclude=".git" --exclude=".env" --exclude=".venv" --exclude="venv" \
     --exclude="node_modules" --exclude=".DS_Store" --exclude="__pycache__" \
     --exclude=".pytest_cache" --exclude="backend/data" \
     --exclude="testocando/mapshit/dashboard/output" \
     --exclude="testocando/mapshit/dashboard/test-results" \
     --exclude="frontend/ios" --exclude="frontend/android" \
     -czf "$deployBundle/source-update.tgz" docker-compose.yml backend testocando

   scp "$deployBundle/source-update.tgz" root@VPS_IP:/opt/evacuaid/
   ~~~

   Then on the VPS:

   ~~~bash
   cd /opt/evacuaid
   tar -xzf source-update.tgz
   ~~~

   Extracting over the old tree does not delete files that were removed from the repository. That is harmless for the build; remove them by hand if you want an exact copy.

   *Option B: `git pull` on the VPS.* Only if `/opt/evacuaid` is a Git clone:

   ~~~bash
   cd /opt/evacuaid
   git pull
   ~~~

3. **Update the environment files.** Compare against sections 8 and 9: add `MAPBOX_TOKEN`, `MAPBOX_STYLE` and `COMMAND_MOCK_ALERTS_ENABLED` to `/opt/evacuaid/.env`, and the demo-mode settings to `backend/.env` if testers need guest sign-in. Compare `backend/.env` with `backend/.env.example` for other new variables.

4. **Rebuild and restart** with the `dc` function from section 10:

   ~~~bash
   cd /opt/evacuaid
   dc config --quiet
   dc build backend dashboard hazard-worker
   dc up -d --wait --wait-timeout 300 \
     backend dashboard hazard-worker
   ~~~

   Rebuild hazard-worker too: Compose gives it its own image even though it uses the backend build context. Migrations, including the Buddy beacon migration (`20261013_17_buddy_beacons.py`), run automatically when the backend starts (section 12).

5. **Smoke checks** from your Mac:

   ~~~bash
   curl https://api.example.com/health
   curl -i -X POST https://api.example.com/v1/guest-sessions -H 'content-type: application/json' -d '{}'
   curl -s https://api.example.com/openapi.json | grep -o '/v1/buddy/nearby/beacons'
   ~~~

   - `/health` should report `database`, `redis` and `valhalla` as `healthy`.
   - The guest session request should return `201` in demo mode. In production mode it is refused; that is correct.
   - The `openapi.json` check should print `/v1/buddy/nearby/beacons`, the Buddy beacon route.
   - Open `https://dashboard.example.com/command-center/` (from an allowed IP, or anywhere if public). The map should show, and a mock disaster should be creatable when `COMMAND_MOCK_ALERTS_ENABLED=1`.

Also check on the VPS:

~~~bash
dc ps
curl -f http://127.0.0.1:8000/health
curl -f http://127.0.0.1:8080/health
~~~

Keep a previous source archive and database backup for recovery. An application downgrade after a schema migration needs a migration-specific recovery plan.

## 20. Troubleshooting

| Symptom | Check |
| --- | --- |
| SSH connection fails | VPS IP, provider SSH username, key selection, SSH port and provider firewall |
| HTTPS certificate fails | Both domains resolve to the VPS, ports 80/443 are open, no incorrect AAAA record |
| Caddy returns 502 | dc ps, application health checks and backend/dashboard logs |
| Dashboard returns 403 | Current public client IP is on both allowlists; DNS is in DNS-only mode |
| Dashboard has no regions | Database restore succeeded; run the command snapshot refresh |
| Dashboard shows UNKNOWN | Check actual provider/operational evidence; do not replace missing evidence with fabricated values |
| Routing is unavailable | Valhalla status, restored tile volume and requested location coverage |
| Backend will not start | JWT secret, production flags, database connectivity and migration logs |
| Everyone hits login rate limits | Trusted proxy gateway is correct and backend was recreated after its environment changed |
| Phone still contacts the LAN backend | Production API URL, Expo cache restart, or rebuilding the installed app |
| Provider remains unavailable | Provider credentials, network reachability and hazard-worker logs |
| Guest sign-in refused | Section 9: `AUTH_ALLOW_GUEST_SESSIONS=true` with `APP_ENV=development`, and the backend was recreated |
| Dashboard map is blank | `MAPBOX_TOKEN` in the root `.env` starts with `pk.`; recreate the dashboard |
| Mock disaster returns 403 | `COMMAND_MOCK_ALERTS_ENABLED=1` in the root `.env`; recreate the backend |

Useful server commands:

~~~bash
cd /opt/evacuaid
dc ps
dc logs --tail=100 backend
dc logs --tail=100 dashboard
dc logs --tail=100 hazard-worker
dc logs --tail=100 valhalla
journalctl -u caddy -n 100 --no-pager
df -h
free -h
~~~

After changing Caddy allowlists:

~~~bash
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
~~~

After changing backend environment settings:

~~~bash
dc up -d --force-recreate --wait backend hazard-worker
~~~

After a VPS reboot, Docker and Caddy should start automatically and the services should restart under their restart policies. Recheck service health and the live URLs.


## Related docs

- [README.md](README.md): project overview and installing the app on an iPhone.
- [FIELD_OPERATIONS.md](FIELD_OPERATIONS.md): operating the system in the field.
- [OFFLINE_NAVIGATION.md](OFFLINE_NAVIGATION.md): building signed offline region packages.
- [testocando/README.md](testocando/README.md): the command center and dashboard.
- [backend/AUTHENTICATION.md](backend/AUTHENTICATION.md): accounts, tokens and roles.
