# IoT Device Configuration Guide — Envirolytics Monitor

This is the **only document a device installer needs**.
Configure your IoT device with the values below and live data will appear on the Envirolytics dashboard within a few seconds.

---

## 1) MQTT broker connection

| Setting        | Value                                                                 |
| -------------- | --------------------------------------------------------------------- |
| **Host**       | `91de182dad0a4aeb8f6eccc0b45dd9c7.s1.eu.hivemq.cloud`                  |
| **Port**       | `8883`                                                                 |
| **Protocol**   | MQTT over TLS (`mqtts://`) — use a TLS-capable client                  |
| **Username**   | `Envirolytics`                                                         |
| **Password**   | `23April2026`                                                          |
| **Keep-alive** | 60 seconds (recommended)                                               |
| **QoS**        | `1` (recommended — at-least-once delivery)                             |
| **Client ID**  | A unique per-device ID, typically the hardware ID (e.g. `FM001`)       |

> ⚠️ The broker currently rejects connection with **rc=5 (Not Authorized)**. If your device sees the same error,
> the username/password above need to be re-activated in the HiveMQ Cloud console (Access Management → Credentials).
> Once enabled there, **no code changes are needed on the dashboard side** — readings will flow immediately.

If you are using a different broker (your own Mosquitto / EMQX / AWS IoT) just update the same four values in
`/app/backend/.env` (`MQTT_BROKER_HOST`, `MQTT_BROKER_PORT`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `MQTT_USE_TLS`) and
restart the backend (`sudo supervisorctl restart backend`).

---

## 2) Topic structure

The portal **only listens** on these topic patterns. Pick the one that matches your instrument type:

| Instrument        | Topic pattern (publish-to)                  | Example                |
| ----------------- | ------------------------------------------- | ---------------------- |
| **Flowmeter**     | `{HARDWARE_ID}/0`                           | `FM001/0`              |
| **DWLR**          | `dwlr/{HARDWARE_ID}/data`                   | `dwlr/DWLR001/data`    |
| **pH meter**      | `ph/{HARDWARE_ID}/data`                     | `ph/PH001/data`        |
| **Conductivity**  | `conductivity/{HARDWARE_ID}/data`           | `conductivity/COND001/data` |
| **TDS meter**     | `tds/{HARDWARE_ID}/data`                    | `tds/TDS001/data`      |

> Topic names are case-sensitive. The portal will silently ignore any topic that doesn't match the patterns above.

After deploying a new device, an admin should also call:
```
POST {API_URL}/api/instruments/subscribe
Headers: Authorization: Bearer <admin-token>
Body:    {"instrument_type":"dwlr","hardware_id":"DWLR001"}
```
…so the backend subscribes to that topic. (Flowmeters auto-subscribe when first seen if the gateway is registered.)

---

## 3) Payload schema (JSON)

Publish **JSON** with the field names below. Extra fields are accepted and stored, but only the listed names show up in the dashboard tiles.

### 3.1 Flowmeter (`{HARDWARE_ID}/0`)
```json
{
  "IMEI":   "865123456789012",
  "IMSI":   "404801234567890",
  "SIGNAL": -65,
  "TIME":   "2026-06-02T08:30:00Z",
  "FLOW":   1500.0,
  "TOT1":   12345,
  "TOT2":   67,
  "RTOT1":  100,
  "RTOT2":  5,
  "UNT":    2,
  "POW":    1,
  "TEMPER": 24.5,
  "VER":    "1.2.0"
}
```
* `FLOW` is in **litres per hour (L/h)**; the dashboard displays it as **L/min** automatically.
* `TOT1` (m³) + `TOT2` (litres) are combined into the **Forward Totalizer**.
* `RTOT1`/`RTOT2` likewise produce the **Reverse Totalizer**.
* `UNT` is the unit code: `1 = m³`, `2 = L`, `3 = US-Gal`, `4 = UK-Gal`.

