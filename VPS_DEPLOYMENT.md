# EvacuAid VPS deployment

Deploy the backend and government dashboard together using the existing **root Docker Compose stack**. The phone app connects to the same backend over HTTPS.

This guide transfers the current Windows working copy, database, backend data assets and Valhalla routing tiles to a **new VPS**. It preserves your existing regions, accounts and safe houses.

The instructions assume:

- Ubuntu 24.04 LTS on an **x86_64 / AMD64** VPS.
- A domain with access to its DNS settings.
- Docker Desktop running on your Windows PC.
- Your local EvacuAid services running before you export their data.
- A fresh VPS database for the initial restore.

The Compose override was checked locally. These instructions have not been executed against your VPS.

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
| dashboard | Government dashboard and its API proxy | Through Caddy, trusted IPs |
| postgres | Shared PostGIS database | Internal Docker network |
| redis | Shared cache | Internal Docker network |
| valhalla | Road routing using existing tiles | Internal Docker network |
| hazard-worker | Background hazard provider ingestion | Internal Docker network |

The dashboard currently allows instant access, including mock-disaster and safe-house writes. This guide keeps instant access **from trusted IP addresses**. The phone API remains publicly reachable with its existing account authentication.

## 2. Create an SSH key on Windows

**Run on your Windows PC in PowerShell.**

If you already have an SSH key, reuse its public key. Otherwise:

~~~powershell
ssh-keygen -t ed25519
~~~

Accept the suggested path unless you need another key location. Do not overwrite an existing key you still use.

Display your public key:

~~~powershell
Get-Content "$env:USERPROFILE\.ssh\id_ed25519.pub"
~~~

During VPS creation, select Ubuntu 24.04 and paste this public key into the provider's SSH-key field. Keep the private key on your PC.

## 3. Point your domains to the VPS

Create these records in your domain's DNS settings:

| Type | Name | Value |
| --- | --- | --- |
| A | api | VPS_IP |
| A | dashboard | VPS_IP |

If using Cloudflare, use **DNS-only mode** for this setup. The trusted-IP rules below assume clients connect directly to Caddy.

Only add AAAA records if you have configured working IPv6. This guide's dashboard allowlist uses IPv4.

Check resolution from Windows:

~~~powershell
Resolve-DnsName api.example.com -Type A
Resolve-DnsName dashboard.example.com -Type A
~~~

Both should resolve to your VPS IPv4 address before you configure HTTPS.

## 4. Connect and prepare the VPS

**Run on Windows:**

~~~powershell
ssh root@VPS_IP
~~~

The remaining server commands assume a root SSH session. If your provider gives you an Ubuntu account instead:

~~~powershell
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

## 6. Export the current project and data from Windows

Leave Docker Desktop and your local EvacuAid containers running. Open a **second Windows PowerShell window**.

~~~powershell
cd D:\Hackathons\EvacuAid
docker compose ps

$deployBundle = Join-Path $env:TEMP "evacuaid-deploy"
New-Item -ItemType Directory -Force -Path $deployBundle | Out-Null
~~~

### Package the source and backend assets

This packages your current working files, including changes that have not been committed to Git. It includes backend data assets and excludes local environment files and dependency directories.

~~~powershell
tar --exclude=".git" --exclude=".env" --exclude=".venv" --exclude="venv" --exclude="node_modules" --exclude="__pycache__" --exclude=".pytest_cache" -czf "$deployBundle\source.tgz" docker-compose.yml backend testocando
~~~

The native phone frontend is not hosted on the VPS, so it is not included.

### Export PostgreSQL

~~~powershell
docker compose exec -T postgres sh -c 'pg_dump -U $POSTGRES_USER -d $POSTGRES_DB --no-owner --no-acl -Fc -f /tmp/evacuaid.dump'

docker compose cp postgres:/tmp/evacuaid.dump "$deployBundle\evacuaid.dump"
~~~

The dump preserves existing accounts, regions, safe houses and dashboard records. Existing mock records retain their simulation labels.

The dump is created inside the container and copied out. This avoids binary redirection problems in older Windows PowerShell.

### Export Valhalla tiles

