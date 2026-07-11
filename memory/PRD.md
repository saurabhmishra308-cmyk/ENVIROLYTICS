# Envirolytics Monitor — PRD

## Problem Statement
Envirolytics is a full-stack IoT monitoring platform for water utilities and
STPs. It ingests live MQTT telemetry from field devices (`skyrise.online:1490`),
routes payloads by IMEI, and renders role-scoped dashboards for Flowmeters,
DWLRs and Water Quality (STP + DO Meter). Backend is FastAPI + MongoDB,
frontend is React + Tailwind + Recharts.

## Personas
- **Admin**: God-mode, no expiry. Sees all devices, configures cameras + STP
  units, uploads real aeration-tank videos, provisions instruments, runs
  simulations, manages users.
- **Client**: Sees only owned devices. 365-day term with 30-day pre-expiry
  reminder. Read-only camera view. Cannot edit STP config or upload videos.

## Core Features (Live)
- MQTT ingestion (direct broker, IMEI-routed, dual payload P673/P1001)
- Instrument registry with owner scoping + capacity fields (KLD)
- Flowmeter / DWLR / Water-Quality (STP + DO) dashboards
- Industrial SCADA-style STP plant diagram with configurable per-unit
  capacities, air blowers, filter feed pump, gardening/flushing source, and
  compiled energy usage (auto or manual override)
- DO meter aeration animation driven by `aeration.mp4` playback rate.
  Admin can **upload a real MP4 of each aeration tank** to replace the demo.
- Live camera streaming widget on DO meter (YouTube + MP4, telemetry overlay,
  demo aeration footage when no camera is attached)
- Live MQTT Traffic panel with date+time stamps and unregistered-IMEI CTAs
- Manual CSV upload, dummy-data auto-generation (5-year backfill)
- Zoho SMTP notifications + 30-day renewal reminders
- OpenWeather integration + geolocation map (default Lucknow admin view)
- CSV/PDF report exports per device + date range

## Recent Changes
- **2026-07-11 (batch 3)**: STP unit-level configuration + aeration video
  upload. New endpoints `PUT/GET /api/water-quality/{hw_id}/stp-config` and
  `POST/DELETE /api/water-quality/{hw_id}/aeration-video/{tank}`. Static file
  mount at `/api/uploads/aeration/`. Frontend adds `STPConfigDialog` and
  `AerationVideoUploader` components. Energy is auto-computed as
  Σ(kW × running_hrs) with an optional manual override. Gardening/flushing
  KLD can be linked to any flowmeter (24 h TOTAL delta) or entered manually.
  16/16 backend tests + full admin/non-admin UI gate verified. SCADA SVG
  pipes get `fill="none"` fix + high-contrast KLD chip on aeration tank.
- **2026-07-11 (batch 2)**: Live camera streaming widget on WQ page with
  `camera_streams` collection, admin CRUD, YouTube auto-embed, telemetry
  overlay (DO Tank 1 + Tank 2 + timestamp). When no camera is attached the
  widget loops the local `aeration.mp4` as demo footage (no watermark).
  Aeration videos zoomed 1.5625× with very slow playback (0.15×–0.35×).
- **2026-07-11 (batch 1)**: MQTT Traffic — unregistered-IMEI cards show
  `Last seen: MMM DD, YYYY, HH:MM:SS`; message log Time column upgraded to
  full date+time. `/api/water-quality/latest` returns registry devices even
  before their first reading.

## Backlog (P0 → P2)
- **P1**: Multi-camera per device (Zone A / Zone B) — currently 1:1.
- **P1**: Non-admin (manager) role tier for read/write of specific device
  subsets.
- **P2**: Refactor `/app/frontend/src/pages/Instruments.jsx` (1,300+ lines) —
  extract modals (Simulation, Dummy Data, MQTT Traffic, Create/Edit).
- **P2**: Real-time flow ingestion for per-pump KLD (currently a snapshot
  of configured capacity).
- **P2**: PTZ (pan-tilt-zoom) controls if user later moves to IP-camera HLS.

## API Endpoints (highlights)
- `POST /api/instrument-registry`
- `GET  /api/water-quality/latest`
- `GET  /api/water-quality/history/{hw_id}`
- `GET  /api/water-quality/{hw_id}/stp-config`
- `PUT  /api/water-quality/{hw_id}/stp-config`               (admin)
- `POST /api/water-quality/{hw_id}/aeration-video/{tank}`    (admin, multipart)
- `DELETE /api/water-quality/{hw_id}/aeration-video/{tank}`  (admin)
- `POST /api/camera-streams`                                 (admin, upsert)
- `GET  /api/camera-streams/by-device/{hw_id}`
- `GET  /api/flowmeter/traffic`

## Data Models
- `instrument_registry`: hardware_id, imei, instrument_type,
  plant_capacity_kld, tank_capacity_kld, manual_water_temp_c, dummy_config,
  stp_unit_config, aeration_videos{tank_1, tank_2}
- `instrument_latest` / `instrument_readings`: hardware_id, values{}, ts
- `camera_streams`: hardware_id (unique), stream_url, stream_type,
  embed_url (derived), label, location, camera_status, created_at,
  updated_at, created_by
- `stp_unit_config`: equalization/aeration/settling/filter_feed/treated_water
  tank KLD, air_blowers[], filter_feed_pump{}, gardening_flushing{}, energy{}
- Uploaded videos on disk: `/app/backend/uploads/aeration/`
  served at `/api/uploads/aeration/…`
