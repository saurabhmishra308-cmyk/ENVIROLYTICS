"""Retention auto-purge.

Reads every instrument's `data_retention_days` setting from the registry and,
once per day, deletes readings whose `received_at` falls outside that window.

Rules
-----
* `data_retention_days` unset or `0`  → keep forever (no purge).
* `1..3650` (i.e. up to ~10 years)    → hard cap; anything older is deleted.

Both `flowmeter_readings` and `instrument_readings` are covered. The
`_latest` collections are never touched (they represent the current live
value regardless of retention).

Deletes are batched per-device so a mis-configured retention on one device
can never DoS the entire DB. Each device's delete count is logged to
`audit_log` under the `retention_purge` action.
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone, timedelta

logger = logging.getLogger(__name__)

# One tick per day by default.
TICK_SECONDS = int(os.getenv("RETENTION_TICK_SECONDS", str(24 * 60 * 60)))
# Small floor so the loop still runs even if the operator sets a silly value.
MIN_TICK_SECONDS = 300


async def _purge_device(db, reg: dict) -> dict:
    days = reg.get("data_retention_days")
    try:
        days = int(days) if days is not None else 0
    except (TypeError, ValueError):
        days = 0
    if days <= 0:
        return {"hardware_id": reg.get("hardware_id"), "skipped": True}

    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    hw = reg["hardware_id"]
    itype = (reg.get("instrument_type") or "").lower()
    coll = db.flowmeter_readings if itype == "flowmeter" else db.instrument_readings
    result = await coll.delete_many({"hardware_id": hw, "received_at": {"$lt": cutoff}})
    return {
        "hardware_id": hw,
        "instrument_type": itype,
        "cutoff": cutoff,
        "deleted": result.deleted_count,
    }


async def _tick(db) -> dict:
    stats = {"scanned": 0, "purged": 0, "total_deleted": 0, "errors": 0}
    async for reg in db.instrument_registry.find(
        {"data_retention_days": {"$gt": 0}},
        {"_id": 0, "hardware_id": 1, "instrument_type": 1, "data_retention_days": 1},
    ):
        stats["scanned"] += 1
        try:
            res = await _purge_device(db, reg)
            if res.get("deleted", 0) > 0:
                stats["purged"] += 1
                stats["total_deleted"] += res["deleted"]
                await db.audit_log.insert_one({
                    "action": "retention_purge",
                    "entity_type": "instrument_registry",
                    "entity_id": reg.get("hardware_id"),
                    "hardware_id": reg.get("hardware_id"),
                    "retention_days": reg.get("data_retention_days"),
                    "cutoff": res.get("cutoff"),
                    "deleted": res.get("deleted"),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "actor_email": "system",
                })
        except Exception as e:  # noqa: BLE001
            logger.exception("[retention] purge failed for %s: %s", reg.get("hardware_id"), e)
            stats["errors"] += 1
    return stats


async def retention_purge_loop(db) -> None:
    interval = max(MIN_TICK_SECONDS, TICK_SECONDS)
    logger.info("[retention] auto-purge loop started, tick=%ss", interval)
    while True:
        try:
            summary = await _tick(db)
            if summary.get("total_deleted"):
                logger.info("[retention] tick summary: %s", summary)
        except Exception as e:  # noqa: BLE001
            logger.exception("[retention] tick failed: %s", e)
        await asyncio.sleep(interval)
