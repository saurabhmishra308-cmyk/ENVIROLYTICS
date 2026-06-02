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

### 2026-06-02 — Segmented dashboard, location map, Certificates module
- 🗺 **Client-location map on Dashboard** (Leaflet via CDN, OpenStreetMap tiles). Pins are coloured purple = admin, green = active client, grey = inactive. Auto-fits bounds when ≥2 pins.
- 🧭 **Dashboard split into 3 sections** with brand-coloured borders:
  - 💧 **Water Abstraction** — Flowmeter
  - 📏 **Water Level** — DWLR
  - 🧪 **Water Quality** — pH, Conductivity, TDS
- 🗑 **Removed BOD, COD, TSS** entirely from the app (backend supported types restricted to `dwlr, ph, tds, conductivity`).
- 📄 **Certificates module** (replaces *Maintenance* tab):
  - 4 sub-tabs: Installation, Calibration, Water Quality Pre-Monsoon, Water Quality Post-Monsoon
  - Real file upload (PDF/JPG/PNG, 10 MB cap, .exe rejected), year filter, role-aware listing, download, delete
  - Files persisted to disk at `/app/backend/certificate_files/{type}/{year}/` with metadata in MongoDB.
- 👤 **User create / edit** — admin can set/edit **Latitude, Longitude, Location Name** plus all profile fields & role.
- 🛰 **Generic instruments API** (`/api/instruments/*`): `types`, `all/latest`, `{type}/latest`, `{type}/{hw}/latest`, `{type}/{hw}/history`, admin `subscribe`, admin `ingest` (for demos / when broker is offline).
- 📦 **MQTT service** now subscribes to per-type topics `{type}/{hardware_id}/data` in addition to legacy flowmeter `{id}/0`.
- 🧪 51/51 backend pytest pass + all UI flows verified (testing agent v3 iteration_2).

### 2026-06-01 — Auth + admin + production-ready frontend
- 🚨 Fixed corrupted JSX; `yarn build` clean (~293 KB gz).
- 🔐 JWT auth (bcrypt + PyJWT), idempotent admin seed.
- 🛡 Brute-force lockout honouring `cf-connecting-ip` / `X-Forwarded-For` + email fallback (verified 5 fails → 429).
- 📡 Removed mocked instrument data; Dashboard polls `/api/flowmeter/latest` every 5 s.
- 🧭 Sidebar nav wired with `data-testid`s.
- 👥 Admin User UI (create/list/reset-password/toggle-status/delete).
- 🏷 Site activation UI (monthly / quarterly / yearly).
- 📥📤 Reports page: CSV/PDF download, Excel upload, shadcn Calendar date filters.

## Known Limitations
- 🔸 **MQTT broker auth** — HiveMQ Cloud currently rejects with rc=5 (Not Authorized). Either the credentials need to be set up in the HiveMQ Cloud console (Access Management), or the broker URL/port/credentials need re-verification. Frontend gracefully shows empty-state until a device publishes.
- 🔸 **Email-only lockout** — Triggered after 5 fails per email, meaning an attacker can lock out a legitimate user by sending bad attempts. Trade-off accepted because the K8s proxy hides the original client IP.

## Prioritised Backlog
### P0 — Next
- [ ] **Activate HiveMQ Cloud broker credentials** so live IoT data flows end-to-end. See `/app/IOT_DEVICE_CONFIGURATION_GUIDE.md` for the exact connection parameters that need to be enabled.
- [ ] Optional: Custom-domain mapping (Emergent Deploy → Settings → Custom Domain) to expose the portal on `environmental.monitoring.<your-domain>.com`.

### P1
- [ ] Per-instrument detail pages for DWLR, pH, Conductivity, TDS (mirroring the existing `Flowmeter.jsx` detail page).
- [ ] Audit log of admin actions (password resets, activations, certificate deletions).
- [ ] Charts in Reports page (currently table-only).

### P2
- [ ] Notification system (email / SMS) on instrument threshold breach.
- [ ] User self-service site-renewal request flow.
- [ ] Multi-tenant zones with hierarchical filter on map view.
