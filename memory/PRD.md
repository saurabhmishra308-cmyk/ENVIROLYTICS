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
- 2026-07 — **Phase 1: Create User + Add Instruments wizard** — `User.jsx` now opens a 2-step dialog:
  - Step 1: User info (email, name, password, role, company, phone, location, lat/lng) — existing form
  - Step 2: Multi-row instrument list (hardware_id, type, label, category for flowmeter, location, lat/lng) — admin can add/remove rows
  - Submit: POST `/api/admin/users/create` → loop POST `/api/instrument-registry` with the new `owner_user_id` per instrument
  - Toast feedback shows success / partial failure
  - Each instrument's location defaults to the user's location for convenience

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
