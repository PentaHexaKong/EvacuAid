# App authentication

Backend implementation only: the phone frontend is unchanged and still needs register/login/token-storage screens. Account credentials extend the existing `users` row, preferences and accessibility records. Roles do not represent accessibility needs.

The government dashboard remains instant-access by explicit project decision. `/v1/command/*`, dashboard simulation and safe-house management retain their existing public access. These routes are an intentional exception to role-gating, not evidence of a protected government deployment. Put the dashboard behind trusted network access before exposing its write features publicly.

## JSON contract

All requests use `Content-Type: application/json`. Account auth follows the existing session API's snake_case fields. No auth cookies are created or accepted. Auth responses, including errors, have `Cache-Control: no-store`.

`POST /v1/auth/register` returns 201:

```json
{"email":"citizen@example.com","password":"a-long-example-password","name":"Dwi","accessibility":[{"type":"BLIND"},{"type":"IMMOBILE"}]}
```

Email is trimmed, validated and case-folded; passwords are 12–128 characters (login accepts 1–128 to give generic failures for incorrect passwords). Name and accessibility are optional. Public registration always creates a CITIZEN. Unknown fields, including `role`, are rejected. Duplicate registration returns generic 409; incorrect/unknown login returns identical 401. Registration conflicts still reveal that registration was unsuccessful; no verification-email flow is included.

`POST /v1/auth/login` returns 200:

```json
{"email":"citizen@example.com","password":"a-long-example-password"}
```

Register, login and refresh return:

```json
{
  "access_token":"<signed JWT>",
  "token_type":"bearer",
  "expires_in":900,
  "refresh_token":"<opaque secret>",
  "refresh_expires_in":2592000,
  "user":{"id":"<existing UUID>","email":"citizen@example.com","name":"Dwi","role":"CITIZEN"}
}
```

`refresh_expires_in` is remaining seconds, rounded down. `POST /v1/auth/refresh` accepts `{"refresh_token":"<current opaque secret>"}` and returns a new pair. Replace both stored tokens atomically. Refresh expiry is absolute from login/registration, not extended by rotation. Never send concurrent refresh requests: reuse, including a concurrent duplicate or retry of an already-consumed token, revokes the entire family and requires login. Separate logins have separate families. Only SHA-256 hashes of high-entropy refresh secrets are stored. Family locks are transaction-wide PostgreSQL advisory locks across workers.

`POST /v1/auth/logout` accepts the same refresh JSON and returns 204 without a body, including for unknown tokens. It revokes that refresh family; already issued access JWTs remain valid until their short expiry. Erase tokens client-side immediately. An old consumed refresh token can also revoke its family.

`GET /v1/auth/me` with `Authorization: Bearer <access_token>` returns `user` above. Existing `GET /v1/me` retains its profile response; it never returns hashes, refresh records or role authority. Other protected app routes use the same access header.

