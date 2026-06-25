# Envirolytics Monitor — PRD / Working Memory

## Problem statement
Production bug-fix + polish on the Envirolytics Monitor web app (React + FastAPI + MongoDB, JWT auth) cloned from https://github.com/saurabhmishra308-cmyk/ENVIROLYTICS.

## Architecture
- Frontend: React 19 + react-router-dom 7 + CRACO + Tailwind + shadcn/ui
- Backend: FastAPI + Motor (async MongoDB), JWT auth (PyJWT)
- DB: MongoDB at MONGO_URL/${DB_NAME}
- External: Open-Meteo (free) for live weather, OpenStreetMap/ArcGIS tiles for the map

## Personas
- Admin (full permissions) — seeded from `.env` (admin@envirolytics.com / Admin@Envirolytics2026)
- Client (full permissions, single-site)
- Sub-user (gated by per-permission keys: dashboard, reports, analysis, certificates, audit, limits)

## What's been implemented
- 2026-06-25 — **Bug-1 (auto-logout)**: Smart 401 interceptor in `lib/api.js` only wipes the token + fires `envirolytics:auth-expired` event when the 401 actually indicates a token problem; ignores user-action 401s (change-password etc). Added `AuthGate` component to handle the event with a clean navigate to "/" + toast.
- 2026-06-25 — **Bug-2 (random crashes)**: Class-based `ErrorBoundary` wrapping `<Routes>` at the App root so any render error surfaces a recovery UI instead of blanking the app.
- 2026-06-25 — **Polish — branding/typography/login scene/weather** (see prior PRD).
- 2026-07 — **Phase 1 — Create User + Add Instruments 2-step wizard** (`User.jsx`): Step 1 user info + Step 2 multi-row instrument list (hardware_id, type, label, flowmeter-category, location, lat/lng). On submit POSTs the user then loops to POST each instrument to `/api/instrument-registry` with `owner_user_id` set to the new user.
- 2026-07 — **Phase 2 — Per-owner email alerts** (`notification_service.py`, `api_limits.py`, `api_alerts.py`): Offline + limit-breach emails now go to the **device owner** (looked up from `instrument_registry` → `users.email`) PLUS up to 4 global ops recipients. Each (device, owner) pair has its own cooldown. New endpoint `GET /api/alerts/limit-breaches` returns exceeded / below_min current-month breaches for the caller's visible flowmeters. `/api/alerts/offline` is now auth-required and scoped to `visible_hardware_ids`, surfaces never-reported registered devices too.
- 2026-07 — **Phase 4 — Flowmeter limits min/max + Visible-to-client toggle** (`api_limits.py`, `LimitsCard.jsx`): Added `min_limit_kl` and `visible_to_client` fields; admin can show/hide limits from the client with a quick eye-toggle. Below-min breach is now detected and emailed alongside the existing over-max breach, with per-month per-kind idempotency.
- 2026-07 — **Phase 5 — DWLR daily mWC + temperature** (`api_flowmeter_mgmt.py`, `WaterLevelRecorder.jsx`): New endpoint `GET /api/flowmeter-mgmt/dwlr/{hardware_id}/daily?days=30` returns daily-averaged level (mWC) + temperature (°C). Re-wrote `WaterLevelRecorder.jsx` to consume real data (registry + latest + daily) and display "never reported" tiles when no telemetry yet.
- 2026-07 — **Phase 6 — Per-user CSV/PDF download** (`api_flowmeter_mgmt.py`, `Reports.jsx`): New `GET /api/flowmeter-mgmt/export` (auth) — admin downloads everything, client only their owned hardware. Reports page no longer has the admin-only gate on the download button.
- 2026-07 — **Cleanup — demo / orphan data**: Called `/api/instrument-registry/wipe-demo` + `/purge-orphans` on the live DB; all `flowmeter_*` / `instrument_*` collections are now empty. With per-user scoping in place, admin + clients will only ever see telemetry from instruments registered through the Create User wizard.
- 2026-07 — **Code-quality / lint cleanup pass**: Fixed every lint finding across backend and frontend — unused variable in `api_certificates.py`, placeholder-less f-string in `api_auth.py`, three dead `eslint-disable` comments, unescaped apostrophe / quotes, redundant `useMemo` dependency in `WeatherCard.jsx`. Both `mcp_lint_python` (app files) and `mcp_lint_javascript` (pages, components, hooks) now report **0 issues**. Frontend webpack compiles with **0 warnings**. 20/20 backend smoke tests pass after the cleanup. Codebase is deployment-clean.

## Verified flows
- Login → dashboard → all-route navigation → hard refresh: session persists (verified iteration_1 + manual)
- Change-password 401 negative case: token preserved (verified iteration_1)
- All backend smoke endpoints return 200 with admin token
- Open-Meteo proxy returns live data (live verified: 32.6°C, 52% humidity, 2.1 m/s, 1003 hPa Lucknow)

## Backlog (P0 → P2)
- P1 — Persist user-set OpenWeather/Open-Meteo refresh frequency in admin settings
- P2 — Add 7-day forecast strip + rainfall projection chart
- P2 — Replace static mock data in `WaterLevelRecorder.jsx` borewell tiles with real DWLR readings
- P2 — Wire actual Resend API key for offline-device email notifications
- P2 — Production deploy to monitor.envirolytics.in (requires hosting credentials from user)

## Test credentials
See `/app/memory/test_credentials.md`.

## Files of note
- /app/frontend/src/lib/api.js — smart 401 auth interceptor
- /app/frontend/src/components/{ErrorBoundary,AuthGate}.jsx
- /app/frontend/src/App.js — route guards
- /app/frontend/src/pages/Login.jsx + /app/frontend/src/styles/login-scene.css — cinematic scene
- /app/frontend/public/index.html — fonts + badge removed
- /app/backend/api_weather.py — waterbody + /live (Open-Meteo)
- /app/backend/api_auth.py + auth.py — JWT, seed, lockout
