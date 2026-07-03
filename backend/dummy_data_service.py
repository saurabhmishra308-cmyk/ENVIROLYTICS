"""Dummy-data automation for offline instruments.

When a physical instrument goes offline (poor mobile network, hardware fault),
an admin can flip a "Dummy Mode" toggle in the Instruments page. This service
then generates realistic-looking readings for that device at a fixed interval
so the client's dashboards, reports and exports stay populated.

Design goals:
  * Values stay strictly inside the admin-set [min, max] band.
  * Data looks organic — a bounded random walk with a small time-of-day cycle
    and a per-UTC-day offset. No two days ever produce the same series.
  * Real data always wins: if the device sends a real MQTT message within the
    last interval-window, the dummy tick is skipped for that instrument.
  * Every dummy reading is tagged with an internal `_dummy: true` marker in
    `values` so ops can trace it later — but the frontend never surfaces the
    marker.

The service is a simple asyncio background task started from `server.py`.
"""

import asyncio
import hashlib
import logging
import math
import os
import random
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from motor.motor_asyncio import AsyncIOMotorDatabase

logger = logging.getLogger(__name__)

# Time between successive dummy-generator ticks (checks which devices are due).
TICK_SECONDS = int(os.getenv("DUMMY_TICK_SECONDS", "30"))


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _day_seed(hardware_id: str, dt_utc: datetime) -> int:
    """Deterministic per-instrument, per-day seed.

    Uses MD5 (stable across Python interpreter restarts — unlike built-in
    `hash()` which is salted by PYTHONHASHSEED). Combined with the UTC
    day-of-year so different days produce different seeds, guaranteeing no
    two days in the generated series look identical.
    """
    key = f"{hardware_id}|{dt_utc.strftime('%Y%j')}".encode("utf-8")
    digest = hashlib.md5(key, usedforsecurity=False).digest()
    # First 4 bytes as an unsigned int → within Python's random.Random seed range
    return int.from_bytes(digest[:4], "big", signed=False)


def _next_dummy_value(
    prev: Optional[float],
    lo: float,
    hi: float,
    hour_utc: int,
    day_seed: int,
) -> float:
    """Generate the next realistic-looking sample.

    * Starts anchored at the midpoint if there's no history.
    * Random walk with a step std-dev = 1.5% of the range.
    * Small sinusoidal offset over the 24-hour cycle (± 0.5% of range).
    * Per-day offset seeded from the UTC-day-of-year so different days average
      slightly differently (± 2% of range) — guarantees no two days match.
    * Clamped to [lo, hi], then rounded to 2 decimals.
    """
    lo = float(lo)
    hi = float(hi)
    if hi <= lo:
        # Guard against misconfiguration — return the midpoint deterministically.
        return round((lo + hi) / 2.0, 3)
    r = hi - lo

    base = prev if prev is not None else (lo + hi) / 2.0
    # Ensure the anchor is inside the band (in case admin changed bounds since last tick).
    base = min(max(base, lo), hi)

    # Random walk step
    step = random.gauss(0.0, r * 0.015)

    # 24-hour gentle oscillation — mimics diurnal groundwater / draw cycles.
    diurnal = math.sin(2.0 * math.pi * (hour_utc / 24.0)) * (r * 0.005)

    # Per-day offset — deterministic for a given day but different across days.
    day_rng = random.Random(day_seed)
    daily_offset = day_rng.gauss(0.0, r * 0.02)

    value = base + step + diurnal + daily_offset

    # Gentle pull toward the midpoint so the walk doesn't cling to a boundary.
    pull_toward_mid = ((lo + hi) / 2.0 - base) * 0.02
    value += pull_toward_mid

    value = min(max(value, lo), hi)
    return round(value, 3)


async def _find_previous_value(db: AsyncIOMotorDatabase, hw: str,
                                itype: str, key: str) -> Optional[float]:
    """Look up the previous reading value (real or dummy) so the walk stays continuous."""
    if itype == "flowmeter":
        doc = await db.flowmeter_latest.find_one({"hardware_id": hw}, {"_id": 0})
        if doc:
            return doc.get(key)
        return None
    doc = await db.instrument_latest.find_one(
        {"instrument_type": itype, "hardware_id": hw}, {"_id": 0}
    )
    if doc:
        val = (doc.get("values") or {}).get(key)
        if val is not None:
            try:
                return float(val)
            except (TypeError, ValueError):
                return None
    return None


