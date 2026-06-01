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

## What's Been Implemented (2026-06-01)
- ✅ Fixed corrupted JSX (`EnhancedDashboard` footer + entire `Flowmeter.jsx`) — production build now passes (`yarn build` clean, 288 kB gzipped).
- ✅ Removed orphaned Register page + route (admin-only user creation policy).
- ✅ New JWT auth stack (bcrypt + PyJWT) with idempotent admin seed on startup.
- ✅ Default admin: `admin@envirolytics.com` / `Admin@Envirolytics2026` (auto-resyncs from `.env`).
- ✅ Brute-force lockout works behind k8s/Cloudflare (uses `cf-connecting-ip` / `X-Forwarded-For`, plus email-only fallback). Verified: 5 fails → 429.
- ✅ Wired Sidebar layout for Analysis, Reports, GraphReport, Site, User, Zone, Maintenance.
- ✅ Replaced all mocked instrument live data with real backend polling of `/api/flowmeter/latest`. Empty-state UX when MQTT has no data.
- ✅ Admin UI: create user, reset any password, activate/deactivate, delete (cannot delete self), change own password.
- ✅ Site activation UI: monthly (30d) / quarterly (90d) / yearly (365d).
- ✅ Reports page: real CSV/PDF downloads via Bearer token, Excel upload with validation feedback, shadcn Calendar date pickers.
- ✅ MQTT service updated for HiveMQ Cloud TLS (port 8883); credentials wired in `backend/.env`.
- ✅ Backend regression test suite at `/app/backend/tests/backend_test.py` (33/34 pass; remaining one is the brute-force test which is now fixed in this iteration).

## Known Limitations
- 🔸 **MQTT broker auth** — HiveMQ Cloud currently rejects with rc=5 (Not Authorized). Either the credentials need to be set up in the HiveMQ Cloud console (Access Management), or the broker URL/port/credentials need re-verification. Frontend gracefully shows empty-state until a device publishes.
- 🔸 **Email-only lockout** — Triggered after 5 fails per email, meaning an attacker can lock out a legitimate user by sending bad attempts. Trade-off accepted because the K8s proxy hides the original client IP.

## Prioritised Backlog
### P0 — Next
- [ ] Verify HiveMQ Cloud credentials & ACLs (user-action: confirm broker setup) so live data flows end-to-end.
- [ ] Add Water Level Recorder backend endpoints (currently UI exists but no `/api/dwlr/*` routes).
- [ ] Certificate Download UI: surface buttons on Reports/Maintenance pages calling `/api/admin/certificate/{calibration,installation}`.

### P1
- [ ] DWLR / pH / TDS / BOD / COD / TSS instrument types in backend with their own MQTT topic schemas.
- [ ] User self-service site renewal request flow.
- [ ] Audit log of admin actions (password resets, activations, deletes).
- [ ] Charts in Reports (currently table-only).

### P2
- [ ] Multi-tenant zones with geographic map view.
- [ ] Notification system (email / SMS) on instrument threshold breach.
- [ ] Mobile app (PWA).
