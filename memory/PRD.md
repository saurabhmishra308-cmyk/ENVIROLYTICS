# PRD — Envirolytics Monitor

## Problem
IoT sustainability monitoring platform for groundwater, STP effluent, DO,
chlorine, rainfall, and flowmeter telemetry. Direct MQTT broker + optional
HTTP polling (ESPL). React + FastAPI + MongoDB. Multi-tenant (Admin + Client
roles) with audit trail, offline alerts, CSV/PDF exports, and SCADA-style
Water Quality visualisations.

## Core roles
- **Admin**: full CRUD on instruments, users, thresholds, audit log; bypasses
  client-side security hardening (right-click / copy / F12 restrictions).
- **Client**: view-only dashboards for their owned instruments.

## Key requirements delivered (as of Feb 2026)
- Direct MQTT broker + dual-format DWLR (LEVEL / LVL) telemetry parsing.
- Instrument registry with hardware_id, IMEI, plant/tank capacities.
- Dashboard tiles + Location map (per-type coloured markers, legend, FAB).
- Water Quality module (STP + DO Meter + Chlorine Analyzer) with SCADA
  animations (MBBR → Sludge Dewatering → UV → Chlorine dosing).
- Auto energy + chlorine dose recommendations.
- Historical Reports with per-device totaliser calculations, CSV/PDF exports.
- Offline-device email alerts with test-send button.
- Client-role DOM security hardening.
- ESPL HTTP polling for devices that can't reach MQTT.

## Recent updates (Feb 2026)
- **`cleanLabel` utility** (`/app/frontend/src/utils/labels.js`) strips a
  trailing " Test" (case-insensitive) from any device label at every render
  site: Reports (table + CSV), Graph Report, Dashboard tiles, LocationMap,
  Water Quality panels, Instruments list, Audit Log, Offline alerts card.
- **No synthetic / dummy data ever surfaces to clients**:
  - Dummy data automation loop no longer overwrites the `_latest`
    collections — dashboards always show the last REAL reading (or stay
    offline if none). `dummy_data_service._tick` passes `update_latest=False`
    for all instrument types.
  - Every historical read query filters `_dummy: {$ne: True}` — covers
    `api_reports.py`, `api_flowmeter_mgmt.py`, `api_water_quality.py`,
    `api_instruments.py`, `api_limits.py`, `api_telemetry.py`,
    `api_alerts.py`, `notification_service.py`, `mqtt_service.py`.
- **Audit Log filter overhaul** (`AuditLog.jsx`):
  - "Hardware ID" free-text input replaced with **Device** dropdown
    populated from the actual instrument registry.
  - "Instrument source" dropdown is now dynamic — lists every instrument
    type currently provisioned (flowmeter, DWLR, STP, DO, Chlorine, OCEMS,
    pH, TDS, Conductivity). Cascades: choosing a source narrows the Device
    dropdown.
  - Table column renamed to "Device"; each row shows the cleaned label +
    hardware_id underneath. Source badge uses the friendly type name.

## Architecture (unchanged)
```
/app/backend
├── server.py
├── mqtt_service.py            — MQTT ingestion & TIME parsing
├── espl_poller.py             — HTTP telemetry poller
├── dummy_data_service.py      — offline-safety net (no longer touches _latest)
├── api_reports.py             — flow-vs-level, level-vs-rainfall, hourly, borewell
├── api_water_quality.py       — STP / DO / Chlorine / thresholds
├── api_alerts.py              — offline detection
├── api_flowmeter_mgmt.py      — categories, aggregates, downloads
├── api_instruments.py         — history + latest
├── api_instrument_registry.py — CRUD + dummy_config + device_key
└── notification_service.py    — SMTP + offline alert loop
/app/frontend/src
├── pages/                     — EnhancedDashboard, WaterQuality, Reports,
│                                WaterLevelRecorder, Instruments, Analysis,
│                                AuditLog, User, Certificates …
├── components/                — ReportsCharts, LocationMap, FlowmeterTile,
│                                LimitsCard, OfflineAlertsBanner, STPConfigDialog,
│                                LiveCameraWidget, SecurityHardening …
└── utils/labels.js            — cleanLabel helper (NEW)
```

## Key DB schema
- `instrument_registry` — hardware_id, instrument_type, category, label,
  owner_user_id, imei, plant_capacity_kld, tank_capacity_kld,
  turbidity_k, chlorine_min/max/dose_target/solution_pct/pump_kw,
  do_tank_config, stp_unit_config, source ("mqtt"|"http"), device_key,
  dummy_config, manual_water_temp_c, latitude, longitude, location_name.
- `instrument_readings` / `flowmeter_readings` — every reading, with
  `_dummy: true` flag on synthetic ones (now filtered on read everywhere).
- `instrument_latest` / `flowmeter_latest` — latest real reading per device
  (dummy loop no longer overwrites).
- `users`, `audit_log`, `notification_settings`, `certificates`, `renewals`,
  `flowmeter_categories`, `flow_limits`, `camera_streams`, `login_attempts`.

## Recent updates (Feb 2026 · bulk-add)
- **Bulk-Add Instruments wizard** (`/app/frontend/src/components/BulkAddInstruments.jsx`)
  — 4-step admin flow (client → counts → per-row detail → summary) to
  register up to 100 instruments per site in one call. DO Analyzer &
  OCEMS default to `source=http` so QESPL polling starts immediately.
- **Backend**: `POST /api/instrument-registry/bulk` — validates and
  creates each row independently; response lists both `created` and
  `errors` so the UI can show a per-row status.
- **Confirmed**: QESPL API returns fresh readings for `DTU10020426` and
  `DTU10020326` (DO / Saturation / Temperature). If the Live HTTP panel
  shows nothing on production, register those two devices with
  `type=DO Analyzer`, `source=HTTP`, `deviceId=DTU10020426` /
  `DTU10020326` — the poller picks them up on its next 5-min tick.

## Backlog (prioritised)
- **P1** — Multi-unit hierarchy (parent company + unit/state) for chains
  like Lemon Tree Hotel across many locations.
- **P1** — Client-session watermark overlay (low-opacity diagonal repeat of
  `email · datetime` across every page to deter screenshot leaks).
- **P1** — Instruments.jsx (>2000 lines) split: separate dialog components
  for Create / Edit / HTTPS Ingestion / Dummy / Confirm.
- **P2** — Resolve React hydration warning `<span> in <option>` in
  `Reports.jsx`.
- **P2** — Admin "Purge dummy readings" button per device (currently the
  user handles it manually on production).
- **P2** — Global kill switch for the dummy_data automation loop in Settings.

## Production
- URL: https://monitor.envirolytics.in
- Preview DB is empty; production DB carries live devices (Piezometer,
  Lemon Tree Hotel STP, etc.).
