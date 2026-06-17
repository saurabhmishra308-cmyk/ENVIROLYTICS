"""Live field-data simulator.

Generates realistic IoT readings for the canonical Envirolytics devices and
writes them straight to the `flowmeter_*` / `instrument_*` collections, reusing
the exact same persistence logic as the MQTT path.

Useful for:
  • Showing live data in the dashboard while the HiveMQ broker is being set up.
  • Local development without a physical device on the network.
  • Demo / sales walk-throughs.

Enable by setting `FIELD_SIMULATOR_ENABLED=true` in `backend/.env`.
Disable at any time by setting it back to `false` (or removing the line).
"""
import asyncio
import logging
import math
import os
import random
from datetime import datetime, timezone
from typing import Dict, List

logger = logging.getLogger(__name__)

# ---- canonical device roster (these are the IDs the dashboard expects) ------
FLOWMETERS: List[Dict] = [
    {"hardware_id": "FM_GW_001",  "imei": "SIM000000000001", "base_flow_lph": 12000, "noise": 1500},
    {"hardware_id": "FM_STP_IN",  "imei": "SIM000000000002", "base_flow_lph":  4500, "noise":  600},
    {"hardware_id": "FM_STP_OUT", "imei": "SIM000000000003", "base_flow_lph":  4300, "noise":  500},
]

INSTRUMENTS: List[Dict] = [
    {"hardware_id": "DWLR001", "instrument_type": "dwlr",         "key": "LEVEL",        "base": 4.20, "range": 0.40},
    {"hardware_id": "PH001",   "instrument_type": "ph",           "key": "PH",           "base": 7.40, "range": 0.30},
    {"hardware_id": "TDS001",  "instrument_type": "tds",          "key": "TDS",          "base": 320,  "range":  60},
    {"hardware_id": "COND001", "instrument_type": "conductivity", "key": "CONDUCTIVITY", "base": 580,  "range": 120},
]

# Per-device monotonic counters, accumulated across ticks
_state: Dict[str, Dict] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _diurnal_factor() -> float:
    """A smooth sine-wave that goes 0.6 → 1.4 over a 24-hour cycle so flowmeters
    look like real industrial sites (lower at night, peak ~10 AM and ~6 PM)."""
    h = datetime.now(timezone.utc).hour + datetime.now(timezone.utc).minute / 60.0
    # Two peaks per day
    return 1.0 + 0.4 * math.sin(2 * math.pi * h / 12.0)


def _split_totalizer(total_l: float) -> tuple:
    """Split a total in litres into the device's TOT1 (kL) + TOT2 (L<1000) pair."""
    total_l = max(0.0, total_l)
    kilo = int(total_l // 1000)
    rem  = total_l - kilo * 1000
    return kilo, rem


def _emit_flowmeter(dev: Dict, tick_seconds: float) -> Dict:
    st = _state.setdefault(dev["hardware_id"], {"fwd": 100000.0, "rev": 0.0})
    diurnal = _diurnal_factor()
    flow_lph = max(0.0, dev["base_flow_lph"] * diurnal + random.uniform(-dev["noise"], dev["noise"]))
    flow_lps = flow_lph / 3600.0
    delta_l  = flow_lps * tick_seconds
    st["fwd"] += delta_l
    # tiny back-flow on STP outlet only
    if "STP_OUT" in dev["hardware_id"]:
        st["rev"] += delta_l * 0.001
    tot1, tot2 = _split_totalizer(st["fwd"])
    rtot1, rtot2 = _split_totalizer(st["rev"])
    return {
        "TIME":   _now_iso(),
        "IMEI":   dev["imei"],
        "IMSI":   "",
        "SIGNAL": random.randint(18, 27),
        "FLOW":   round(flow_lph, 2),
        "TOT1":   tot1,
        "TOT2":   round(tot2, 3),
        "RTOT1":  rtot1,
        "RTOT2":  round(rtot2, 3),
        "UNT":    2,  # L
        "POW":    1,
        "TEMPER": round(28.0 + random.uniform(-1.5, 1.5), 1),
        "VER":    "SIM_v1",
    }


def _emit_instrument(dev: Dict) -> Dict:
    val = dev["base"] + random.uniform(-dev["range"], dev["range"]) * 0.5
    payload = {
        "TIME": _now_iso(),
        dev["key"]: round(val, 2),
        "BATT": round(3.6 + random.uniform(-0.15, 0.15), 2),
    }
    # extra fields per instrument type so the secondary chips on the live card render
    if dev["instrument_type"] == "dwlr":
        payload["TEMP_C"]   = round(24.0 + random.uniform(-2, 2), 1)
    elif dev["instrument_type"] == "ph":
        payload["TEMP_C"]   = round(26.0 + random.uniform(-1, 1), 1)
    elif dev["instrument_type"] == "tds":
        payload["TURBIDITY"] = round(2.5 + random.uniform(0, 1.2), 2)
    return payload


async def _tick(mqtt_svc, tick_seconds: float):
    """One round of simulated readings for every device."""
    for d in FLOWMETERS:
        payload = _emit_flowmeter(d, tick_seconds)
        await mqtt_svc.process_flowmeter_data(d["hardware_id"], payload)
    for d in INSTRUMENTS:
        payload = _emit_instrument(d)
        await mqtt_svc.process_instrument_data(d["instrument_type"], d["hardware_id"], payload)


async def background_loop(mqtt_svc):
    """Endless loop. Reads cadence from FIELD_SIMULATOR_INTERVAL_SEC (default 30 s)."""
    if os.environ.get("FIELD_SIMULATOR_ENABLED", "").strip().lower() != "true":
        logger.info("[simulator] disabled (set FIELD_SIMULATOR_ENABLED=true to turn on)")
        return

    interval = float(os.environ.get("FIELD_SIMULATOR_INTERVAL_SEC", "30"))
    logger.info(f"[simulator] live field-data simulator started (interval={interval}s)")
    logger.info(f"[simulator] generating data for: "
                f"flowmeters={[d['hardware_id'] for d in FLOWMETERS]} "
                f"instruments={[d['hardware_id'] for d in INSTRUMENTS]}")
    while True:
        try:
            await asyncio.sleep(interval)
            await _tick(mqtt_svc, interval)
        except asyncio.CancelledError:
            logger.info("[simulator] stopped")
            raise
        except Exception as e:
            logger.error(f"[simulator] tick error: {e}")
