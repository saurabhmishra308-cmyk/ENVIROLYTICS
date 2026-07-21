"""QESPL device-data poller (Dissolved Oxygen & Water Quality).

Polls the QESPL "getLatestDeviceIdData" API for every instrument whose
`device_source == "qespl_api"` and forwards the response through the SAME
`mqtt_service.process_instrument_data()` handler used by MQTT + HTTPS ingestion
paths — so downstream storage, alerts, limits, and dashboard rendering all
behave identically.

Key rules (from QESPL_Latest_Device_Data_API_Integration_Guide.pdf):
  - Endpoint: POST https://api.qenggonline.com/api/getLatestDeviceIdData/
  - Body: {"deviceId": "<DTU-serial>"}
  - Headers: Accept: application/json  (Content-Type set automatically by aiohttp)
  - Mandatory min interval: 5 min per device
  - One device per request (no batching)
  - Timeout: 30 s

Auth: per the PDF's Python example, no auth headers are added. When QESPL
provides a token later, set env `QESPL_AUTH_HEADER` (e.g. `Authorization`)
and `QESPL_AUTH_VALUE` (e.g. `Bearer XXXX`) — poller will include them
automatically.

Nothing in this module writes to flowmeter or DWLR collections; it exclusively
handles instruments explicitly tagged `device_source="qespl_api"`. Legacy
MQTT-based flowmeter and DWLR devices are 100% untouched.
"""
import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import aiohttp

logger = logging.getLogger(__name__)

QESPL_API_URL = os.getenv(
    "QESPL_API_URL",
    "https://api.qenggonline.com/api/getLatestDeviceIdData/",
)
QESPL_MIN_INTERVAL_SEC = int(os.getenv("QESPL_MIN_INTERVAL_SEC", "300"))  # 5 min per PDF
QESPL_HTTP_TIMEOUT_SEC = int(os.getenv("QESPL_HTTP_TIMEOUT_SEC", "30"))
QESPL_AUTH_HEADER = os.getenv("QESPL_AUTH_HEADER", "").strip() or None
QESPL_AUTH_VALUE = os.getenv("QESPL_AUTH_VALUE", "").strip() or None

# Wired from server.py
db = None
mqtt_service = None


def set_deps(database, mqtt_svc):
    global db, mqtt_service
    db = database
    mqtt_service = mqtt_svc


def _headers() -> Dict[str, str]:
    h: Dict[str, str] = {"Accept": "application/json"}
    if QESPL_AUTH_HEADER and QESPL_AUTH_VALUE:
        h[QESPL_AUTH_HEADER] = QESPL_AUTH_VALUE
    return h


async def _fetch_one(session: aiohttp.ClientSession, qespl_device_id: str) -> Optional[Dict[str, Any]]:
    """Fetch the latest reading for a single QESPL DTU. Returns a normalised
    flat dict `{PARAM_NAME: numeric_value, PARAM_NAME_unit: "unit_string",
    TIME: iso8601, _raw: […original array…]}` on success, or None on failure.

    QESPL returns an ARRAY of one object per fetch, e.g.::

        [{"id": 1046,
          "param_1": "10.44#m#Level",
          "param_2": "24.8#C#Temperature",
          "data_store_time": "2026-07-21T18:48:34"}]

    Each param string is `<value>#<unit>#<name>`. We split that into the
    downstream schema so the same dashboard components that render MQTT
    payloads work unchanged.
    """
    try:
        async with session.post(
            QESPL_API_URL,
            json={"deviceId": qespl_device_id},
            headers=_headers(),
            timeout=aiohttp.ClientTimeout(total=QESPL_HTTP_TIMEOUT_SEC),
        ) as resp:
            if resp.status >= 400:
                text = await resp.text()
                logger.warning(f"[qespl] {qespl_device_id} → HTTP {resp.status}: {text[:200]}")
                return None
            try:
                data = await resp.json(content_type=None)
            except Exception as e:
                text = await resp.text()
                logger.warning(f"[qespl] {qespl_device_id} → invalid JSON: {e} · body {text[:200]}")
                return None
    except asyncio.TimeoutError:
        logger.warning(f"[qespl] {qespl_device_id} → timeout after {QESPL_HTTP_TIMEOUT_SEC}s")
        return None
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[qespl] {qespl_device_id} → error: {e}")
        return None

    # QESPL returns an ARRAY (usually 1 element = latest reading).
    if isinstance(data, list):
        if not data:
            logger.info(f"[qespl] {qespl_device_id} → empty array (no data yet)")
            return None
        record = data[0]
    elif isinstance(data, dict):
        record = data
    else:
        logger.warning(f"[qespl] {qespl_device_id} → unexpected shape: {str(data)[:200]}")
        return None

    if not isinstance(record, dict):
        return None

    return _normalise_qespl_record(record)


