# Envirolytics Mobile — Sync Guide (Feb 2026 backend release)

Give this file to the mobile app's Emergent agent. It's a copy-paste
change-log covering every backend contract change this session (and
carry-over from the last few sessions). The mobile app is view-only —
no writes, no admin actions — so this focuses on **auth, data shapes,
units, and read endpoints**.

Backend base URL: whatever you set in `REACT_APP_BACKEND_URL` /
`EXPO_PUBLIC_BACKEND_URL`. On Emergent preview:
`https://<web-app>.preview.emergentagent.com`. On production the web
app runs at `https://monitor.envirolytics.in` — mobile can share the
same backend since it lives on the same VM.

---

## 1. Authentication — Login endpoint has a new contract

`POST /api/auth/login`

**Request body:**
```json
{
  "email":    "admin@envirolytics.com",   // OR username (kept in same "email" key)
  "password": "Admin@Envirolytics2026"
}
```

- The `email` key accepts **either an email OR a username**.
- **Legacy `user_id` (like `user_2ba8d15c08ae`) is NO LONGER accepted** — it will 401.
- Response:
  ```json
  {
    "access_token": "eyJhbGciOi...",
    "token_type": "bearer",
    "user": {
      "id": "user_0a5d61d8e342",
      "email": "admin@envirolytics.com",
      "username": "admin",
      "role": "admin",              // "admin" | "staff" | "client"
      "view_permissions": { ... },   // for clients — which pages/devices they can see
      "full_name": "...",
      ...
    }
  }
  ```
- Store the `access_token` and send it as `Authorization: Bearer <token>`
  on every subsequent call.
- On 401 with detail matching `"not authenticated" | "invalid or expired token" | "user not found"`, force the user to re-login.

