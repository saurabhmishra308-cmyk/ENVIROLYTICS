# Envirolytics Monitor — PRD

## Original Problem Statement
Build a web application initially cloning www.asterflow.com, then customised and rebranded as **Envirolytics Monitor**. The app is an industrial environmental monitoring dashboard for Envirolytics Sustainability Private Limited that visualises real-time data from IoT instruments (Flowmeter, DWLR, pH sensor, conductivity, TDS, BOD, COD, TSS), shows live weather for Lucknow, and gives admins control over user accounts, monthly/quarterly/yearly site licenses, historical data (view, download CSV/PDF, edit via Excel upload) and certificate generation.

## User Personas
1. **Admin** — Envirolytics staff. Creates user accounts, resets passwords, activates sites, exports/imports historical data, generates calibration & installation certificates.
2. **Client** — End user of a site. Views dashboards, instrument live readings, weather, downloads their reports. Can change ONLY their own password (cannot change other users').

## Core Requirements
- JWT-based authentication; bcrypt-hashed passwords; admin-only user creation.
- Role-based access control: admin endpoints rejected for client tokens (403).
- Brute-force protection: 5 failed login attempts (per email AND per IP+email) → 15 min lockout.
- Live MQTT data only — no mocked instrument data in the UI.
- HiveMQ Cloud TLS broker (port 8883) for IoT subscriptions.
- OpenWeatherMap live weather for Lucknow.
- Dashboard, Analysis, Reports, Graph Report, Site, User, Zone, Maintenance pages with sidebar nav.
- Detail pages: Flowmeter monitoring, Water Level Recorder (DWLR).
- Historical data export to CSV and PDF.
- Excel (.xlsx) bulk import for editing historical data.
- Calibration & installation certificate PDF generation.

## Architecture
### Backend (`/app/backend`)
- **server.py** — FastAPI app, mounts routers, seeds admin on startup, wires MQTT service.
- **auth.py** — bcrypt hashing, PyJWT (HS256, 24 h), `get_current_user` & `require_admin` FastAPI dependencies.
- **api_auth.py** — `/api/auth/login`, `/me`, `/logout`, `/change-password`, `/admin/change-user-password`, idempotent admin seed.
- **api_admin.py** — `/api/admin/users/{create,list,{id}/status,{id}}`, `/api/admin/site/{activate,status/{id},activations}`, `/api/admin/data/{export,import}`, `/api/admin/certificate/{calibration,installation}`.
- **api_flowmeter.py** — public `/api/flowmeter/{latest,status,history/{id}}` for dashboard/reports.
- **mqtt_service.py** — paho-mqtt client with TLS support, async-bridge to MongoDB.
- **models.py** — `UserRole`, `SiteStatus`, `SubscriptionType`, Pydantic schemas.
- MongoDB collections: `users`, `login_attempts`, `site_activations`, `flowmeter_readings`, `flowmeter_latest`, `gateway_status`, `gateway_latest`, `certificates`, `status_checks`.

### Frontend (`/app/frontend/src`)
- **App.js** — React Router v7 with `<DashboardLayout>` wrapping protected routes; routes for `/`, `/policies`, `/dashboard`, `/analysis`, `/reports`, `/graph-report`, `/site`, `/user`, `/zone`, `/maintenance`, `/flowmeter`, `/water-level-recorder`. Sonner toaster mounted globally.
- **lib/api.js** — Centralised axios instance attaching `Bearer <token>` from `localStorage`; auto-clears token on 401.
- **mockData.js** — Backend-backed auth helpers (`loginWithEmail`, `getCurrentUser`, `isAuthenticated`, `mockLogout`, `isAdmin`); name kept for backwards compatibility with existing pages.
- **pages/Login.jsx** — Email + password form, async submit, redirects to /dashboard on success.
- **pages/EnhancedDashboard.jsx** — Polls `/api/flowmeter/latest` every 5 s; renders weather card, instruments status grid (8 sensors), MQTT badge, role badge; shows empty-state when no devices have published.
- **pages/Flowmeter.jsx** — Live device list with selectable cards, recent readings table, MQTT status.
- **pages/User.jsx** — Admin: full CRUD with create/reset-password/toggle-status/delete dialogs. Non-admin: only "Change My Password".
- **pages/Site.jsx** — Admin: activate monthly/quarterly/yearly subscriptions per user; lists all activations with active/expired badges.
- **pages/Reports.jsx** — Filters (hardware ID + shadcn calendar date pickers), CSV/PDF download (admin), Excel upload (admin), tabular data view.
- **components/Sidebar.jsx** — 8 menu items with active-state highlight and data-testids.

## What's Been Implemented (latest first)

### 2026-06-03 — AWS deployment package
- 📦 **`/app/aws-deploy/` directory** with everything needed to deploy on AWS EC2:
  - `Dockerfile.backend` — Python 3.11-slim + uvicorn (2 workers, healthcheck).
  - `Dockerfile.frontend` — multi-stage Node 20 build → Caddy 2 image (serves React + reverse-proxies `/api`).
  - `Caddyfile` — auto Let's Encrypt HTTPS, security headers, gzip/zstd, `/api/*` → backend container.
  - `docker-compose.yml` — wires both services, named volumes for cert uploads + Caddy data.
  - `.env.example` — production secrets template (Mongo Atlas URL, JWT_SECRET, MQTT, admin creds).
  - `userdata.sh` — EC2 cloud-init that installs Docker + clones repo + pulls .env from SSM Parameter Store + boots the stack.
  - `DEPLOYMENT.md` — end-to-end step-by-step guide (~$25/mo target spend).
- ✅ Zero code changes required — frontend builds with `REACT_APP_BACKEND_URL=""` so axios calls become same-origin and Caddy proxies them.
- ✅ `.dockerignore` added at repo root.
- ☑️ Recommended combo: **EC2 t3.small + MongoDB Atlas M0 + Caddy auto-HTTPS + EBS volume + ap-south-1**.

### 2026-06-02 (evening) — Admin Audit Log
- 🔍 **New backend endpoints** `GET /api/admin/audit-log/summary` and `/api/admin/audit-log/reading-edits` surface every reading edit/delete tracked by the existing `edited_by` / `edited_at` fields, joined with the editor's `email` + `full_name`.
- 👀 **New admin-only page** at `/audit-log` (sidebar entry visible only to admins) with three summary cards (Total edits, By source, Top editors) + filters (instrument source, hardware ID, limit) + full history table.
- 🚦 Fast-fail on unknown `instrument_type` filter (returns 400 with allowed list).
- 🛡 Non-admin clients see "Admin access required" fallback both via direct URL and sidebar.
- ✅ Backend: **81 / 81 pytest pass** (11 new TestAuditLog cases). Frontend e2e green.

### 2026-06-02 (afternoon) — Flowmeter categories, totalisers in KL, reading edits, map upgrade
- Flowmeter categorisation (`groundwater_abstraction` / `stp_inlet` / `stp_outlet`).
- Dashboard "Ground Water — Volumetric Water Abstraction" + STP Inlet/Outlet, m³/hr + 4 KL totaliser cards.
- Flowmeter hourly KL bar chart.
- Per-instrument detail pages (`/dwlr`, `/ph`, `/tds`, `/conductivity`).
- Analysis restricted to Flowmeter + DWLR.
- Reports edit/delete with strict totaliser-monotonicity validation.
- Certificates Month field.
- Zone tab removed.
- Map upgraded to Satellite/Streets layer toggle with pulsing markers.

### 2026-06-02 (morning) — Segmented dashboard, location map, Certificates module
- Client-location map (Leaflet).
- Dashboard split into Water Abstraction / Water Level / Water Quality.
- Removed BOD, COD, TSS.
- Certificates tab replacing Maintenance.
- User Lat/Lng/Location-name fields + Edit dialog.
- Generic Instruments API.

### 2026-06-12 — Offline device alerts (UI banner)
- New backend endpoint `GET /api/alerts/offline?hours=2` (`/app/backend/api_alerts.py`) — scans `flowmeter_latest` + `instrument_latest`, returns devices stale ≥ 2 h.
- New frontend component `OfflineAlertsBanner.jsx` polls every 60 s, renders a red banner on the dashboard listing each offline device with "last seen" relative time. Hidden when no devices are stale or the endpoint errors.
- Wired into `EnhancedDashboard.jsx` directly under the weather card.

### 2026-06-01 — Auth + admin + production-ready frontend
- Fixed corrupted JSX; build clean.
- JWT auth, brute-force lockout, admin seed, full admin UI, Reports CSV/PDF/Excel.

## Known Limitations
- 🔸 **MQTT broker auth** — HiveMQ Cloud currently rejects with rc=5 (Not Authorized). Either the credentials need to be set up in the HiveMQ Cloud console (Access Management), or the broker URL/port/credentials need re-verification. Frontend gracefully shows empty-state until a device publishes.
- 🔸 **Email-only lockout** — Triggered after 5 fails per email, meaning an attacker can lock out a legitimate user by sending bad attempts. Trade-off accepted because the K8s proxy hides the original client IP.

## Prioritised Backlog
### P0 — Next
- [ ] **Activate HiveMQ Cloud broker credentials** so live IoT data flows end-to-end. See `/app/IOT_DEVICE_CONFIGURATION_GUIDE.md` for the exact connection parameters that need to be enabled.
- [ ] Optional: Custom-domain mapping (Emergent Deploy → Settings → Custom Domain) to expose the portal on `environmental.monitoring.<your-domain>.com`.

### P1
- [ ] Expand audit log to cover non-reading events (user create/delete/activate, password resets, cert upload/delete, site activations).
- [ ] CSV export of the audit log.
- [ ] Charts in Reports page (still table-only).
- [ ] Per-instrument detail page polish (battery alerts on DWLR, threshold breach badges on pH/TDS).

### P2
- [ ] Email/SMS notifications when an instrument goes offline ≥ 2 h (UI banner already in place).
- [ ] Notification system (email / SMS) on instrument threshold breach.
- [ ] User self-service site-renewal request flow.
- [ ] Compliance-trends monthly PDF auto-mailer.
