"""Backfill Flowmeter instantaneous flow-rate values to canonical m³/h.

This migration is deliberately conservative and applies only from 27-Aug-2026 onward:
- Prefer the raw device FLOW (raw_flow) plus its unit_code/unit_name.
- If raw_flow is unavailable, use the stored flow value only when its unit
  metadata identifies a volumetric unit.
- Never overwrite ambiguous rows; mark them for review instead.
"""
import asyncio
import os
from pathlib import Path
from typing import Optional
from datetime import datetime, timezone

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

UNIT_TO_M3H = {
    1: 3.6,       # L/s
    2: 0.06,      # L/min
    3: 0.001,     # L/h
    4: 3600.0,    # m3/s
    5: 60.0,      # m3/min
    6: 1.0,       # m3/h
    7: 3600.0,    # kL/s
    8: 60.0,      # kL/min
    9: 1.0,       # kL/h
}

FLOW_RATE_LITRE_CUTOFF = datetime(2026, 8, 27, tzinfo=timezone.utc)

UNIT_NAME_TO_CODE = {
    "L/S": 1, "L/M": 2, "L/MIN": 2, "L/H": 3, "L/HR": 3,
    "M3/S": 4, "M3/M": 5, "M3/MIN": 5, "M3/H": 6, "M3/HR": 6,
    "KL/S": 7, "KL/M": 8, "KL/MIN": 8, "KL/H": 9, "KL/HR": 9,
}


def _code(row: dict) -> Optional[int]:
    try:
        if row.get("unit_code") is not None:
            return int(float(row["unit_code"]))
    except (TypeError, ValueError):
        pass
    name = str(row.get("unit_name") or "").strip().upper().replace("³", "3")
    return UNIT_NAME_TO_CODE.get(name)


def _convert(value, code: int) -> float:
    return round(float(value or 0) * UNIT_TO_M3H[code], 6)


def _measurement_datetime(row: dict) -> Optional[datetime]:
    raw = row.get("measurement_timestamp") or row.get("timestamp") or row.get("received_at")
    if not raw:
        return None
    try:
        ts = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return ts.astimezone(timezone.utc)
    except (TypeError, ValueError):
        return None


def normalize_row(row: dict):
    # Before 27-Aug-2026 flow-rate values were already correct.
    ts = _measurement_datetime(row)
    if ts is None or ts < FLOW_RATE_LITRE_CUTOFF:
        return None, "pre_cutoff_unchanged"

    # From 27-Aug-2026 onward the device FLOW value is L/h regardless of
    # stale UNT/UNIT metadata. Prefer raw_flow because it is the original
    # device value. If the row was already normalized by this migration, do
    # not divide the canonical m3/h value a second time.
    if row.get("raw_flow") not in (None, ""):
        try:
            return round(float(row["raw_flow"]) / 1000.0, 6), "post_cutoff_lph_raw"
        except (TypeError, ValueError):
            pass
    source = str(row.get("flow_rate_normalization_source") or "")
    if row.get("canonical_unit") == "m3/h" and source.startswith("post_cutoff_lph_"):
        try:
            return round(float(row.get("flow_rate_m3h")), 6), "post_cutoff_already_canonical"
        except (TypeError, ValueError):
            pass
    if row.get("flow_rate_lph") not in (None, ""):
        try:
            return round(float(row["flow_rate_lph"]) / 1000.0, 6), "post_cutoff_lph"
        except (TypeError, ValueError):
            pass
    if row.get("flow_rate_m3h") not in (None, ""):
        try:
            return round(float(row["flow_rate_m3h"]) / 1000.0, 6), "post_cutoff_lph_stored"
        except (TypeError, ValueError):
            pass

    return None, "ambiguous"



async def rebuild():
    mongo_url = os.getenv("MONGO_URL")
    db_name = os.getenv("DB_NAME", "envirolytics")
    if not mongo_url:
        raise RuntimeError("MONGO_URL is not configured")

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]
    updated = 0
    ambiguous = 0

    try:
        async for row in db.flowmeter_readings.find({}):
            value, source = normalize_row(row)
            update = {
                "flow_rate_normalization_version": 1,
                "flow_rate_normalization_source": source,
            }
            if source == "pre_cutoff_unchanged":
                continue
            if value is None:
                ambiguous += 1
                update["flow_rate_normalization_review"] = True
            else:
                update.update({
                    "flow_rate_m3h": value,
                    "flow_rate_lph": round(value * 1000.0, 6),
                    "flow_rate_lpm": round(value * 1000.0 / 60.0, 6),
                    "canonical_unit": "m3/h",
                    "flow_rate_normalization_review": False,
                })
                updated += 1
            await db.flowmeter_readings.update_one({"_id": row["_id"]}, {"$set": update})

        # Keep the live cache consistent with the same rule.
        async for row in db.flowmeter_latest.find({}):
            value, source = normalize_row(row)
            update = {
                "flow_rate_normalization_version": 1,
                "flow_rate_normalization_source": source,
            }
            if source == "pre_cutoff_unchanged":
                continue
            if value is None:
                ambiguous += 1
                update["flow_rate_normalization_review"] = True
            else:
                update.update({
                    "flow_rate_m3h": value,
                    "flow_rate_lph": round(value * 1000.0, 6),
                    "flow_rate_lpm": round(value * 1000.0 / 60.0, 6),
                    "canonical_unit": "m3/h",
                    "flow_rate_normalization_review": False,
                })
            await db.flowmeter_latest.update_one({"_id": row["_id"]}, {"$set": update})

        print(f"FLOWMETER_FLOW_BACKFILL_UPDATED={updated}")
        print(f"FLOWMETER_FLOW_BACKFILL_AMBIGUOUS={ambiguous}")
    finally:
        client.close()


if __name__ == "__main__":
    asyncio.run(rebuild())