~~~powershell
docker compose exec -T valhalla tar -czf /tmp/valhalla-tiles.tgz -C /data/valhalla .

docker compose cp valhalla:/tmp/valhalla-tiles.tgz "$deployBundle\valhalla-tiles.tgz"
~~~

Your current routing tiles are about 1 GB before compression. Source packaging and tile export may take several minutes.

Confirm the three files exist:

~~~powershell
Get-ChildItem -LiteralPath $deployBundle
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

**On Windows:**

~~~powershell
scp "$deployBundle\source.tgz" "$deployBundle\evacuaid.dump" "$deployBundle\valhalla-tiles.tgz" root@VPS_IP:/opt/evacuaid/
~~~

**On the VPS:**

~~~bash
cd /opt/evacuaid
tar -xzf source.tgz
ls
~~~

You should see the backend and testocando directories and the root docker-compose.yml.

## 8. Create production environment files

The project uses **two different environment files**:

| File | Purpose |
| --- | --- |
| /opt/evacuaid/.env | Compose substitution, including the PostgreSQL password |
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
EOF

cp backend/.env.example backend/.env

sed -i "s/^AUTH_JWT_SECRET=.*/AUTH_JWT_SECRET=$(openssl rand -hex 32)/" backend/.env
~~~

These commands generate new secrets without printing them.

COMMAND_API_KEY is required for the dashboard to load data. Generate it with `openssl rand -hex 32` and keep it in the root .env used by Compose.
COMMAND_MOCK_ALERTS_ENABLED sends real test alerts to phones in the drawn area; set it to 1 only for a demo.
MAPBOX_TOKEN is optional. With a public `pk.` token in the root .env, the dashboard map uses Mapbox tiles; without one, it falls back to Esri tiles. The token is visible in the dashboard page, so restrict it to the dashboard's domain in your Mapbox account. MAPBOX_STYLE picks the style (default `mapbox/light-v11`).

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

If PILOT_DEV_SIMULATION is present, set it to 0. That development buddy feature is separate from the dashboard's mock mode.

To use the current DEM transferred from your PC, configure:

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

## 9. Add a VPS Compose override

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

The pinned Valhalla image is the image currently working on your PC; its registry manifest was checked. It differs from the image named in the base Compose file. The override retains the base command, volume and health check while clearing the image's default entrypoint.

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

## 10. Restore the database and routing tiles

### Start PostgreSQL and Redis

~~~bash
dc up -d --wait postgres redis
dc cp evacuaid.dump postgres:/tmp/evacuaid.dump
~~~

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

## 11. Configure proxy trust and start the services

Caddy on the VPS will connect to the backend through the Docker network gateway. Trust that address so authentication rate limits receive each client's actual IP.

~~~bash
gateway_ip=$(docker network inspect evacuaid_default \
  --format '{{(index .IPAM.Config 0).Gateway}}')

printf '\nTRUSTED_PROXY_IP=127.0.0.1,%s\n' "$gateway_ip" >> .env
~~~