JWTs use HS256 only, require issuer, audience, expiry, issued-at, not-before, UUID subject, token type and token ID. Roles are read from PostgreSQL each request, rather than trusting client payloads or token role claims. Passwords use Argon2id through [argon2-cffi](https://argon2-cffi.readthedocs.io/en/stable/api.html); JWT validation uses [PyJWT](https://pyjwt.readthedocs.io/en/stable/usage.html). Hash/verify work runs outside the event loop with two simultaneous operations per process.

Validation errors on authentication routes strip input values. Do not add request-body, Authorization-header or token logging at the proxy, middleware or tracing layer. Never put tokens in query parameters.

## Identity and accessibility compatibility

An existing unexpired guest bearer can be supplied to registration to upgrade that exact User UUID atomically, including in production migration. The bearer proves ownership; arbitrary `userId` is rejected. Existing preferences, buddy relationships, assistance and omitted accessibility/name fields are preserved. Upgrade removes the legacy guest token. Guests cannot obtain privileged roles.

Ordinary guest creation/authentication is disabled by default. Development tests/demo builds must explicitly set `APP_ENV=development` or `test` and `AUTH_ALLOW_GUEST_SESSIONS=true`; guest tokens expire after one day. Production startup rejects guest enablement or `PILOT_DEV_SIMULATION=1`. Account tokens cannot delete accounts through the old guest-deletion route.

Canonical accessibility remains `VISUAL_IMPAIRMENT`, `HEARING_IMPAIRMENT`, `MOBILITY_LIMITATION`, `ELDERLY`, `OTHER`. Input aliases BLIND, DEAF and IMMOBILE map to the first three appropriate canonical values; responses/storage are canonical. Arrays preserve multiple distinct attributes. Duplicate aliases of the same attribute are rejected.

## Permissions

| Resource | CITIZEN | RESPONDER | GOVERNMENT | ADMIN |
|---|---|---|---|---|
| Own profile, preferences, accessibility, location, context, alerts | Own only | Own only | Own only | Own only |
| Buddy requests, messages, location/contact sharing | Participant or authorized offer, existing consent rules | Assigned participant or authorized offer | Participant or authorized offer | Participant or authorized offer |
| Other citizens' profiles/PII | Denied | Denied | Denied | Denied |
| Account role assignment | Denied | Denied | Denied | Allowed |
| External provider sync POST | Denied | Denied | Denied | Allowed |
| Public reference maps, navigation preview, nearby shelters, health | Public | Public | Public | Public |
| Command aggregates/dashboard simulation/safe houses | Public by project decision | Public | Public | Public |

Role does not bypass resource ownership or create operational assignment. Context is bound to the authenticated actor; a supplied `userId` query cannot switch identity. Existing Buddy case dependencies require participation/active offers and connected state for private sharing. Internal workers call services directly and do not need public-route credentials.

`PATCH /v1/auth/users/{userId}/role` accepts `{"role":"RESPONDER"}` (or other defined role) and returns only `{"id":"<UUID>","role":"RESPONDER"}`. It requires an existing authenticated ADMIN, rejects guest targets, and prevents removing the last admin. Changes apply to existing JWTs on their next request.

To bootstrap the first admin, first register the operator through normal registration. From a trusted server shell run `python -m app.authCli bootstrap-admin --email operator@example.com`. It promotes an existing account only and refuses once any admin exists. Database access is the out-of-band trust boundary; no default operator password or public bootstrap endpoint exists.

## Configuration and running

Environment variable names: `DATABASE_URL`, `REDIS_URL`, `APP_ENV`, `AUTH_JWT_SECRET`, `AUTH_JWT_ISSUER`, `AUTH_JWT_AUDIENCE`, `AUTH_ACCESS_TOKEN_SECONDS`, `AUTH_REFRESH_TOKEN_DAYS`, `AUTH_ALLOW_GUEST_SESSIONS`, `CORS_ALLOWED_ORIGINS`, `PILOT_DEV_SIMULATION`.

Set a randomly generated signing secret of at least 32 bytes in ignored `backend/.env` or your secret manager. There is no fallback secret. Startup fails if missing/too short. Defaults are production environment, 900-second access, 30-day refresh, issuer evacuaid and audience evacuaid-app. Allowed access lifetime is 60–1800 seconds and refresh lifetime 1–90 days. Rotating the signing secret invalidates existing access tokens; refresh sessions can still issue tokens using the new key.

`CORS_ALLOWED_ORIGINS` is a comma-separated list of exact HTTP(S) origins with no trailing path. Empty disables cross-origin browser access. Wildcards are rejected; credentialed cookies are disabled. Native mobile requests do not need CORS. Rate limits use shared PostgreSQL fixed 60-second windows: registration 10/IP, login 20/IP plus 5/email, refresh 60/IP, logout 60/IP. 429 includes `Retry-After`; authentication failures count. The app uses the ASGI client address, so configure a trusted proxy allowlist; do not trust arbitrary forwarded headers. Edge request-size and malformed-request limits should complement these validated-request limits.

Native clients should store refresh tokens in OS-backed secure storage and keep access tokens in memory. Browser clients should use a same-origin server/BFF with HttpOnly Secure SameSite cookies, explicit CSRF protection and server-side refresh storage; this backend contract itself uses JSON only. Do not store refresh secrets in browser localStorage, URLs or logs. Serve remotely over HTTPS. Email verification, password reset and MFA are outside this implementation.

From the repository root, after setting the environment:

```powershell
docker compose build backend
docker compose run --rm --no-deps backend alembic -c /app/testocando/alembic.ini upgrade head
docker compose up -d backend dashboard
docker compose exec backend python -m app.authCli bootstrap-admin --email operator@example.com
```

The root stack continues sharing one backend/database/Redis with the dashboard and app. Root combined migration head is `20261010_15_auth_merge`; backend-only revision is `20261010_14_auth` (parent `20261010_12`). Upgrade adds fields/tables and expires legacy sessions without recreating users. Downgrade intentionally removes auth credentials/session records while preserving existing users/profiles; it is not a way to preserve login credentials.

For a backend-only local process:

```powershell
cd backend
python -m pip install -r requirements.txt
alembic upgrade head
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Run all backend and command regressions against the dedicated, temporary test database:

```powershell
docker compose -p evacuaid-auth-test -f testocando/docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from tests
docker compose -p evacuaid-auth-test -f testocando/docker-compose.test.yml down
```

For a focused auth rerun with that test database running:

```powershell
docker compose -p evacuaid-auth-test -f testocando/docker-compose.test.yml run --rm tests sh -c 'alembic -c ../testocando/alembic.ini upgrade head && pytest -p no:cacheprovider tests/test_auth.py -q'
```

## Changed files and verification

New files: `app/authConfig.py`, `app/authCli.py`, `app/models/auth.py`, `app/db/models/auth.py`, `app/services/authService.py`, `app/services/authRateLimit.py`, `app/routers/auth.py`, `tests/test_auth.py`, `alembic/versions/20261010_14_auth.py`, this guide, and `../testocando/command/migrations/versions/20261010_15_auth_merge.py`.

Modified backend files: `app/auth.py`, `app/main.py`, `app/db/models/{__init__,user,session}.py`, `app/models/user.py`, `app/routers/{users,sessions,buddy_dev,externalData}.py`, `tests/{conftest,test_migration_roundtrip}.py`, `requirements.txt`, `.env.example`. Also changed root `.gitignore` to retain this guide and `../testocando/docker-compose.test.yml` to explicitly configure test authentication. Ignored local `.env` was configured with a generated signing secret; no secret value is documented. No frontend files changed.

The full backend plus command regression run passed **315 tests** on the dedicated PostGIS test database, including JWT failures, Argon2id storage, duplicate registration rollback, refresh rotation/replay/concurrency, logout, ownership and assigned-case denial, admin assignment/bootstrap, accessibility aliases, rate limits and migration profile preservation. Existing deprecation warnings from pytest-asyncio/Python, Shapely and Alembic remain. `git diff --check` passed.

Live root Compose verification also passed after rebuilding/restarting the shared backend: registration 201, login/me/profile reads 200, refresh rotation 200, replay and descendant refresh rejection 401, logout 204, and access JWT remaining valid until expiry. The temporary verification account was removed. Unauthenticated auth/me returned 401, production guest creation returned 404, and both `/command-center/` on port 8080 and public command regions returned 200. Backend and dashboard health checks passed; the running combined migration is `20261010_15_auth_merge`.

Operational limitations: refresh records retain replay tombstones; schedule retention cleanup after family expiry as data grows. Rate-limiter buckets clean expired records on subsequent auth activity. There is no email verification, password reset or MFA; these must be designed before broader account rollout. App frontend login integration and physical-phone testing remain pending because this task prohibits frontend changes.
