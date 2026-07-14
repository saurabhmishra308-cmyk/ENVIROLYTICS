# Envirolytics Monitor — PRD

## Problem Statement
Envirolytics is a full-stack IoT monitoring platform for water utilities and
STPs. It ingests live MQTT telemetry from field devices (`skyrise.online:1490`),
routes payloads by IMEI, and renders role-scoped dashboards for Flowmeters,
DWLRs and Water Quality (STP + DO Meter).

## Personas
- **Admin**: God-mode, no expiry. Sees all devices, configures cameras + STP
  units, sets per-tank DO capacities, uploads real aeration videos, provisions
  instruments, runs simulations, manages users. Sees all admin metadata.
- **Client**: Sees only owned devices. 365-day term with 30-day pre-expiry
  reminder. **Never sees any indication that data was admin-entered** — all
  "manual" markers, admin timestamps, `updated_by`, `energy mode` labels, and
  `integration_config` are stripped from client responses.

## Core Features (Live)
- MQTT ingestion (direct broker, IMEI-routed, dual payload P673/P1001)
- Instrument registry with owner scoping
- Flowmeter / DWLR / Water-Quality (STP + DO) dashboards
- **Industrial SCADA-style STP plant diagram** with configurable per-unit
  capacities, air blowers (kW × hrs), filter feed pump, gardening/flushing
  (manual or linked flowmeter), and compiled energy usage (kWh/day)
- **Effluent parameter operating ranges** (COD/BOD/TSS/pH min-max) — used by
  the auto-push dummy engine when the instrument is offline
- **Auto data push (offline safety net)** — daily realistic values within the
  configured ranges when the instrument stops sending; real MQTT always wins
- **Per-tank DO aeration capacities** (Tank 1 KLD, Tank 2 KLD) admin-editable
- **Aeration video upload** (admin uploads real MP4 per tank)
- **Live camera streaming widget** with 3 sources: YouTube URL, MP4 URL, or
  admin-uploaded video (all indistinguishable to clients) + always-on CCTV
  timestamp overlay + optional real-device integration fields (RTSP/HLS/HTTP/
  ONVIF, port, endpoint, IP, model, credentials, notes)
- **Print SCADA snapshot** — one-click PDF export of the plant diagram with
  live values + energy breakdown for compliance audits
- Live MQTT Traffic panel with date+time stamps
- Manual CSV upload, dummy-data auto-generation (5-year backfill)
- Zoho SMTP notifications + 30-day renewal reminders
- **"Test alert now" button** — admin can test any user's offline-alert
  delivery from the user edit dialog; every user can also self-test from the
  dashboard header. Sends a simple one-liner to the login email + admin-
  configured `notification_emails`. Rate-limited to 1 send / user / 60s.
- CSV/PDF report exports per device + date range

## Recent Changes (2026-07-11)
- Removed "Live On-Site" badge from aeration tanks — uploaded videos are now
  visually indistinguishable from live camera footage.
- Added admin dialog to configure independent DO Tank 1 / Tank 2 capacities
  (`PUT /api/water-quality/{hw}/do-tank-config` + `do_tank_config` field).
- Extended STP config with `param_ranges` (COD/BOD/TSS/pH min-max) and
  `dummy_auto_push` toggle. When enabled, registry `dummy_config` is
  auto-flipped on with `auto_from_stp_cfg: True` and interval = 86400 s.
  Dummy generator now respects `stp_unit_config.param_ranges`.
- Client-safe sanitization: `_registry.stp_unit_config` strips
  `gardening_flushing.source/manual_kld/linked_fm_id`, `energy`, `updated_by`,
  `updated_at`. `_registry.aeration_videos` strips `*_uploaded_at/_uploaded_by`.
  `_registry.do_tank_config` strips `updated_at/updated_by`. `_registry.stp_derived`
  drops `energy_mode` + `energy_breakdown` for clients.
- Camera widget supports admin MP4 upload (`POST /api/camera-streams/{hw}/upload`);
  always-on CCTV timestamp banner; separate "Real device integration" fields.
- Print SCADA snapshot: html2canvas + jsPDF client-side, A4 landscape.

## Backlog (P0 → P2)
- **P1**: Multi-camera per device (Zone A / Zone B) — currently 1:1.
- **P1**: Non-admin (manager) role tier for read/write of specific devices.
- **P2**: Refactor `Instruments.jsx` (1,300+ lines) — extract modals.
- **P2**: Real-time flow ingestion for per-pump KLD (currently reflects
  configured capacity).
- **P2**: PTZ (pan-tilt-zoom) controls for IP-camera HLS wiring.

## API Endpoints (highlights)
- `POST /api/instrument-registry`
- `GET  /api/water-quality/latest`
- `GET  /api/water-quality/history/{hw_id}`
- `GET  /api/water-quality/{hw_id}/stp-config`               (admin)
- `PUT  /api/water-quality/{hw_id}/stp-config`               (admin)
- `PUT  /api/water-quality/{hw_id}/do-tank-config`           (admin)
- `POST /api/water-quality/{hw_id}/aeration-video/{tank}`    (admin, multipart)
- `DELETE /api/water-quality/{hw_id}/aeration-video/{tank}`  (admin)
- `POST /api/camera-streams`                                 (admin, upsert)
- `POST /api/camera-streams/{hw_id}/upload`                  (admin, multipart)
- `GET  /api/camera-streams/by-device/{hw_id}`
- `PUT  /api/camera-streams/{hw_id}`                         (admin)
- `DELETE /api/camera-streams/{hw_id}`                       (admin)
- `GET  /api/flowmeter/traffic`
- `POST /api/notifications/test-user/{user_id}`  (admin — per-user smoke test)
- `POST /api/notifications/test-me`              (any auth user — self-test)

## Data Models
- `instrument_registry`: hardware_id, imei, instrument_type,
  plant_capacity_kld, tank_capacity_kld (legacy), do_tank_config{tank_1_kld,
  tank_2_kld}, manual_water_temp_c, dummy_config, stp_unit_config{…,
  param_ranges, dummy_auto_push}, aeration_videos{tank_1, tank_2}
- `instrument_latest` / `instrument_readings`: hardware_id, values{}, ts
- `camera_streams`: hardware_id (unique), stream_url, stream_type
  (youtube|mp4|upload), embed_url, label, location, camera_status,
  integration_config{protocol,port,api_endpoint,camera_ip,device_model,
  username,password,notes}
- Uploaded assets on disk: `/app/backend/uploads/{aeration,camera}/`
  served at `/api/uploads/…`