Uvicorn reads FORWARDED_ALLOW_IPS for trusted proxy headers. See [Uvicorn settings](https://www.uvicorn.org/settings/).

If you later recreate the Docker network with a different gateway, update this root environment setting and recreate the backend.

Build all services that use your backend code:

~~~bash
dc build backend dashboard hazard-worker
~~~

Start the application:

~~~bash
dc up -d --wait --wait-timeout 300 \
  valhalla backend dashboard hazard-worker
~~~

The backend's existing startup command runs the combined backend and command-center Alembic migrations automatically. It starts command.main:app so citizen routes and command routes use the same application.

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

## 12. Install Caddy

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

## 13. Configure HTTPS and instant dashboard access

Find your current public IPv4 address **on Windows**:

~~~powershell
curl.exe -4 https://api.ipify.org
~~~

This is YOUR_PUBLIC_IP, not your VPS IP or your PC's private LAN address.

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

This protects both ways of reaching command features: the dashboard proxy and the backend's direct command API.

For multiple government offices, list their real public addresses on **both** allowlist lines:

~~~caddyfile
not remote_ip 203.0.113.10/32 198.51.100.20/32
~~~

These are example addresses. A stable office IP or a managed VPN access design works better than frequently changing home/mobile addresses. If an allowed address changes, update the allowlists.

Source: [Caddy IP matchers](https://caddyserver.com/docs/caddyfile/matchers#remote-ip).

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

## 14. Verify the live deployment

**Run on Windows from an allowed network:**

~~~powershell
curl.exe -i https://api.example.com/health
curl.exe -i https://dashboard.example.com/health
curl.exe -i https://api.example.com/v1/auth/me
~~~

Expected results:

| Request | Expected |
| --- | --- |
| Backend health | HTTP 200 |
| Dashboard health from an allowed IP | HTTP 200 |
| Auth me without a bearer token | HTTP 401 |
| Command API from a disallowed IP | HTTP 403 |
| Dashboard from a disallowed IP | HTTP 403 |

Open the dashboard:

~~~text
https://dashboard.example.com/command-center/
~~~

Confirm that:

- Regions and safe houses match the local database export.
- The map supports normal interaction.
- Mock mode and mock records are visibly marked as simulation.
- Missing operational evidence is shown as UNKNOWN.

A VPS with no suitable routing tiles cannot provide real road routes. Test a known route inside the transferred tile coverage through the app as part of your deployment check.

### Check internal ports are not public

**On Windows:**

~~~powershell
Test-NetConnection VPS_IP -Port 8000
Test-NetConnection VPS_IP -Port 8080
Test-NetConnection VPS_IP -Port 5432
Test-NetConnection VPS_IP -Port 6379
Test-NetConnection VPS_IP -Port 8002
~~~

Each should show TcpTestSucceeded as False. Public application traffic goes through HTTPS on port 443.

## 15. Connect the phone app

**On Windows**, edit:

~~~text
D:\Hackathons\EvacuAid\frontend\.env
~~~

Set:

~~~dotenv
EXPO_PUBLIC_API_BASE_URL=https://api.example.com
~~~

Restart Expo:

~~~powershell
cd D:\Hackathons\EvacuAid\frontend
npm start -- --clear
~~~

Test registration or login, profile loading, logout, and login again.

For an installed production app, rebuild and distribute the app with this production URL. Changing your local environment file does not update an already-installed build.

| Client | Production endpoint |
| --- | --- |
| Phone app | https://api.example.com |
| Government dashboard | https://dashboard.example.com/command-center/ |
| Database | Shared VPS PostGIS database |
| Routing | Shared internal Valhalla service |

## 16. Bootstrap an admin if needed

The dashboard does not require an admin login under the existing instant-access policy.

For protected administrative app APIs, first register your operator account normally through the phone app. Then promote that existing account from the trusted VPS shell:

~~~bash
cd /opt/evacuaid
dc exec backend python -m app.authCli bootstrap-admin \
  --email operator@example.com
~~~

Replace the email with the registered operator's email. Bootstrap refuses once any admin already exists, including an admin restored from your local database.

See backend/AUTHENTICATION.md for the account API and role-assignment contract.

## 17. Back up production data

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

## 18. Deploy later code updates

Back up the production database first.

Package a code-only update **on Windows**, excluding production data and environment files:

~~~powershell
cd D:\Hackathons\EvacuAid

tar --exclude=".git" --exclude=".env" --exclude=".venv" --exclude="venv" --exclude="node_modules" --exclude="__pycache__" --exclude=".pytest_cache" --exclude="backend/data" -czf "$deployBundle\source-update.tgz" docker-compose.yml backend testocando

scp "$deployBundle\source-update.tgz" root@VPS_IP:/opt/evacuaid/
~~~

If this is a new PowerShell session, define deployBundle again using the command from step 6.

**On the VPS:**

~~~bash
cd /opt/evacuaid
tar -xzf source-update.tgz

dc config --quiet
dc build backend dashboard hazard-worker
dc up -d --wait --wait-timeout 300 \
  backend dashboard hazard-worker

dc ps
curl -f http://127.0.0.1:8000/health
curl -f http://127.0.0.1:8080/health
~~~

Rebuild hazard-worker too: Compose gives it its own image even though it uses the backend build context.

Keep a previous source archive and database backup for recovery. An application downgrade after a schema migration needs a migration-specific recovery plan.

## 19. Troubleshooting

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
