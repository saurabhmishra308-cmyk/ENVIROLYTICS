"""ESPL / QESPL HTTP telemetry poller.

Polls `https://api.qenggonline.com/api/getLatestDeviceIdData/` every 5 min
for each registered instrument with `source='http'` and stores the resulting
reading in `instrument_readings` + `instrument_latest`.

Response shape (observed live 2026-07):
    [{
      "id": 39,
      "param_1": "7.13#mg/L#DO",
      "param_2": "15.14#%#Saturation",
      "param_3": "29.51#C#Temperature",
      "data_store_time": "2026-07-22T20:51:36"
    }]

Each `param_N` field is `<value>#<unit>#<label>`. We split on `#` and map
common labels (DO, Saturation, Temperature, pH, TSS, TDS, COD, BOD, …) to
canonical uppercase keys stored on `values`. The full parsed dict + raw
response are preserved on the reading for debugging.

Traffic buffer: the last N (default 50) polls are kept in-memory and
served to the frontend "Live HTTP Traffic — ESPL" panel. Failed polls
(non-2xx / timeout / parse-error) are flagged `ok=false` so the UI can
paint them amber.
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from datetime import datetime, timezone, timedelta
from typing import Deque, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

ESPL_ENDPOINT = "https://api.qenggonline.com/api/getLatestDeviceIdData/"
POLL_INTERVAL_SEC = 300  # 5 min per device — the vendor requires ≥300s.
TICK_SEC = 30            # background loop wakes every 30s to check devices
TRAFFIC_BUFFER_SIZE = 50
REQUEST_TIMEOUT_SEC = 25

# Canonical parameter keys (uppercase). Anything unmapped is stored under
# its own upper-cased label (e.g. "SATURATION").
LABEL_MAP = {
    "do": "DO",
    "dissolved oxygen": "DO",
    "saturation": "DO_SATURATION",
    "do saturation": "DO_SATURATION",
    "temperature": "TEMPER",
    "temp": "TEMPER",
    "water temp": "TEMPER",
    "ph": "PH",
    "p h": "PH",
    "tss": "TSS",
    "suspended solids": "TSS",
    "total suspended solids": "TSS",
    "tds": "TDS",
    "cod": "COD",
    "bod": "BOD",
    "orp": "ORP",
    "turbidity": "TURBIDITY",
    "ntu": "TURBIDITY",
    "conductivity": "CONDUCTIVITY",
    "flow": "FLOW",
    "level": "LEVEL",
    # Nitrogen family — the vendor labels these many different ways.
    "ammonical nitrogen": "AMMONICAL_NITROGEN",
    "ammoniacal nitrogen": "AMMONICAL_NITROGEN",
    "ammonia nitrogen": "AMMONICAL_NITROGEN",
    "ammonium nitrogen": "AMMONICAL_NITROGEN",
    "nh3-n": "AMMONICAL_NITROGEN",
    "nh3 n": "AMMONICAL_NITROGEN",
    "nh4-n": "AMMONICAL_NITROGEN",
    "nh4 n": "AMMONICAL_NITROGEN",
    "ammonia": "AMMONIA",
    "nh3": "AMMONIA",
    "nitrate": "NITRATE",
    "nitrate nitrogen": "NITRATE",
    "no3": "NITRATE",
    "no3-n": "NITRATE",
    "nitrite": "NITRITE",
    "no2": "NITRITE",
    "total nitrogen": "TN",
    "tn": "TN",
    "total phosphorus": "TP",
    "tp": "TP",
    "phosphate": "PHOSPHATE",
    "po4": "PHOSPHATE",
    # Chlorine — accept every common label the vendor might send.
    "chlorine": "CHLORINE",
    "free chlorine": "CHLORINE",
    "residual chlorine": "CHLORINE",
    "free residual chlorine": "CHLORINE",
    "cl2": "CHLORINE",
    "cl": "CHLORINE",
    "hocl": "CHLORINE",
    "chlorine dose": "CHLORINE_DOSE",
    "cl2 dose": "CHLORINE_DOSE",
    "chlorine setpoint": "CHLORINE_DOSE",
    "dose setpoint": "CHLORINE_DOSE",
}

# TSS → Turbidity fallback coefficient (device-level `turbidity_k` overrides).
_TURBIDITY_K_DEFAULT = 0.5


class _State:
    """Module-level mutable state — deliberately small."""
    db = None
    task: Optional[asyncio.Task] = None
    traffic: Deque[dict] = deque(maxlen=TRAFFIC_BUFFER_SIZE)
    counters: Dict[str, int] = {"total": 0, "ok": 0, "failed": 0}
    last_poll_at: Dict[str, float] = {}  # deviceId → monotonic
    seq: int = 0


def set_db(database):
    _State.db = database


def get_traffic(limit: int = TRAFFIC_BUFFER_SIZE) -> dict:
    items = list(_State.traffic)[-limit:][::-1]  # newest first
    return {
        "endpoint": ESPL_ENDPOINT,
        "poll_interval_sec": POLL_INTERVAL_SEC,
        "total": _State.counters["total"],
        "ok": _State.counters["ok"],
        "failed": _State.counters["failed"],
        "recent": items,
    }


def _next_seq() -> int:
    _State.seq += 1
    return _State.seq


def _parse_param(raw: str) -> Optional[dict]:
    """Split 'value#unit#label' into {label, value, unit, key}. Returns None
    if the shape is off."""
    if not isinstance(raw, str) or "#" not in raw:
        return None
    parts = raw.split("#")
    if len(parts) < 3:
        return None
    val_s, unit, label = parts[0].strip(), parts[1].strip(), parts[2].strip()
    try:
        value = float(val_s)
    except (TypeError, ValueError):
        value = val_s  # keep as string if not numeric
    key = LABEL_MAP.get(label.lower()) or label.replace(" ", "_").upper()
    return {"key": key, "label": label, "value": value, "unit": unit}


def _values_from_payload(payload: dict) -> Dict[str, float]:
    """Extract param_1..param_N + numeric top-level fields into a canonical
    {KEY: value} dict."""
    values: Dict[str, float] = {}
    for k, v in payload.items():
        if not isinstance(k, str) or not k.startswith("param_"):
            continue
        parsed = _parse_param(v)
        if not parsed:
            continue
        values[parsed["key"]] = parsed["value"]
    return values


async def _persist_reading(device: dict, payload: dict, values: Dict[str, float]):
    """Insert a reading + update the latest cache."""
    now_iso = datetime.now(timezone.utc).isoformat()
    ts = payload.get("data_store_time") or payload.get("timestamp") or now_iso
    # Vendor sends naive "YYYY-MM-DDTHH:MM:SS" — treat as UTC for simplicity.
    if isinstance(ts, str) and "T" in ts and "+" not in ts and "Z" not in ts:
        ts = ts + "Z"
    # DO Analyzer: QESPL emits a single generic `DO` reading per device.
    # Our Water Quality dashboard shows Aeration Tank #1 / #2 as separate
    # tiles keyed on DO_TANK_1 / DO_TANK_2, so we re-label the incoming DO
    # based on the device's admin-configured `aeration_tank_number`.
    if device.get("instrument_type") == "do_meter" and isinstance(values.get("DO"), (int, float)):
        tank_n = device.get("aeration_tank_number")
        try:
            tank_int = int(tank_n) if tank_n is not None else None
        except (TypeError, ValueError):
            tank_int = None
        if tank_int and tank_int > 0:
            values[f"DO_TANK_{tank_int}"] = values["DO"]
            # Keep raw DO too — historical reports & other consumers still
            # rely on the canonical key.
    # If the vendor sent TSS but not turbidity, derive it now using the
    # device-level `turbidity_k` (defaults to 0.5 — TSS/2, domestic-sewage
    # rule of thumb). This mirrors the derivation the /water-quality API
    # applies at read-time for MQTT devices.
    if "TURBIDITY" not in values and isinstance(values.get("TSS"), (int, float)):
        k = device.get("turbidity_k")
        k = float(k) if isinstance(k, (int, float)) else _TURBIDITY_K_DEFAULT
        values["TURBIDITY"] = round(values["TSS"] * k, 2)
    reading = {
        "hardware_id": device["hardware_id"],
        "instrument_type": device.get("instrument_type", "do_meter"),
        "values": values,
        "timestamp": ts,
        "received_at": now_iso,
        "source": "http",
        "raw": payload,   # kept for admin debugging
    }
    # Down-sample HTTPS-polled devices too, per admin-configured
    # `data_frequency_minutes` on the registry.
    freq = device.get("data_frequency_minutes")
    should_store = True
    try:
        freq_int = int(freq) if freq is not None else 0
    except (TypeError, ValueError):
        freq_int = 0
    if freq_int > 0:
        last = await _State.db.instrument_readings.find_one(
            {"hardware_id": device["hardware_id"]},
            {"received_at": 1, "_id": 0},
            sort=[("received_at", -1)],
        )
        last_iso = (last or {}).get("received_at")
        if last_iso:
            try:
                last_dt = datetime.fromisoformat(str(last_iso).replace("Z", "+00:00"))
                if datetime.now(timezone.utc) - last_dt < timedelta(minutes=freq_int):
                    should_store = False
            except ValueError:
                pass
    if should_store:
        await _State.db.instrument_readings.insert_one(dict(reading))
    reading.pop("_id", None)
    await _State.db.instrument_latest.update_one(
        {"hardware_id": device["hardware_id"]},
        {"$set": reading},
        upsert=True,
    )


async def poll_device(client: httpx.AsyncClient, device: dict) -> dict:
    """Poll a single device, persist, and return a traffic-buffer entry."""
    hardware_id = device.get("hardware_id")
    device_id = (device.get("imei") or hardware_id or "").strip()
    started = time.monotonic()
    ts_iso = datetime.now(timezone.utc).isoformat()
    entry: dict = {
        "seq": _next_seq(),
        "ts": ts_iso,
        "device_id": device_id,
        "hardware_id": hardware_id,
        "instrument_type": device.get("instrument_type"),
        "http_status": None,
        "bytes": 0,
        "ok": False,
        "result": "pending",
        "error": None,
    }
    try:
        resp = await client.post(
            ESPL_ENDPOINT,
            json={"deviceId": device_id},
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
        entry["http_status"] = resp.status_code
        raw_bytes = resp.content or b""
        entry["bytes"] = len(raw_bytes)
        if resp.status_code < 200 or resp.status_code >= 300:
            entry["result"] = f"HTTP {resp.status_code}"
            entry["error"] = raw_bytes[:200].decode(errors="ignore")
        else:
            data = resp.json()
            # API returns a JSON array — take the first (latest) element
            payload = data[0] if isinstance(data, list) and data else (data if isinstance(data, dict) else None)
            if not payload:
                entry["result"] = "empty payload"
            else:
                values = _values_from_payload(payload)
                if not values:
                    entry["result"] = "no params parsed"
                else:
                    await _persist_reading(device, payload, values)
                    entry["ok"] = True
                    entry["result"] = f"ok · {len(values)} param(s)"
                    entry["values"] = values
    except httpx.TimeoutException:
        entry["result"] = "timeout"
        entry["error"] = "request timed out"
    except httpx.HTTPError as e:
        entry["result"] = "network error"
        entry["error"] = str(e)[:200]
    except Exception as e:  # noqa: BLE001
        entry["result"] = "parse error"
        entry["error"] = str(e)[:200]
    entry["duration_ms"] = int((time.monotonic() - started) * 1000)
    _State.traffic.append(entry)
    _State.counters["total"] += 1
    if entry["ok"]:
        _State.counters["ok"] += 1
    else:
        _State.counters["failed"] += 1
    _State.last_poll_at[device_id] = time.monotonic()
    return entry


async def _http_devices() -> List[dict]:
    if _State.db is None:
        return []
    cursor = _State.db.instrument_registry.find(
        {"source": "http"},
        {"_id": 0, "hardware_id": 1, "instrument_type": 1, "imei": 1, "owner_user_id": 1, "turbidity_k": 1, "data_frequency_minutes": 1, "aeration_tank_number": 1},
    )
    return await cursor.to_list(length=500)


# ---------------------------------------------------------------- probe / auto-suggest
# Which canonical parameter keys hint at which instrument type. The probe
# endpoint uses this to guess whether an unknown deviceId is a DO Analyzer,
# OCEMS, Chlorine Analyzer, etc., so the admin gets a one-click "Register"
# with the right type pre-selected.
_TYPE_HINTS = {
    "do_meter": {"DO", "DO_SATURATION"},
    "chlorine_analyzer": {"CHLORINE", "CHLORINE_DOSE"},
    "wq_stp": {"PH", "TSS", "TDS", "COD", "BOD", "ORP", "TURBIDITY", "AMMONICAL_NITROGEN", "TN", "TP", "NITRATE"},
    "ph": {"PH"},
    "tds": {"TDS"},
    "conductivity": {"CONDUCTIVITY"},
}


def infer_instrument_type(values: Dict[str, float]) -> str:
    """Return the best-fit instrument_type for a set of parsed parameter keys.

    Priority: DO > Chlorine > OCEMS multi-param > single-param sensors.
    Defaults to `do_meter` — the most common QESPL device profile.
    """
    keys = set(values.keys())
    if _TYPE_HINTS["do_meter"] & keys:
        return "do_meter"
    if _TYPE_HINTS["chlorine_analyzer"] & keys:
        return "chlorine_analyzer"
    if len(_TYPE_HINTS["wq_stp"] & keys) >= 2:
        return "wq_stp"
    for t in ("ph", "tds", "conductivity"):
        if _TYPE_HINTS[t] & keys:
            return t
    return "do_meter"


async def probe_device_id(device_id: str) -> dict:
    """One-shot QESPL fetch for a suspected deviceId.

    Adds a traffic entry (flagged `probe=True`) and, if the response is
    parseable, infers the instrument type from the params. Also reports
    whether the id is already registered so the UI can distinguish
    "adopt existing" from "add new". Never persists a reading —
    this is purely a discovery tool.
    """
    device_id = (device_id or "").strip()
    if not device_id:
        return {"ok": False, "result": "empty deviceId", "device_id": device_id}

    already = None
    if _State.db is not None:
        already = await _State.db.instrument_registry.find_one(
            {"$or": [{"imei": device_id}, {"hardware_id": device_id}]},
            {"_id": 0, "hardware_id": 1, "instrument_type": 1, "label": 1, "source": 1, "owner_user_id": 1},
        )

    started = time.monotonic()
    ts_iso = datetime.now(timezone.utc).isoformat()
    entry: dict = {
        "seq": _next_seq(),
        "ts": ts_iso,
        "device_id": device_id,
        "hardware_id": (already or {}).get("hardware_id"),
        "instrument_type": (already or {}).get("instrument_type"),
        "http_status": None,
        "bytes": 0,
        "ok": False,
        "result": "pending",
        "error": None,
        "probe": True,
    }
    values: Dict[str, float] = {}
    payload = None
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SEC) as client:
            resp = await client.post(
                ESPL_ENDPOINT,
                json={"deviceId": device_id},
                headers={"Content-Type": "application/json", "Accept": "application/json"},
            )
            entry["http_status"] = resp.status_code
            raw_bytes = resp.content or b""
            entry["bytes"] = len(raw_bytes)
            if resp.status_code < 200 or resp.status_code >= 300:
                entry["result"] = f"HTTP {resp.status_code}"
                entry["error"] = raw_bytes[:200].decode(errors="ignore")
            else:
                data = resp.json()
                payload = data[0] if isinstance(data, list) and data else (data if isinstance(data, dict) else None)
                if not payload:
                    entry["result"] = "empty payload"
                else:
                    values = _values_from_payload(payload)
                    if not values:
                        entry["result"] = "no params parsed"
                    else:
                        entry["ok"] = True
                        entry["result"] = f"ok · {len(values)} param(s)"
                        entry["values"] = values
    except httpx.TimeoutException:
        entry["result"] = "timeout"
        entry["error"] = "request timed out"
    except httpx.HTTPError as e:
        entry["result"] = "network error"
        entry["error"] = str(e)[:200]
    except Exception as e:  # noqa: BLE001
        entry["result"] = "parse error"
        entry["error"] = str(e)[:200]

    entry["duration_ms"] = int((time.monotonic() - started) * 1000)
    _State.traffic.append(entry)
    _State.counters["total"] += 1
    if entry["ok"]:
        _State.counters["ok"] += 1
    else:
        _State.counters["failed"] += 1

    inferred = infer_instrument_type(values) if values else None
    return {
        "ok": entry["ok"],
        "device_id": device_id,
        "http_status": entry["http_status"],
        "result": entry["result"],
        "error": entry["error"],
        "values": values,
        "raw": payload,
        "inferred_instrument_type": inferred,
        "already_registered": already,
        "traffic_seq": entry["seq"],
    }


async def poll_all_now() -> dict:
    """Force-poll every registered HTTP device — used by the 'Poll now' button.
    Bypasses the per-device 5-min throttle."""
    devices = await _http_devices()
    if not devices:
        return {"polled": 0, "ok": 0, "failed": 0, "results": []}
    results: List[dict] = []
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SEC) as client:
        for d in devices:
            r = await poll_device(client, d)
            results.append(r)
    ok = sum(1 for r in results if r["ok"])
    return {
        "polled": len(results),
        "ok": ok,
        "failed": len(results) - ok,
        "results": results,
    }


async def _loop():
    """Background loop — every TICK_SEC seconds, polls devices that are due."""
    logger.info(f"[espl] Background loop started (tick={TICK_SEC}s, interval={POLL_INTERVAL_SEC}s)")
    while True:
        try:
            devices = await _http_devices()
            if devices:
                now = time.monotonic()
                due = [d for d in devices
                       if (now - _State.last_poll_at.get((d.get("imei") or d["hardware_id"]).strip(), 0.0)) >= POLL_INTERVAL_SEC]
                if due:
                    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SEC) as client:
                        for d in due:
                            await poll_device(client, d)
            await asyncio.sleep(TICK_SEC)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            logger.error(f"[espl] loop error: {e}")
            await asyncio.sleep(TICK_SEC)


def start_background(app):
    """Called from server.py startup; stores the task on `app.state.espl_task`."""
    app.state.espl_task = asyncio.create_task(_loop())


async def stop_background(app):
    task = getattr(app.state, "espl_task", None)
    if task and not task.done():
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