async def _last_real_seen(db: AsyncIOMotorDatabase, hw: str, itype: str) -> Optional[datetime]:
    """Return the timestamp of the last REAL (non-dummy) reading, or None."""
    if itype == "flowmeter":
        doc = await db.flowmeter_readings.find_one(
            {"hardware_id": hw, "_dummy": {"$ne": True}},
            {"received_at": 1, "_id": 0},
            sort=[("received_at", -1)],
        )
    else:
        doc = await db.instrument_readings.find_one(
            {"hardware_id": hw, "instrument_type": itype, "_dummy": {"$ne": True}},
            {"received_at": 1, "_id": 0},
            sort=[("received_at", -1)],
        )
    if not doc or not doc.get("received_at"):
        return None
    try:
        s = doc["received_at"].replace("Z", "+00:00")
        return datetime.fromisoformat(s)
    except (ValueError, AttributeError):
        return None


async def _generate_dwlr(db: AsyncIOMotorDatabase, reg: Dict[str, Any], cfg: Dict[str, Any],
                          ts_utc: Optional[datetime] = None,
                          prev_level: Optional[float] = None,
                          update_latest: bool = True) -> Dict[str, Any]:
    """Generate one DWLR reading. Returns the inserted values dict + prev-level for chaining.

    Passing an explicit `ts_utc` and `prev_level` lets callers backfill history
    without a round-trip to the DB per point.
    """
    hw = reg["hardware_id"]
    now = ts_utc or datetime.now(timezone.utc)
    lo = float(cfg["min_value"])
    hi = float(cfg["max_value"])
    prev = prev_level if prev_level is not None else await _find_previous_value(db, hw, "dwlr", "LEVEL")
    day_seed = _day_seed(hw, now)
    lvl = _next_dummy_value(prev, lo, hi, now.hour, day_seed)

    signal = int(round(random.gauss(18.0, 3.0)))
    signal = max(5, min(30, signal))
    battery = round(random.gauss(5.0, 0.05), 2)
    battery = max(4.5, min(5.5, battery))

    manual_temp = reg.get("manual_water_temp_c")
    wtemp = 0.0
    wt_enbl = 0.0
    if isinstance(manual_temp, (int, float)):
        wtemp = round(manual_temp + random.gauss(0.0, 0.2), 2)
        wt_enbl = 1.0

    # `TIME` field matches the real device wire format: YYMMDDHHMMSS
    time_str = now.strftime("%y%m%d%H%M%S")
    values = {
        "LVL": lvl, "LEVEL": lvl, "RAW": lvl,
        "SIGNAL": signal, "BVOLT": battery,
        "WT_Enbl": wt_enbl, "WTEMP": wtemp,
        "ATEMP": round(random.gauss(32.0, 1.5), 2),
        "IMEI": reg.get("imei") or "",
        "TIME": time_str,
        "VER": "DUMMY-1",
        "_dummy": True,
    }
    doc = {
        "instrument_type": "dwlr",
        "hardware_id": hw,
        "imei": reg.get("imei"),
        "values": values,
        "timestamp": time_str,
        "received_at": now.isoformat(),
        "_dummy": True,
    }
    await db.instrument_readings.insert_one(dict(doc))
    if update_latest:
        await db.instrument_latest.update_one(
            {"instrument_type": "dwlr", "hardware_id": hw},
            {"$set": doc},
            upsert=True,
        )
    logger.info("[dummy] DWLR %s → LVL=%.2f", hw, lvl)
    return {"values": values, "level": lvl}


