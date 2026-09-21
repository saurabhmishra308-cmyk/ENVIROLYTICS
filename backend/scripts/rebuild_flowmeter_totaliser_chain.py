#!/usr/bin/env python3
"""Backfill canonical Flowmeter totaliser chain in production MongoDB.

Raw forward_totalizer values are never changed. Existing records are ordered
by device measurement time and receive canonical KL chain fields:
initial_forward_totalizer_kl, final_forward_totalizer_kl,
totaliser_start_reading, totaliser_end_reading, and consumption_kl.
The first chronological reading starts at its own final value.
The operation is idempotent and safe to run repeatedly.
"""
import asyncio
import os
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
CUTOFF = datetime(2026, 8, 27, tzinfo=timezone.utc)


def parse_ts(value):
    if not value:
        return None
    try:
        ts = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def totaliser_kl(raw, ts):
    try:
        value = float(raw or 0)
    except (TypeError, ValueError):
        value = 0.0
    return value / 1000.0 if ts and ts >= CUTOFF else value


async def rebuild():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    coll = db.flowmeter_readings
    updated = 0

    for hardware_id in await coll.distinct("hardware_id"):
        cursor = coll.find(
            {"hardware_id": hardware_id},
            {"_id": 1, "forward_totalizer": 1, "measurement_timestamp": 1,
             "timestamp": 1, "received_at": 1},
        )
        rows = []
        async for row in cursor:
            ts = (parse_ts(row.get("measurement_timestamp"))
                  or parse_ts(row.get("timestamp"))
                  or parse_ts(row.get("received_at")))
            if ts:
                rows.append((ts, row))
        rows.sort(key=lambda item: (item[0], str(item[1]["_id"])))

        previous_final = None
        for ts, row in rows:
            final_kl = totaliser_kl(row.get("forward_totalizer"), ts)
            initial_kl = final_kl if previous_final is None else previous_final
            consumption_kl = max(0.0, final_kl - initial_kl)
            await coll.update_one(
                {"_id": row["_id"]},
                {"$set": {
                    "initial_forward_totalizer_kl": round(initial_kl, 6),
                    "final_forward_totalizer_kl": round(final_kl, 6),
                    "totaliser_start_reading": round(initial_kl, 6),
                    "totaliser_end_reading": round(final_kl, 6),
                    "consumption_kl": round(consumption_kl, 6),
                    "totaliser_chain_version": 1,
                }},
            )
            previous_final = final_kl
            updated += 1

    await client.close()
    print(f"FLOWMETER_TOTALISER_BACKFILL_UPDATED={updated}")


if __name__ == "__main__":
    asyncio.run(rebuild())