### 3.2 DWLR — Digital Water Level Recorder (`dwlr/{HW}/data`)
```json
{
  "LEVEL":   15.8,
  "TEMPER":  24.1,
  "BATTERY": 87,
  "TIME":    "2026-06-02T08:30:00Z"
}
```
`LEVEL` is metres below datum. `BATTERY` is integer percent. Dashboard tile shows level + battery %.

### 3.3 pH meter (`ph/{HW}/data`)
```json
{
  "PH":     7.2,
  "TEMPER": 25.0,
  "TIME":   "2026-06-02T08:30:00Z"
}
```

### 3.4 Conductivity (`conductivity/{HW}/data`)
```json
{
  "CONDUCTIVITY": 450,
  "TEMPER":       25.0,
  "TIME":         "2026-06-02T08:30:00Z"
}
```
Unit: **µS/cm**.

### 3.5 TDS meter (`tds/{HW}/data`)
```json
{
  "TDS":    285,
  "TEMPER": 25.0,
  "TIME":   "2026-06-02T08:30:00Z"
}
```
Unit: **ppm**.

> `TIME` is optional — the server stamps `received_at` regardless. Use it only if the device clock is trusted.

---

## 4) Publish frequency

Recommended: **every 1–5 minutes**. The dashboard polls the server every 5 s, so anything faster than that is wasted bandwidth. Anything slower than 15 minutes will make tiles appear "stale".

---

## 5) Verifying the integration

There are three quick ways to confirm a device is talking to the portal:

1. **Login as admin** → `Dashboard`. Within ~5 s the matching tile in
   Water Abstraction / Water Level / Water Quality should show the live value with a green dot.
2. **Hit the public API** (no auth needed):
   ```bash
   curl https://{your-host}/api/instruments/dwlr/latest        # all DWLRs
   curl https://{your-host}/api/instruments/dwlr/DWLR001/latest # one device
   curl https://{your-host}/api/flowmeter/latest                # flowmeters
   ```
3. **Tail backend logs:** `tail -f /var/log/supervisor/backend.out.log` and look for lines like
   `[mqtt] Stored dwlr reading for DWLR001`.

---

## 6) Simulating data without a real device

If your hardware isn't on-site yet, an **admin** can POST a reading directly so the UI lights up:

```bash
TOKEN=$(curl -s -X POST $API/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@envirolytics.com","password":"Admin@Envirolytics2026"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

curl -X POST "$API/api/instruments/ingest?instrument_type=dwlr" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"hardware_id":"DWLR001","values":{"LEVEL":15.8,"TEMPER":24.1,"BATTERY":87}}'
```
Replace `instrument_type` with `dwlr | ph | tds | conductivity`. Reload the dashboard to see the tile turn green.

---

## 7) FAQ

**Q. The portal URL is `process-flow-68.preview.emergentagent.com`. Can it be `environmental.monitoring.<our-domain>.com`?**
**A.** Yes — but not by editing application code. Emergent owns the `*.preview.emergentagent.com` and `*.emergent.host`
domains. After clicking **Deploy** in Emergent, open the project Settings → **Custom Domain** and follow the on-screen
instructions to point your DNS record (CNAME) at the Emergent edge. Once verified, your portal will be reachable on
your custom subdomain alongside the default one.

**Q. Can I add a second client whose location is in another city?**
**A.** Yes. Login as admin → **User** → **Add User** and fill the **Latitude / Longitude / Location Name** fields.
Saving the form drops a green pin on the dashboard map immediately. Use the **Edit** button on any user row to change it later.

**Q. Which instruments are supported today?**
**A.** Flowmeter (Water Abstraction), DWLR (Water Level), pH / Conductivity / TDS (Water Quality). BOD, COD and TSS have been removed by request.

**Q. How are pre/post-monsoon water-quality reports stored?**
**A.** Login as admin → **Certificates** → choose the *Water Quality — Pre-Monsoon* or *Post-Monsoon* tab → **Upload**.
Year filter and download/delete are available. Files are stored on disk at `/app/backend/certificate_files/{type}/{year}/`
and indexed in MongoDB collection `certificates`.