def _normalise_qespl_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """Turn one QESPL record into our flat dashboard-friendly payload.

    Input:  {"id":1046,"param_1":"10.44#m#Level",
             "param_2":"7.42#pH#pH",
             "data_store_time":"2026-07-21T18:48:34"}
    Output: {"LEVEL":10.44, "LEVEL_unit":"m",
             "PH":7.42, "PH_unit":"pH",
             "TIME":"2026-07-21T18:48:34+00:00",
             "_qespl_id":1046, "_raw":{…}}
    """
    out: Dict[str, Any] = {"_raw": record}

    if "id" in record:
        out["_qespl_id"] = record["id"]

    # Timestamp
    ts = record.get("data_store_time") or record.get("timestamp") or record.get("time")
    if isinstance(ts, str):
        # QESPL stamps look like "2026-07-21T18:48:34" (no tz).  Assume they
        # are in IST (UTC+5:30) as per PDF context; store as UTC ISO 8601.
        try:
            from datetime import datetime as _dt, timedelta as _td, timezone as _tz
            naive = _dt.fromisoformat(ts.replace("Z", ""))
            aware_ist = naive.replace(tzinfo=_tz(_td(hours=5, minutes=30)))
            out["TIME"] = aware_ist.astimezone(_tz.utc).isoformat()
        except Exception:
            out["TIME"] = ts
    elif ts:
        out["TIME"] = str(ts)

    # Every "param_N" key → split on '#' → value#unit#name → store under NAME
    for k, v in record.items():
        if not (isinstance(k, str) and k.lower().startswith("param_")):
            continue
        if not isinstance(v, str):
            continue
        parts = v.split("#")
        if len(parts) < 3:
            continue
        raw_value, unit, name = parts[0].strip(), parts[1].strip(), "#".join(parts[2:]).strip()
        if not name:
            continue
        norm_name = _normalise_param_name(name)
        try:
            num = float(raw_value)
        except (TypeError, ValueError):
            num = None
        if num is None:
            out[norm_name] = raw_value
        else:
            out[norm_name] = num
        if unit:
            out[f"{norm_name}_unit"] = unit

    return out


# Map QESPL parameter names → canonical keys used elsewhere in the app
_QESPL_NAME_ALIASES = {
    "level": "LEVEL",
    "waterlevel": "LEVEL",
    "temperature": "TEMPER",
    "temp": "TEMPER",
    "ph": "PH",
    "do": "DO",
    "dissolvedoxygen": "DO",
    "tds": "TDS",
    "tss": "TSS",
    "cod": "COD",
    "bod": "BOD",
    "orp": "ORP",
    "conductivity": "COND",
    "ec": "COND",
    "turbidity": "TURBIDITY",
    "chlorine": "CHLORINE",
    "freechlorine": "CHLORINE",
    "residualchlorine": "CHLORINE",
    "flow": "FLOW",
    "salinity": "SALINITY",
}


def _normalise_param_name(name: str) -> str:
    """Convert QESPL param name to a canonical uppercase key used app-wide."""
    key = "".join(ch for ch in name.lower() if ch.isalnum())
    return _QESPL_NAME_ALIASES.get(key, name.strip().upper().replace(" ", "_"))


async def poll_once(session: Optional[aiohttp.ClientSession] = None) -> Dict[str, Any]:
    """One full pass over every `device_source=qespl_api` registry row.
    Safe to call from a manual admin endpoint too."""
    if db is None or mqtt_service is None:
        logger.error("[qespl] poll_once called before set_deps")
        return {"polled": 0, "ok": 0, "failed": 0}

    cursor = db.instrument_registry.find(
        {"device_source": "qespl_api"},
        {"_id": 0, "hardware_id": 1, "instrument_type": 1, "qespl_device_id": 1},
    )
    devices = await cursor.to_list(length=1000)
    if not devices:
        return {"polled": 0, "ok": 0, "failed": 0}

    close_session = False
    if session is None:
        session = aiohttp.ClientSession()
        close_session = True

    ok = 0
    failed = 0
    try:
        for d in devices:
            qespl_id = (d.get("qespl_device_id") or "").strip()
            hardware_id = d.get("hardware_id")
            itype = d.get("instrument_type") or "dometer"
            if not qespl_id or not hardware_id:
                logger.info(f"[qespl] skipping {hardware_id}: no qespl_device_id")
                failed += 1
                continue

            payload = await _fetch_one(session, qespl_id)
            if payload is None:
                failed += 1
                continue

            # Enrich with metadata so downstream code has a consistent timestamp
            payload.setdefault("TIME", datetime.now(timezone.utc).isoformat())
            payload.setdefault("_source", "qespl_api")
            payload.setdefault("_qespl_device_id", qespl_id)

            try:
                await mqtt_service.process_instrument_data(itype, hardware_id, payload)
                ok += 1
                logger.info(f"[qespl] stored reading for {hardware_id} ({itype}) from DTU {qespl_id}")
            except Exception as e:  # noqa: BLE001
                logger.exception(f"[qespl] processing failed for {hardware_id}: {e}")
                failed += 1

            # Small courtesy gap between device calls
            await asyncio.sleep(0.5)
    finally:
        if close_session:
            await session.close()

    return {"polled": len(devices), "ok": ok, "failed": failed}


async def background_loop():
    """Runs forever, one poll every QESPL_MIN_INTERVAL_SEC seconds. Started
    from server.py startup_event; cancellation-safe."""
    logger.info(f"[qespl] background poller started (interval={QESPL_MIN_INTERVAL_SEC}s)")
    async with aiohttp.ClientSession() as session:
        while True:
            try:
                result = await poll_once(session)
                if result["polled"] > 0:
                    logger.info(f"[qespl] pass done · {result}")
            except asyncio.CancelledError:
                logger.info("[qespl] background poller cancelled")
                raise
            except Exception as e:  # noqa: BLE001
                logger.exception(f"[qespl] loop error: {e}")
            await asyncio.sleep(QESPL_MIN_INTERVAL_SEC)
