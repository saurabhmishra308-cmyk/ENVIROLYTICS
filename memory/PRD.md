# Envirolytics — Product Requirements (PRD)

## Original problem statement
Environmental monitoring SaaS for CGWA / SPCB / SGWA compliance. Multi-tenant IoT dashboard (borewell flowmeters, DWLR, water-quality sensors, STP flowmeters, DO analyzers). Real-time telemetry via MQTT + HTTPS + ESPL REST polling. Per-user instrument scoping, admin/client roles, alerts (offline devices, threshold breaches), downloads.

## Personas
- **Admin (Envirolytics)**: sees every client + every device, wires up instruments, approves access requests, receives offline-device alerts (up to 4 recipients). Only role that can reach `/instruments` (registry) and `/audit-log`.
- **Client**: sees only devices assigned to them. Sees "locked" overlays with a "Request access" button for instrument types they don't own. Cannot reach `/instruments` or `/audit-log` (redirected to `/dashboard`).

## Core architecture
- **Backend**: FastAPI (Python 3.11) + Motor (async MongoDB) + paho-mqtt + aiohttp/httpx
- **Frontend**: React 19 + Tailwind + Recharts + shadcn/ui
- **Data ingestion (three parallel paths)**:
  1. MQTT (HiveMQ 1883) — legacy flowmeter + DWLR + generic instrument topics
  2. HTTPS POST `/api/devices/ingest` — MQTT bypass with `X-Hardware-Id`/`X-Device-Key`
  3. ESPL REST polling — background loop every 5 min for `device_source=qespl_api` devices
- **Auth**: JWT (custom) — admin seeded from env.

## Change log
- **2026-07-22**:
  - `/instruments` and `/audit-log` routes wrapped in `AdminRoute` in `App.js`; non-admins are redirected to `/dashboard`. Sidebar already hides both entries for non-admins.
  - Registered two live ESPL DTUs (`DTU10020326`, `DTU10020426`) as `dometer` (DO Analyzer) under the admin account; poller returns HTTP 200 for both.
  - Renamed `dometer` display label to **DO Analyzer** in badges, dropdowns, and traffic-panel tables via `humanizeType` / `humanizeDevice` helpers.
  - Renamed user-visible **QESPL → ESPL** throughout `LiveTrafficCard`, `Instruments`, `User`, `WaterQualityDetail`.
  - Register-this action + Register-unknown-IMEI dialog on amber MQTT rows (POSTs to `/api/instrument-registry`).
  - Export CSV button on both traffic panels.
  - **Testing status (iteration_3.json)**: backend 13/13 pass, frontend 12/12 pass, 0 critical/minor issues, no action items.
- **2026-07-21**:
  - Wired `LockedSectionOverlay` into Ground Water, Quality parameters, STP Flowmeters sections on the dashboard. Admins see empty-state text; clients see the "Request access" overlay when they don't own that instrument type.
  - Added Live MQTT Traffic + Live HTTP Traffic (ESPL) panels — admin-only on the **Instruments** tab.
  - Backend: added ring buffers to `mqtt_service.py` and `qespl_poller.py` (last 50 events each) + new endpoint `GET /api/devices/qespl/traffic`.
  - Compliance banner: `CENTRAL / STATE POLLUTION CONTROL BOARD · CENTRAL GROUND WATER AUTHORITY · STATE GROUND WATER AUTHORITY`.
  - Access-request emails route to `saurabh@envirolytics.in`.

## Backlog / Roadmap
- **P1**: Verify TDS auto-computation from TSS + Chlorine dosing formulas against user's operational requirements.
- **P2**: Connect additional physical devices; validate ESPL polling in production over extended periods.
- **P2**: Email admin whenever `dropped_unknown` in MQTT jumps or ESPL fails 3 polls in a row.
- **P2**: Read-only "My Devices → Last 10 messages" mini-log for clients (self-diagnose data gaps).

## Test credentials
See `/app/memory/test_credentials.md`.

## Key API endpoints
- `POST /api/auth/login`
- `GET /api/instrument-registry` (admin: all, client: only owned)
- `POST /api/instrument-registry` (admin only)
- `PUT /api/instrument-registry/{hardware_id}` (admin only)
- `POST /api/devices/ingest` (HTTPS direct ingestion)
- `POST /api/devices/qespl/run-now` (manual ESPL poll, admin only)
- `GET /api/devices/qespl/traffic` (admin only — last 50 poll results + endpoint stats)
- `GET /api/flowmeter/status` (broker + last 50 MQTT messages)
- `POST /api/access-requests` (client → admin email at saurabh@envirolytics.in)
- `GET /api/flowmeter/water-quality/{hardware_id}/history`
