# Envirolytics — Product Requirements (PRD)

## Original Problem Statement
Environmental monitoring SaaS for CGWA / SPCB / SGWA compliance. Multi-tenant IoT dashboard (borewell flowmeters, DWLR, water-quality sensors, STP flowmeters, DO meter). Real-time telemetry via MQTT + HTTPS + QESPL REST polling. Per-user instrument scoping, admin/client roles, alerts (offline devices, threshold breaches), downloads.

## Personas
- **Admin (Envirolytics)**: sees every client + every device, wires up instruments, approves access requests, receives offline-device alerts (up to 4 recipients).
- **Client**: sees only devices assigned to them. Sees "locked" overlays with a "Request access" button for instrument types they don't own.

## Core Architecture
- **Backend**: FastAPI (Python 3.11) + Motor (async MongoDB) + paho-mqtt + aiohttp/httpx
- **Frontend**: React 19 + Tailwind + Recharts + shadcn/ui
- **Data ingestion (three parallel paths)**:
  1. MQTT (HiveMQ 1883) — legacy flowmeter + DWLR + generic instrument topics
  2. HTTPS POST `/api/devices/ingest` — MQTT bypass with `X-Hardware-Id`/`X-Device-Key`
  3. QESPL REST polling — background loop every 5 min for `device_source=qespl_api` devices
- **Auth**: JWT (custom) — admin seeded from env.

## Change log
- **2026-07-21 (this session)**:
  - Wired `LockedSectionOverlay` into Ground Water, Quality parameters, STP Flowmeters sections on the dashboard. Admins see empty-state text; clients see the "Request access" overlay when they don't own that instrument type.
  - Added Live MQTT Traffic + Live HTTP Traffic (QESPL) panels — admin-only, mounted on the **Instruments** tab (was originally added to Dashboard, moved on user feedback).
  - Backend: added ring buffers to `mqtt_service.py` and `qespl_poller.py` (last 50 events each) + new endpoint `GET /api/devices/qespl/traffic`. `GET /api/flowmeter/status` now returns `total_received`, `dropped_unknown`, `recent_messages`.
  - Updated compliance banner in dashboard hero to: `CENTRAL / STATE POLLUTION CONTROL BOARD · CENTRAL GROUND WATER AUTHORITY · STATE GROUND WATER AUTHORITY`.
  - Access-request emails go to `saurabh@envirolytics.in` (override via env `ACCESS_REQUEST_ADMIN`).

## Backlog / Roadmap
- **P1**: Verify TDS auto-computation from TSS + Chlorine dosing formulas against user's operational requirements.
- **P2**: Connect physical DO Meter / Water Quality IoT devices; validate QESPL polling in production over extended periods.
- **P2**: Consider a "Register this IMEI" quick-action inside the MQTT traffic table when an unknown IMEI appears (currently the UI only highlights them in amber).

## Test credentials
See `/app/memory/test_credentials.md`.

## Key API endpoints
- `POST /api/auth/login`
- `GET /api/instruments/registry`
- `POST /api/devices/ingest` (HTTPS direct ingestion)
- `POST /api/devices/qespl/run-now` (manual QESPL poll)
- `GET /api/devices/qespl/traffic` (admin — last 50 poll results + endpoint stats)
- `GET /api/flowmeter/status` (broker + last 50 MQTT messages)
- `POST /api/access-requests` (client → admin email)
- `GET /api/flowmeter/water-quality/{hardware_id}/history`
