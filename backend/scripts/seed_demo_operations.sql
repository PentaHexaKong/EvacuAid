-- Demo data for the Command Center Field reports, Assistance and Check-ins pages.
-- Re-runnable: deletes its own rows (users named 'demo-ops-*') and reinserts them with fresh timestamps.
-- docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < backend/scripts/seed_demo_operations.sql
BEGIN;

DELETE FROM users WHERE name LIKE 'demo-ops-%'; -- cascades to reports, check-ins, requests, cases

INSERT INTO users (id, name, role)
SELECT md5('demo-ops-' || n)::uuid, 'demo-ops-' || n, 'CITIZEN' FROM generate_series(1, 60) n;

-- Field reports: public incidents around Jakarta, mostly awaiting review.
INSERT INTO field_reports (id, user_id, payload, status, review, created_at, updated_at)
SELECT md5('demo-ops-report-' || r.n)::uuid, md5('demo-ops-' || r.n)::uuid,
  jsonb_build_object('kind', r.kind, 'latitude', r.lat, 'longitude', r.lon, 'description', r.description,
    'hazardType', r.hazard, 'observedAt', to_char((now() - r.observed) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'publicLocationConsent', true),
  r.status, r.review, now() - r.observed + interval '2 minutes', now() - r.updated
FROM (VALUES
  (1, 'FLOODING', -6.2146, 106.8451, 'Water knee-high on Jl. Casablanca underpass, motorbikes turning back.', 'FLOOD', interval '6 minutes', interval '4 minutes', 'UNVERIFIED', '{}'::jsonb),
  (2, 'BLOCKED_ROAD', -6.1754, 106.8272, 'Fallen tree blocking both lanes near Monas east gate.', 'EARTHQUAKE', interval '14 minutes', interval '11 minutes', 'UNVERIFIED', '{}'::jsonb),
  (3, 'INACCESSIBLE_ROUTE', -6.2297, 106.8085, 'Pedestrian bridge stairs cracked; no ramp for wheelchairs to the shelter.', 'EARTHQUAKE', interval '22 minutes', interval '18 minutes', 'CONFIRMED',
     '{"status":"CONFIRMED","note":"Verified by Satpol PP patrol; ramp closed until inspection.","barrier":true,"radiusM":80}'::jsonb),
  (4, 'SHELTER_CROWDING', -6.1386, 106.8133, 'GOR Penjaringan is over capacity, families waiting outside.', 'FLOOD', interval '35 minutes', interval '25 minutes', 'CONFIRMED',
     '{"status":"CONFIRMED","note":"Shelter coordinator confirms ~140% occupancy; redirect new arrivals.","barrier":false}'::jsonb),
  (5, 'DAMAGED_INFRASTRUCTURE', -6.2615, 106.7810, 'Power pole leaning over Jl. Ciputat Raya, cables low.', 'EARTHQUAKE', interval '48 minutes', interval '40 minutes', 'UNVERIFIED', '{}'::jsonb),
  (6, 'FLOODING', -6.1201, 106.7663, 'Tidal water entering Muara Angke fish market road.', 'FLOOD', interval '1 hour 10 minutes', interval '55 minutes', 'RESOLVED',
     '{"status":"RESOLVED","note":"Water receded; road reopened by Dinas SDA at 09:40."}'::jsonb),
  (7, 'OTHER', -6.1938, 106.8227, 'Large crowd gathering at Tanah Abang station exit, unclear why.', 'EARTHQUAKE', interval '1 hour 30 minutes', interval '1 hour 12 minutes', 'REJECTED',
     '{"status":"REJECTED","note":"Normal commuter peak; no incident found."}'::jsonb),
  (8, 'BLOCKED_ROAD', -6.2442, 106.8705, 'Debris from collapsed shop front covering Jl. Otista lane.', 'EARTHQUAKE', interval '2 hours', interval '1 hour 40 minutes', 'UNVERIFIED', '{}'::jsonb)
) AS r(n, kind, lat, lon, description, hazard, observed, updated, status, review);

-- Assistance requests with a mix of citizen and government states.
INSERT INTO assistance_requests (id, user_id, status, requested_at, updated_at, support_needs, message, sharing_consent, idempotency_key)
SELECT md5('demo-ops-assist-' || a.n)::uuid, md5('demo-ops-' || (10 + a.n))::uuid, a.status,
  now() - a.age - interval '5 minutes', now() - a.age, a.needs, '', true, 'demo-ops-assist-' || a.n
FROM (VALUES
  (1, 'UNANSWERED', interval '3 minutes', '["MOBILITY_LIMITATION","ELDERLY"]'::jsonb),
  (2, 'FALLBACK_REQUIRED', interval '9 minutes', '["VISUAL_IMPAIRMENT"]'::jsonb),
  (3, 'WAITING', interval '16 minutes', '["HEARING_IMPAIRMENT"]'::jsonb),
  (4, 'EN_ROUTE', interval '24 minutes', '["MOBILITY_LIMITATION"]'::jsonb),
  (5, 'EVACUATING', interval '41 minutes', '["ELDERLY"]'::jsonb),
  (6, 'INTERRUPTED', interval '58 minutes', '["MOBILITY_LIMITATION","VISUAL_IMPAIRMENT"]'::jsonb),
  (7, 'SAFE', interval '1 hour 35 minutes', '["ELDERLY","HEARING_IMPAIRMENT"]'::jsonb),
  (8, 'COMPLETED', interval '2 hours 20 minutes', '["OTHER"]'::jsonb),
  (9, 'EXPIRED', interval '30 hours', '["MOBILITY_LIMITATION"]'::jsonb)
) AS a(n, status, age, needs);

INSERT INTO government_cases (request_id, payload, updated_at)
SELECT md5('demo-ops-assist-' || c.n)::uuid, jsonb_build_object('status', c.status, 'note', c.note, 'assignedRouteId', NULL), now() - c.age
FROM (VALUES
  (3, 'ACKNOWLEDGED', 'BPBD Jakarta Pusat team notified; sign-language volunteer requested.', interval '12 minutes'),
  (4, 'DISPATCHED', 'Ambulance unit 07 en route via Jl. Gunung Sahari.', interval '20 minutes'),
  (5, 'DISPATCHED', 'Tagana boat team assigned to Kampung Melayu.', interval '38 minutes'),
  (7, 'COMPLETED', 'Delivered to GOR Cempaka Putih; family contacted.', interval '1 hour 30 minutes'),
  (9, 'CANCELLED', 'Duplicate of an earlier case.', interval '29 hours')
) AS c(n, status, note, age);

-- Check-ins: each demo user's latest status in one of six villages.
WITH villages AS (
  SELECT id, row_number() OVER (ORDER BY name) AS i FROM (
    SELECT id, name FROM command_regions WHERE data_mode = 'REFERENCE' AND administrative_level = 'VILLAGE'
    AND upper(name) IN ('KAMPUNG MELAYU', 'PENJARINGAN', 'BIDARA CINA', 'CAWANG', 'PLUIT', 'KAPUK MUARA')) v)
INSERT INTO evacuation_check_ins (id, user_id, payload, created_at)
SELECT md5('demo-ops-checkin-' || n)::uuid, md5('demo-ops-' || n)::uuid,
  jsonb_build_object('status', (ARRAY['ARRIVED','ARRIVED','SAFE_REPORTED','EVACUATING','EVACUATING','NEEDS_ASSISTANCE','ARRIVED','UNKNOWN'])[1 + n % 8],
    'regionId', v.id, 'observedAt', to_char((now() - (n * interval '3 minutes')) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'shareAggregateConsent', true),
  now() - (n * interval '3 minutes')
FROM generate_series(1, 60) n
JOIN villages v ON v.i = 1 + n % (SELECT count(*) FROM villages);

COMMIT;
