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

## Recent updates (Feb 2026 · DO tank mapping fix)
- **Root cause fixed** — QESPL returns a single `DO` value per device, but
  the Water Quality dashboard's Aeration Tank tiles read `DO_TANK_1`
  and `DO_TANK_2`. Tanks therefore fell through to "Aeration Stopped"
  and the video paused.
- `espl_poller._persist_reading` now re-labels the incoming DO to
  `DO_TANK_<aeration_tank_number>` (keeping the raw `DO` too for
  historical reports).
- `api_water_quality.latest` merges `DO_TANK_*` readings across every
  DO Analyzer owned by the same client — whichever DO device the
  operator selects from the pill list will show every tank the site has.
- Verified with the two live production ids (`DTU10020426` → tank 1,
  `DTU10020326` → tank 2): response returns
  `DO_TANK_1=7.13 · DO_TANK_2=2.6` on either device.

## Recent updates (Feb 2026 · sidebar cleanup)
- Removed the "Live Camera Feed" sidebar entry. Camera management now
  happens contextually inside the Water Quality → DO Analyzer tab
  (`/water-quality`) where the DO telemetry overlay is meaningful.
  The `/cameras` admin bulk manager page still exists (URL-accessible)
  but is not exposed in the sidebar.
- Updated the DO camera card description text to
  "Admins can configure the stream URL or upload video."

## Recent updates (Feb 2026 · bulk camera + wq context)
- **Camera Bulk Upload** (`POST /api/camera-streams/bulk-upload`) —
  admin uploads one MP4/WebM once, picks any subset of registered
  devices, and the same video is attached to every selected device
  (shared URL, one on-disk file). Ideal for a site with several
  identical DO probes / aeration tanks. UI: new "Bulk Upload Video"
  button on the /cameras admin page opens a dialog with a device
  picker (respects current filters) + Select-all / Clear.
- **Water Quality tab — client context badge**: when admin views the
  DO Analyzer tab, an amber badge next to the description shows
  "Client: <owner> · <location>" so it's obvious whose camera / device
  they're configuring.
- **📷 "Manage instrument photos & location" quick-link** — appears on
  STP, DO, and Chlorine section headers (admin only). Deep-links to
  Certificates & Photos filtered to the current instrument, so photos
  can be added with GPS/landmark from the same flow.

## Recent updates (Feb 2026 · username + admin cameras)
- **Username as separate login handle** — every user account now has a
  `username` field (unique, 3–30 chars, letters/digits + `. _ - + ! $ @`)
  in addition to email. Login accepts EITHER identifier: the existing
  `email` field on the login form is now labelled *"Username or Email"*
  and the backend looks up by `{$or:[{email},{username}]}`. Admin
  seed backfills usernames for legacy accounts (email local-part;
  numeric suffix on clash).
- **Admin can set the username** during user creation (User → Add User);
  leave blank to auto-derive from email prefix. Uniqueness enforced by
  a sparse Mongo index and 409 on collision.
- **User list** now shows the username in blue mono above the email.
- **IMEI / DeviceID** field is now completely unrestricted — accepts
  any alphanumeric string with special characters and no length cap,
  reflecting the reality that QESPL / MQTT vendors use mixed schemes
  (`DTU10020426`, `860738070478155`, `SN-BE:CGWA/12345`, …).
- **New "Live Camera Feed" admin page** (`/cameras`) — grid view of every
  registered instrument across every client with the existing
  LiveCameraWidget embedded per device, so admin can upload / link /
  clear videos for any client from one screen. Filters by client, type,
  and free-text search on hardware_id / label / owner.

## Recent updates (Feb 2026 · RWH recharge estimation)
- **New "Rainwater Recharge Estimate" tile** on the Dashboard, placed
  immediately below the DWLR (Water Level) section so admins can
  compare abstraction against recharge at a glance. Shows Today · Past
  7 days · Past 30 days totals (L and KL).
- **Backend**: `/api/rwh/recharge` — reads `rwh_catchment_area_sqm`,
  `rwh_runoff_coefficient` (default 0.85 · RCC roof) from Customer
  Profile, fetches daily rainfall from Open-Meteo (`past_days=30`) at
  the user's coordinates, and returns
  `recharge_litres = area × runoff × rainfall_mm` per day + rolling
  totals + full series for future charting.
- **Customer Profile** now includes a **Runoff Coefficient** input
  (CGWB reference values inline as helper text): RCC roof 0.85, GI 0.90,
  tiled 0.75, paved 0.70, unpaved 0.10–0.25.
- Renders for **every user** — client, admin, sub-users. Degrades
  gracefully when catchment area is missing (points to the profile
  page) or coordinates are unset.

## Recent updates (Feb 2026 · create-user parity)
- **Create-User wizard now supports every instrument type** — added
  DO Analyzer, OCEMS/WQ, Chlorine Analyzer to the type dropdown so a
  new client can be provisioned with the same variety already available
  in the Instruments page.
- **DO Analyzers** get an **Aeration Tank #** field (1..100). Bulk Add
  auto-numbers tanks sequentially when creating N DO analyzers in one
  batch, so admin doesn't have to type 1, 2, 3… for a multi-tank STP.
- **Plant / Tank Capacity (KLD)** fields exposed in the user wizard for
  DO / OCEMS / Chlorine devices — used by the Water Quality dashboard
  to compute dose recommendations.
- **Telemetry Source** dropdown on every instrument row — defaults to
  HTTP for DO/OCEMS so QESPL polling engages the moment the device is
  registered; IMEI validation switches to alphanumeric (32-char) when
  source=HTTP, keeping the strict 14-16 digit rule for MQTT devices.
- **Pick on map** — new Leaflet-based click-to-select picker
  (`MapLocationPicker.jsx`, Satellite + Streets layers) captures 6-decimal
  precision coordinates for both the user home location and each
  instrument row.
- **Bulk Add max bumped to 100 per type** — matches vendor rate limits
  (5-min interval) while letting a large chain register a full site in
  one call.
- Backend: `aeration_tank_number` (1..100) added to
  `CreateInstrumentRequest` / `UpdateInstrumentRequest` and persisted
  on `instrument_registry`.
- **Auto-Suggest Registration** — new "Probe deviceId" input on the
  Live HTTP Traffic card. Admin pastes a suspected QESPL deviceId, the
  backend fires a one-shot POST to `api.qenggonline.com`, and if the
  response is parseable the UI shows a highlighted callout with the
  parsed params + inferred `instrument_type`. One-click **Register this
  device** opens the Add-Instrument dialog pre-filled with
  `hardware_id`, `imei`, `instrument_type`, `source=http`, and label.
- Probe entries are added to the traffic buffer with a `probe=True`
  flag and rendered with a small emerald **PROBE** badge so they're
  easy to spot in the log.
- Backend: `POST /api/http-traffic/espl/probe` → returns
  `{ok, values, inferred_instrument_type, already_registered, ...}`.

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
