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
- 2026-06-17 — Cloned repo into /app, set up backend `.env` (JWT_SECRET, ADMIN_*), installed Python deps (paho-mqtt, resend, reportlab, openpyxl), `yarn install`-ed frontend.
- 2026-06-17 — **Bug-1 (auto-logout)**: Smart 401 interceptor in `lib/api.js` only wipes the token + fires `envirolytics:auth-expired` event when the 401 actually indicates a token problem; ignores user-action 401s (change-password etc). Added `AuthGate` component to handle the event with a clean navigate to "/" + toast.
- 2026-06-17 — **Bug-2 (random crashes)**: Class-based `ErrorBoundary` wrapping `<Routes>` at the App root so any render error surfaces a recovery UI instead of blanking the app. Added `RequireAuth` wrapper for routes that previously had no guard.
- 2026-06-17 — **Polish 1 — branding**: Removed "Made with Emergent" badge + emergent-main.js script + PostHog analytics from `public/index.html`.
- 2026-06-17 — **Polish 2 — typography**: Loaded Plus Jakarta Sans (display) + Inter (body) + JetBrains Mono (data numerals); refined CSS variables (`--font-display`, `--font-body`, `--font-mono`); h1/h2/h3 typography rules; dashboard KPI tiles use `tabular-nums`.
- 2026-06-17 — **Polish 3 — login scene v2**: Cinematic 24s storyline — mountains with snow caps, waterfall cascading from peak, river to foreground, 3 windmills + solar panels (no trees), sun rays, seagulls, butterflies, fireflies, water ripples, rainbow, leaping fish, glass-morphism `.env-login-card` with neon border, premium pill submit button.
- 2026-06-17 — **Polish 4 — Live Weather backend proxy**: Added `GET /api/weather/live` (free Open-Meteo, no key needed) returning OWM-compatible shape; Dashboard `fetchWeather` now uses the backend endpoint + auto-refresh every 5 min.

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