async def _generate_flowmeter(db: AsyncIOMotorDatabase, reg: Dict[str, Any], cfg: Dict[str, Any],
                               ts_utc: Optional[datetime] = None,
                               prev_flow: Optional[float] = None,
                               prev_fwd: Optional[float] = None,
                               prev_rev: Optional[float] = None,
                               update_latest: bool = True) -> Dict[str, Any]:
    hw = reg["hardware_id"]
    now = ts_utc or datetime.now(timezone.utc)
    lo = float(cfg["min_value"])
    hi = float(cfg["max_value"])
    prev = prev_flow if prev_flow is not None else await _find_previous_value(db, hw, "flowmeter", "flow_rate_lph")
    day_seed = _day_seed(hw, now)
    flow_lph = _next_dummy_value(prev, lo, hi, now.hour, day_seed)
    flow_lpm = round(flow_lph / 60.0, 3)

    interval_hours = float(cfg["interval_seconds"]) / 3600.0
    inc = flow_lph * interval_hours
    pfwd = prev_fwd if prev_fwd is not None else (await _find_previous_value(db, hw, "flowmeter", "forward_totalizer") or 0.0)
    forward_total = round(pfwd + inc, 3)
    tot2 = int(forward_total // 65535)
    tot1 = round(forward_total - tot2 * 65535, 3)
    prev_rev_val = prev_rev if prev_rev is not None else (await _find_previous_value(db, hw, "flowmeter", "reverse_totalizer") or 0.0)
    reverse_total = round(prev_rev_val + random.uniform(0.0, 0.005) * inc, 3)
    rtot2 = int(reverse_total // 65535)
    rtot1 = round(reverse_total - rtot2 * 65535, 3)

    signal = int(round(random.gauss(18.0, 3.0)))
    signal = max(5, min(30, signal))

    reading = {
        "hardware_id": hw,
        "imei": reg.get("imei") or "",
        "imsi": "",
        "signal_strength": signal,
        "timestamp": now.isoformat(),
        "flow_rate_lph": flow_lph,
        "flow_rate_lpm": flow_lpm,
        "tot1": tot1, "tot2": tot2,
        "rtot1": rtot1, "rtot2": rtot2,
        "forward_totalizer": forward_total,
        "reverse_totalizer": reverse_total,
        "unit_code": 2, "unit_name": "L/M",
        "power_status": 1,
        "temperature": round(random.gauss(28.0, 1.0), 2),
        "firmware_version": "DUMMY-1",
        "received_at": now.isoformat(),
        "_dummy": True,
    }
    await db.flowmeter_readings.insert_one(dict(reading))
    if update_latest:
        await db.flowmeter_latest.update_one(
            {"hardware_id": hw},
            {"$set": reading},
            upsert=True,
        )
    logger.info("[dummy] Flowmeter %s → %.2f L/H", hw, flow_lph)
    return {"flow": flow_lph, "fwd": forward_total, "rev": reverse_total}


# ---------------------------------------------------------------------------
# HISTORICAL BACKFILL — generate data for arbitrary past windows
# ---------------------------------------------------------------------------
MAX_BACKFILL_YEARS = 5
MAX_BACKFILL_POINTS = 200_000     # hard cap on rows per backfill call
BULK_INSERT_BATCH = 1_000

async def backfill_history(db: AsyncIOMotorDatabase, reg: Dict[str, Any],
                            from_dt: datetime, to_dt: datetime,
                            interval_seconds: int, lo: float, hi: float) -> Dict[str, Any]:
    """Backfill historical dummy readings for the [from_dt, to_dt] window.

    Produces evenly-spaced readings at `interval_seconds` intervals. Uses the
    same realistic generator as the live loop so the historical data looks
    organically produced.

    The `latest` collection is NOT overwritten unless the last generated
    timestamp is newer than whatever is currently stored.
    """
    if from_dt.tzinfo is None:
        from_dt = from_dt.replace(tzinfo=timezone.utc)
    if to_dt.tzinfo is None:
        to_dt = to_dt.replace(tzinfo=timezone.utc)

    now = datetime.now(timezone.utc)
    if to_dt > now:
        to_dt = now
    earliest = now - timedelta(days=365 * MAX_BACKFILL_YEARS + 2)
    if from_dt < earliest:
        raise ValueError(f"from_date is older than the maximum {MAX_BACKFILL_YEARS}-year backfill window")
    if from_dt >= to_dt:
        raise ValueError("from_date must be before to_date")
    if interval_seconds < 30 or interval_seconds > 86400:
        raise ValueError("interval_seconds must be between 30 and 86400")
    if hi <= lo:
        raise ValueError("max_value must be strictly greater than min_value")

    total_seconds = int((to_dt - from_dt).total_seconds())
    n_points = total_seconds // interval_seconds
    if n_points <= 0:
        raise ValueError("date range is shorter than one interval")
    if n_points > MAX_BACKFILL_POINTS:
        raise ValueError(
            f"date range × interval would generate {n_points:,} rows — "
            f"maximum is {MAX_BACKFILL_POINTS:,}. Use a larger interval_seconds."
        )

    itype = (reg.get("instrument_type") or "dwlr").lower()
    hw = reg["hardware_id"]
    cfg = {"min_value": lo, "max_value": hi, "interval_seconds": interval_seconds}

    inserted = 0
    batch: list = []
    latest_doc = None

    # Chain the walk in-memory to avoid a DB roundtrip per point.
    prev_level = None
    prev_flow = None
    prev_fwd = None
    prev_rev = None

    ts = from_dt
    while ts < to_dt:
        if itype == "flowmeter":
            interval_hours = interval_seconds / 3600.0
            day_seed = _day_seed(hw, ts)
            flow_lph = _next_dummy_value(prev_flow, lo, hi, ts.hour, day_seed)
            flow_lpm = round(flow_lph / 60.0, 3)
            inc = flow_lph * interval_hours
            fwd = round((prev_fwd or 0.0) + inc, 3)
            tot2 = int(fwd // 65535)
            tot1 = round(fwd - tot2 * 65535, 3)
            rev = round((prev_rev or 0.0) + random.uniform(0.0, 0.005) * inc, 3)
            rtot2 = int(rev // 65535)
            rtot1 = round(rev - rtot2 * 65535, 3)
            signal = max(5, min(30, int(round(random.gauss(18.0, 3.0)))))
            reading = {
                "hardware_id": hw,
                "imei": reg.get("imei") or "",
                "imsi": "",
                "signal_strength": signal,
                "timestamp": ts.isoformat(),
                "flow_rate_lph": flow_lph,
                "flow_rate_lpm": flow_lpm,
                "tot1": tot1, "tot2": tot2,
                "rtot1": rtot1, "rtot2": rtot2,
                "forward_totalizer": fwd,
                "reverse_totalizer": rev,
                "unit_code": 2, "unit_name": "L/M",
                "power_status": 1,
                "temperature": round(random.gauss(28.0, 1.0), 2),
                "firmware_version": "DUMMY-1",
                "received_at": ts.isoformat(),
                "_dummy": True,
                "_backfilled": True,
            }
            batch.append(reading)
            latest_doc = reading
            prev_flow = flow_lph
            prev_fwd = fwd
            prev_rev = rev
        else:  # dwlr (default)
            day_seed = _day_seed(hw, ts)
            lvl = _next_dummy_value(prev_level, lo, hi, ts.hour, day_seed)
            signal = max(5, min(30, int(round(random.gauss(18.0, 3.0)))))
            battery = max(4.5, min(5.5, round(random.gauss(5.0, 0.05), 2)))
            manual_temp = reg.get("manual_water_temp_c")
            wtemp = 0.0
            wt_enbl = 0.0
            if isinstance(manual_temp, (int, float)):
                wtemp = round(manual_temp + random.gauss(0.0, 0.2), 2)
                wt_enbl = 1.0
            time_str = ts.strftime("%y%m%d%H%M%S")
            values = {
                "LVL": lvl, "LEVEL": lvl, "RAW": lvl,
                "SIGNAL": signal, "BVOLT": battery,
                "WT_Enbl": wt_enbl, "WTEMP": wtemp,
                "ATEMP": round(random.gauss(32.0, 1.5), 2),
                "IMEI": reg.get("imei") or "",
                "TIME": time_str,
                "VER": "DUMMY-1",
                "_dummy": True,
            }
            reading = {
                "instrument_type": "dwlr",
                "hardware_id": hw,
                "imei": reg.get("imei"),
                "values": values,
                "timestamp": time_str,
                "received_at": ts.isoformat(),
                "_dummy": True,
                "_backfilled": True,
            }
            batch.append(reading)
            latest_doc = reading
            prev_level = lvl

        # Bulk-insert in batches to keep memory bounded
        if len(batch) >= BULK_INSERT_BATCH:
            if itype == "flowmeter":
                await db.flowmeter_readings.insert_many(batch)
            else:
                await db.instrument_readings.insert_many(batch)
            inserted += len(batch)
            batch = []

        ts = ts + timedelta(seconds=interval_seconds)

    # Flush remainder
    if batch:
        if itype == "flowmeter":
            await db.flowmeter_readings.insert_many(batch)
        else:
            await db.instrument_readings.insert_many(batch)
        inserted += len(batch)

    # Update `latest` only if the newest backfilled point is newer than what's stored
    if latest_doc:
        # Remove _id if present (added by insert_many) to avoid immutable field error
        latest_doc_clean = {k: v for k, v in latest_doc.items() if k != "_id"}
        if itype == "flowmeter":
            existing = await db.flowmeter_latest.find_one({"hardware_id": hw}, {"received_at": 1})
            if not existing or (existing.get("received_at") or "") < latest_doc_clean["received_at"]:
                await db.flowmeter_latest.update_one(
                    {"hardware_id": hw}, {"$set": latest_doc_clean}, upsert=True
                )
        else:
            existing = await db.instrument_latest.find_one(
                {"instrument_type": "dwlr", "hardware_id": hw}, {"received_at": 1}
            )
            if not existing or (existing.get("received_at") or "") < latest_doc_clean["received_at"]:
                await db.instrument_latest.update_one(
                    {"instrument_type": "dwlr", "hardware_id": hw},
                    {"$set": latest_doc_clean}, upsert=True
                )

    logger.info("[dummy] backfilled %d rows for %s (%s → %s, every %ds)",
                inserted, hw, from_dt.isoformat(), to_dt.isoformat(), interval_seconds)
    return {
        "hardware_id": hw,
        "instrument_type": itype,
        "inserted_count": inserted,
        "from_date": from_dt.isoformat(),
        "to_date": to_dt.isoformat(),
        "interval_seconds": interval_seconds,
        "min_value": lo,
        "max_value": hi,
    }


async def _tick(db: AsyncIOMotorDatabase) -> None:
    """One tick of the dummy generator — iterates over enabled instruments."""
    cursor = db.instrument_registry.find(
        {"dummy_config.enabled": True},
        {"_id": 0},
    )
    now = datetime.now(timezone.utc)
    async for reg in cursor:
        cfg = reg.get("dummy_config") or {}
        if not cfg.get("enabled"):
            continue
        if cfg.get("min_value") is None or cfg.get("max_value") is None:
            continue
        interval = int(cfg.get("interval_seconds") or 900)

        # Check when we last generated (or received real data)
        real_last = await _last_real_seen(db, reg["hardware_id"], reg.get("instrument_type", "dwlr"))
        last_gen_iso = cfg.get("last_generated_at")
        last_gen = None
        if last_gen_iso:
            try:
                last_gen = datetime.fromisoformat(last_gen_iso.replace("Z", "+00:00"))
            except ValueError:
                last_gen = None

        # Skip if a REAL message arrived within the interval — real data wins.
        if real_last and (now - real_last).total_seconds() < interval:
            continue
        # Skip if we already generated one this interval.
        if last_gen and (now - last_gen).total_seconds() < interval:
            continue

        try:
            itype = (reg.get("instrument_type") or "dwlr").lower()
            if itype == "flowmeter":
                await _generate_flowmeter(db, reg, cfg)
            else:
                await _generate_dwlr(db, reg, cfg)
            await db.instrument_registry.update_one(
                {"hardware_id": reg["hardware_id"]},
                {"$set": {"dummy_config.last_generated_at": _iso_now()}},
            )
        except Exception:  # noqa: BLE001
            logger.exception("[dummy] generation failed for %s", reg.get("hardware_id"))


async def dummy_data_loop(db: AsyncIOMotorDatabase) -> None:
    """Long-running background task started from `server.py`."""
    logger.info("[dummy] background loop started (tick=%ss)", TICK_SECONDS)
    while True:
        try:
            await _tick(db)
        except Exception:  # noqa: BLE001
            logger.exception("[dummy] tick failed")
        await asyncio.sleep(TICK_SECONDS)
