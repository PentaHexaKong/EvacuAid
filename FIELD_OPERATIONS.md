# Field reporting and government operations

The phone, command dashboard and workers use the same FastAPI/PostGIS stack. No additional application server or database is introduced.

## Phone

Open **Discover → Field reports & evacuation updates**, or the same entry in **Profile**.

- Report blocked roads, inaccessible routes, flooding, damaged infrastructure, crowding observations, or another barrier.
- Choose the public incident coordinates manually or through GPS. Consent is required before sharing the location and description. Exclude names, phone numbers and private-home information.
- A report starts UNVERIFIED. Government review results appear under My submitted reports.
- Reports/check-ins are stored in an application-private persistent outbox before transmission. Retry uses the original submission UUID; duplicate retries cannot create duplicate records.
- Connectivity restoration, foregrounding and a 30-second retry loop retry submissions belonging to the current account. Invalid submissions remain visible for discard/replacement. Pending means the government has not acknowledged receipt.
- Existing accounts can open this screen from the account-restoration error screen when the server is unreachable. A new identity still needs an initial online sign-in/guest session.
- Choose a region and report NEEDS_ASSISTANCE, EVACUATING, ARRIVED, SAFE_REPORTED or UNKNOWN. Status is self-reported, timestamped, and aggregated anonymously; this does not initiate an assistance request or independently verify safety. Use Buddy for assistance requests.
- Published government routes can be viewed and their destination selected for navigation. Government dispatch updates and assigned routes appear under the citizen's own assistance requests. Starting navigation calculates a fresh route through the existing server policy. Cached geometry never substitutes for new offline calculation.

## Government dashboard

Open http://127.0.0.1:8080/command-center/ and use **Field operations & Route Setter**.

Operations refresh every 15 seconds while the page is visible. Regional projections retain their existing 60-second refresh. The dashboard shows observation/receipt times and retains a connection-unavailable notice on failures. An empty list means no submitted records, not an absence of disaster conditions.

1. Review field reports: show the incident location, confirm, reject, or resolve with a public review note.
2. Only explicitly verified barriers become hard routing exclusions. Enter a bounded radius and an expiry within 24 hours. Confirmation without a barrier remains an observation. Crowding observations never become closures or occupancy estimates.
3. Confirmation/resolution removes obsolete evidence and invalidates published Route Setter routes atomically. The existing multi-hazard evaluator consumes confirmed closures and unverified community observations according to their different authority levels.
4. Assistance case management lists anonymous case identifiers, reported needs, source workflow status, age, and government action. Acknowledge, dispatch, complete or cancel dispatch work; assign a current published route to a case. Expired/withdrawn routes cannot be assigned. Requesters see their own government updates and route assignment in the app. These actions do not complete Buddy sessions or assert citizen safety. Concurrent edits require a refreshed case revision.
5. Check-in totals use the most recent **observation** per citizen within 24 hours. Uploading an older offline check-in cannot overwrite a newer status. These are reported app users, not all affected people.
6. Route Setter: select a reference region, enter/pick a public assembly point, choose a recorded shelter, optionally require step-free routing, then calculate/save a draft. The assembly point must be in the selected region.
7. Edit/recalculate, revalidate/publish, or withdraw a route. Publishing performs a new calculation through the existing routing and hard-hazard/accessibility policies. Infeasible/provider-failed results cannot be published; failed revalidation invalidates a previous publication. Routes expire five minutes after evaluation. No overall real-world safety certification is provided.

Simulation mode hides live operational cases. Browser mock disasters remain local and cannot be used to publish operational routes. Dashboard access remains instant under the existing deployment access policy; the VPS guide describes the trusted-access deployment boundary.

## Shelter capacity removal

Live occupancy, FULL/AVAILABLE/NEAR_CAPACITY indicators, occupancy pressure ranking and occupancy-based route rejection are removed from active app/dashboard workflows and API exports. New package snapshots omit occupancy. Legacy package views ignore historical occupancy and normalize historical FULL to UNKNOWN.

Reference/design capacity and reported accessibility remain. OPEN/CLOSED/UNKNOWN are reported operational status, not free-bed counts. Old occupancy database values remain historical storage only; this change does not erase existing records. Missing accessibility or status stays unknown.

## API

Citizen submission endpoints require the existing app bearer session:

| Method | Path | Behavior |
| --- | --- | --- |
| POST | /v1/field-reports | Consent-gated, UUID-idempotent submission |
| GET | /v1/field-reports/mine | Paginated owner reports |
| POST | /v1/evacuation-check-ins | Consent-gated, UUID-idempotent status observation |
| GET | /v1/operations/my-assistance | Authenticated owner-only government updates and assigned routes |
| GET | /v1/command/operations/reports | Paginated public incident review queue; no reporter identity |
| PATCH | /v1/command/operations/reports/{id} | Revision-checked review and evidence update |
| GET | /v1/command/operations/check-ins | Anonymous regional latest-observation totals |
| GET | /v1/command/operations/assistance | Paginated anonymous assistance cases |
| PATCH | /v1/command/operations/assistance/{id} | Revision-checked government dispatch action |
| POST | /v1/command/operations/routes | Calculate/update persisted draft |
| GET | /v1/command/operations/routes | Paginated route records, expiry and usability |
| POST | /v1/command/operations/routes/{id}/publish | Recalculate and publish only READY results |
| POST | /v1/command/operations/routes/{id}/withdraw | Withdraw publication |

Review/case revisions use expectedUpdatedAt from the previous response. Queued observations require a timezone, cannot be in the future, and may be at most seven days old. Submissions are capped at 100 per account per day per type. Client outbox is capped at 100 records and retains rejected records for explicit handling.

## Run

From the EvacuAid root, migrations run automatically at backend startup:

```powershell
docker compose build backend dashboard
docker compose up -d postgres redis valhalla backend dashboard
cd frontend
npm install
npm run typecheck
npx expo run:android
npx expo start --dev-client
```

The app adds expo-crypto; rebuild its development client. Android requires the SDK/adb/device. iOS builds require macOS/Xcode. Runtime mobile-device verification is separate from TypeScript, tests and JavaScript exports.

New persisted tables: field_reports, evacuation_check_ins, operational_routes and government_cases. Backend revision 20261012_16_operations is merged into the shared command migration graph by 20261012_17_ops_merge. Migration downgrade drops these new workflow records.

## Checks

```powershell
docker compose -p evacuaid-auth-test -f testocando/docker-compose.test.yml up -d --wait postgres
docker compose -p evacuaid-auth-test -f testocando/docker-compose.test.yml run --rm tests
cd frontend
npm run typecheck
npm test -- --silent
npm run export:native
```

New tests cover submission ownership, consent, idempotency, invalid observations, public-data privacy, confirmed-closure persistence, review conflicts, publication invalidation, delayed check-ins, dispatch versus citizen safety, publication re-evaluation, and retry-queue failures/account isolation.

Workspace verification: the combined backend/command suite passed 353 tests; the full app suite passed 720 tests across 77 suites. Subsequent focused checks passed 14 backend workflow tests and 9 app workflow/queue tests for the final owner-only dispatch/route-assignment and evidence-revision integration. TypeScript and lint of the new production app files passed. Android/iOS JavaScript exports and a real desktop dashboard browser check passed, including simulation isolation and absence of occupancy inputs. The live shared migration head is 20261012_17_ops_merge. No Android/iOS device run or native offline recalculation was demonstrated.