### Password recovery (mobile can offer this too — it just triggers backend flows)
- `POST /api/auth/client-recovery/request-otp` body `{ "identifier": "email-or-username" }`
- `POST /api/auth/client-recovery/verify-otp` body `{ "identifier": "...", "otp": "123456", "new_password": "..." }`
- `POST /api/auth/admin-recovery/request-otp` (admin flow — mobile probably doesn't need)

---

## 2. Roles + Visibility (view-only implications)

Three roles are enforced end-to-end on the backend. Mobile doesn't need to
enforce them (backend already filters), but the UI should adapt:

| Role | What mobile should show |
|---|---|
| `admin`   | Everything |
| `staff`   | Same as admin **except** admins are invisible to them (all `/api/admin/...` calls filter them out — mobile can just call the same endpoints) |
| `client`  | Only their own devices + tabs their `view_permissions` allow |

`view_permissions` on the user object controls which sections a client
can see. Keys: `view_dashboard`, `view_flowmeter`, `view_dwlr`,
`view_ph`, `view_tds`, `view_conductivity`, `view_stp`, `view_do`,
`view_chlorine`, `view_ocems`, `view_water_quality`, `view_reports`,
`view_certificates`. Hide the tab if the corresponding key is false.

---

## 3. Units — **m³/h everywhere for flowmeters** (no more L/h, L/M)

Backend now normalizes every flowmeter reading to `flow_rate_m3h` at
ingest time. Mobile should:

- Display `flow_rate_m3h` (three decimal places recommended) with unit
  label `"m³/h"`.
- **Stop displaying** `flow_rate_lph` or `flow_rate_lpm` — those fields
  are still present in the DB for backward compat but the web app
  has removed them from all cards, tables, and downloads.

**Reading document shape (flowmeter)** — MongoDB collection
`flowmeter_readings`, returned by every history endpoint:
```json
{
  "hardware_id": "FM_PLANT_A_01",
  "timestamp": "2026-07-01T09:00:00Z",
  "received_at": "2026-07-01T09:00:03.123Z",
  "flow_rate_m3h": 2.4582,
  "flow_rate_lph": 2458.2,        // still present but DO NOT display
  "flow_rate_lpm": 40.97,          // still present but DO NOT display
  "forward_totalizer": 1309.75,    // cumulative "end reading" from live MQTT
  "reverse_totalizer": 0,
  "temperature": 22.5,
  "signal_strength": 13,
  "unit_name": "m3/h",             // canonical unit
  "unit_code": 6,
  "imei": "860738070478155",
  "firmware_version": "4G-1",
  // Newly introduced totaliser field names (present on manually-imported
  // rows; live MQTT rows only have `forward_totalizer` = the end reading):
  "totaliser_start_reading": 1250.75,
  "totaliser_end_reading":   1309.75,
  "initial_forward_totalizer": 1250.75,   // legacy alias for start
  "final_forward_totalizer":   1309.75,   // legacy alias for end
  "canonical_unit": "m3/h"
}
```

Rules of thumb for mobile display:
- Show `totaliser_end_reading` **or** `forward_totalizer` (whichever
  is present) as the "current cumulative volume" — unit is m³.
- Show `flow_rate_m3h` as the "instantaneous flow rate" — unit is m³/h.
- Daily consumption card: `totaliser_end_reading - totaliser_start_reading`
  when both are present, else compute from two consecutive readings'
  `forward_totalizer` deltas.

---

## 4. Data retention: **lifetime — never disappears**

Backend enforces lifetime retention for every device (this session).
Mobile doesn't need any retention logic. Historical data is safe to
query as far back as the client has readings.

The `data_retention_days` field on the instrument registry is now
always `null`. If your mobile app ever displayed a "retention: 90d"
badge, remove it — replace with "Lifetime" or hide entirely.

---

## 5. Data endpoints — read-only surface the mobile app needs

Base path `/api`. Always send `Authorization: Bearer <token>`.

### 5.1 Instrument list (per-user)
```
GET /api/instrument-registry
GET /api/instrument-registry?instrument_type=flowmeter
```
Response:
```json
{
  "instruments": [
    {
      "hardware_id": "VTFM001",
      "instrument_type": "flowmeter",
      "label": "VisTest Flowmeter",
      "location_name": "Plant A - Main Well",
      "latitude": 26.85,
      "longitude": 80.94,
      "category": "groundwater_abstraction",
      "imei": "860738070478155",
      "owner_user_id": "user_0a5d61d8e342",
      "owner_email": "client@example.com",
      "owner_name": "Client Company Ltd.",
      "source": "mqtt",           // "mqtt" | "http"
      "aeration_tank_number": 1,  // do_meter only
      "plant_capacity_kld": 200,  // wq_stp only
      "tank_capacity_kld": 50,    // wq_stp only
      "data_frequency_minutes": null,
      "data_retention_days": null // ALWAYS null → lifetime
    }
  ],
  "count": 1
}
```
Clients only ever see their own instruments — backend enforces the filter.

### 5.2 NEW ✨ — Live "Last data received" snapshot (very useful for mobile)
```
GET /api/instrument-registry/last-data
```
Returns every visible instrument joined with its latest reading + status:
```json
{
  "items": [
    {
      "hardware_id": "VTFM001",
      "instrument_type": "flowmeter",
      "label": "VisTest Flowmeter",
      "source": "mqtt",
      "owner_email": "client@example.com",
      "last_timestamp":   "2026-08-23T04:00:00Z",
      "last_received_at": "2026-08-23T04:00:03Z",
      "seconds_since_last": 245,
      "status": "live",          // "live" | "stale" | "silent"
      "last_values": {
        "flow_rate_m3h": 2.458,
        "totaliser_end_reading": 1309.75,
        "totaliser_start_reading": null,
        "signal_strength": 13,
        "unit_name": "m3/h"
      }
    }
  ],
  "counts": { "live": 5, "stale": 1, "silent": 2, "unassigned": 0 },
  "generated_at": "2026-08-23T04:04:05Z"
}
```
- **Perfect for the mobile home screen** — one call, one card per
  device, with colour-coded status pill (green = live < 30 min,
  amber = stale 30 m..24 h, grey = silent > 24 h).
- Auto-refresh every 15–30 s.
- Non-flowmeter devices return `last_values` from `instrument_readings.values{}` — keys include `level_mwc`, `temperature`, `do_mg_l`, `chlorine_ppm`, `ph`, `tds_ppm`, `conductivity_us_cm`, `ammonical_nitrogen`, `tn`, `tp`, `saturation_pct`, `signal_strength`. Present only when non-null.

### 5.3 Latest reading (per device)
```
GET /api/flowmeter/latest                  → array of latest per flowmeter (owned)
GET /api/instruments/{hardware_id}/latest  → single latest for any instrument
```

### 5.4 Historical readings (chart / list view)
```
GET /api/flowmeter-mgmt/history?hardware_id=FM_PLANT_A_01&limit=1000
GET /api/flowmeter/{hardware_id}/history?hours=24
GET /api/flowmeter-mgmt/dwlr/{hardware_id}/daily?days=30   // days can now be 1..3650 (lifetime)
```

### 5.5 Water quality history (DO / Chlorine / pH / STP / OCEMS)
```
GET /api/water-quality/history/{hardware_id}?from=YYYY-MM-DD&to=YYYY-MM-DD
GET /api/water-quality/latest
```
Downloadable CSV/PDF for a range:
```
POST /api/water-quality/report
Body: { "hardware_id": "...", "from": "YYYY-MM-DD", "to": "YYYY-MM-DD", "format": "csv" | "pdf" }
```

### 5.6 Downloadable exports (view-only "share" feature works)
- `GET /api/flowmeter-mgmt/export?format=csv&hardware_id=...&start_date=...&end_date=...` → up to **100,000 rows** now (was 5k)
- `GET /api/flowmeter-mgmt/export?format=pdf&hardware_id=...`
- CSV column set is **only m³/h**: `hardware_id, timestamp, received_at, flow_rate_m3h, totaliser_start_reading, totaliser_end_reading, temperature, signal_strength, unit_name, imei, firmware_version`.
  L/h and L/M columns are stripped.

### 5.7 Certificates + photos (view-only)
```
GET /api/certificates?client_user_id=...      → list certificates (calibration, installation, WQ pre/post)
GET /api/certificates/download/{cert_id}      → PDF/JPEG blob
GET /api/instrument-photos/{hardware_id}       → photos array
```
File URLs may be relative (like `/api/uploads/...`) — mobile must
prepend the backend base URL when rendering images/PDFs. Same
`apiUrl()` pattern the web app uses (see §7 below).

### 5.8 Reports data (dashboard cards)
```
GET /api/reports/borewell-consumption?days=30
GET /api/reports/flow-vs-level?hardware_id=...&days=7
GET /api/reports/level-vs-rainfall?dwlr_id=...&days=14
GET /api/reports/hourly-pumping-vs-level?hardware_id=...&hours=24
```

### 5.9 Customer profile (for the "About my account" page)
```
GET /api/customer-profile
```

---

## 6. Alerts (informational — mobile only receives, doesn't configure)

The backend sends **DO out-of-range** and **Chlorine out-of-range**
emails automatically via Zoho SMTP (recipients configured on backend).
Mobile can optionally show an "alerts feed" using:
```
GET /api/notifications/do-alerts/history
GET /api/notifications/chlorine-alerts/history
```

---

## 7. URL construction — **critical for mobile** (same bug as web app on Azure)

The web app had a bug where CSV downloads returned HTML because
`process.env.REACT_APP_BACKEND_URL` was undefined at build time and
URLs became `undefined/api/...`. On React Native / Expo the same
mistake would happen with `process.env.EXPO_PUBLIC_BACKEND_URL`.

**Do this on mobile:**
```js
const API_BASE = process.env.EXPO_PUBLIC_BACKEND_URL || '';

export function apiUrl(path) {
  const base = (API_BASE || '').replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

// Then everywhere:
fetch(apiUrl(`/api/instrument-registry/last-data`), {
  headers: { Authorization: `Bearer ${token}` }
});
```

**Do NOT** interpolate `process.env.EXPO_PUBLIC_BACKEND_URL` directly
inside a template literal — one missing `.env` and every request breaks.

---

## 8. What the mobile UI should look like (recommendation)

- **Home tab** — one call to `/api/instrument-registry/last-data`;
  render one card per device with a coloured status dot
  (live/stale/silent), latest values, and "Last: 2 min ago".
- **Details tab** (tap a device) — hit `/api/flowmeter/{hw}/history`
  or `/api/water-quality/history/{hw}` for the chart. Default range 24 h,
  user can extend to 7 d / 30 d / lifetime.
- **Reports tab** — reuse the web app's endpoint set in §5.8 for
  aggregate cards.
- **Certificates tab** — list via `/api/certificates` and
  open the PDF blob in a native viewer.
- **Alerts tab** — the DO / Chlorine history endpoints.

---

## 9. What is NOT in the mobile scope

Since the app is view-only, mobile does **not** need to implement:
- Creating / editing / deleting instruments (`POST/PUT/DELETE /api/instrument-registry`)
- CSV template uploads (`POST /api/admin/data/import`)
- User management (`/api/admin/users/*`)
- View-permission editing
- Certificate uploads (`POST /api/admin/certificate/*`)
- Simulation, dummy mode, retention config, MQTT admin panels
- Any `/api/admin/*` write endpoint

If a mobile user's role is `client`, the backend enforces this
automatically — 403 on any admin endpoint. So the mobile UI just
needs to not show buttons for those actions.

---

## 10. Changelog since last mobile sync

| Change | Impact on mobile |
|---|---|
| Login: `user_id` no longer accepted | Change any "login with user_id" flows to require email or username |
| New `/api/instrument-registry/last-data` endpoint | Add a home-screen live snapshot |
| Flowmeter unit unified → m³/h | Remove L/h / L/M display, use `flow_rate_m3h` |
| Totaliser fields renamed → `totaliser_start_reading` / `totaliser_end_reading` | Prefer these over `initial_forward_totalizer` / `final_forward_totalizer` |
| Lifetime data retention | Remove any "retained for N days" UI copy |
| Export column set trimmed to m³/h only | If mobile has "share as CSV", the payload is now cleaner |
| Export limit raised to 100k rows | Long historical ranges now work |
| DWLR daily aggregate accepts up to 3,650 days | Lifetime charts possible |
| Frontend `apiUrl()` helper pattern | Adopt the same pattern to avoid `undefined/api/...` bugs |
| Object storage persists uploads across redeploys | Certificates / photos URLs are stable — safe to cache locally |

---

## 11. Test credentials

- Admin: `admin@envirolytics.com` / `Admin@Envirolytics2026`  (or username `admin`)
- Test client: `testclient@envirolytics.com` / `Client@Test2026`  (or username `testclient`)
  - Role: `client`, has `view_water_quality` permission

Use the client account to verify the mobile app respects
view-permissions and only sees the owned instruments.
