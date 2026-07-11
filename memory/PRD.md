# Envirolytics Monitor — PRD

## Problem Statement
Envirolytics is a full-stack IoT monitoring platform for water utilities and
STPs. It ingests live MQTT telemetry from field devices (`skyrise.online:1490`),
routes payloads by IMEI, and renders role-scoped dashboards for Flowmeters,
DWLRs and Water Quality (STP + DO Meter). Backend is FastAPI + MongoDB,
frontend is React + Tailwind + Recharts.

## Personas
- **Admin**: God-mode, no expiry, sees all devices, configures cameras,
  provisions instruments, runs simulations, manages users.
- **Client**: Sees only owned devices, 365-day term with 30-day pre-expiry
  email reminder, read-only camera view.

## Core Features (Live)
- MQTT ingestion (direct broker, IMEI-routed, dual payload P673/P1001)
- Instrument registry with owner scoping + capacity fields (KLD)
- Flowmeter / DWLR / Water-Quality (STP + DO) dashboards
- STP animated plant diagram (SVG bubbles, blower, clarifier, filters)
- DO meter aeration animation driven by `aeration.mp4` playback rate
- **Live camera streaming widget on DO meter** (YouTube + MP4, telemetry overlay)
- Live MQTT Traffic panel with date+time stamps and unregistered-IMEI CTAs
- Manual CSV upload, dummy-data auto-generation (5-year backfill)
- Zoho SMTP notifications + 30-day renewal reminders
- OpenWeather integration + geolocation map (default Lucknow admin view)
- CSV/PDF report exports per device + date range

## Recent Changes
- **2026-07-11**: Live Camera Streaming Widget on WQ page + `camera_streams`
  collection, admin CRUD, YouTube auto-embed, telemetry overlay (DO Tank 1 +
  Tank 2 + timestamp). Testing agent verified 18/18 backend tests + full UI.
- **2026-07-11**: Live MQTT Traffic — "Devices transmitting but NOT
  registered" section now shows `Last seen: <date + time>` per IMEI; message
  log Time column upgraded from `HH:MM:SS` to full `MMM dd, yy, HH:MM:SS`.

## Backlog (P0 → P2)
- **P1**: Non-admin (manager) role tier for read/write of specific device
  subsets.
- **P2**: Refactor `/app/frontend/src/pages/Instruments.jsx` (1,300+ lines) —
  extract modals (Simulation, Dummy Data, MQTT Traffic, Create/Edit).
- **P2**: Multi-camera per device (Zone A / Zone B) — currently 1:1.
- **P2**: PTZ (pan-tilt-zoom) controls if user later moves to IP-camera HLS.

## API Endpoints (highlights)
- `POST /api/instrument-registry`
- `GET /api/water-quality/latest`  (returns registry devices even w/o readings)
- `GET /api/water-quality/history/{hw_id}`
- `POST /api/camera-streams`  (admin, upsert on hardware_id)
- `GET  /api/camera-streams/by-device/{hw_id}`
- `PUT  /api/camera-streams/{hw_id}` / `DELETE /api/camera-streams/{hw_id}`
- `GET /api/flowmeter/traffic`  (unregistered IMEIs include `last_seen`)

## Data Models
- `instrument_registry`: hardware_id, imei, instrument_type, plant_capacity_kld,
  tank_capacity_kld, manual_water_temp_c, dummy_config
- `instrument_latest` / `instrument_readings`: hardware_id, values{}, timestamp
- `camera_streams`: hardware_id (unique), stream_url, stream_type
  (youtube|mp4), embed_url (derived), label, location, camera_status,
  created_at, updated_at, created_by
