"""Device offline alerts.

A device is considered "offline" if its latest reading is older than the configured
threshold (default 2 hours). Scans both `flowmeter_latest` and `instrument_latest`.

Endpoints
---------
GET /api/alerts/offline?hours=2
    Returns the list of devices that have not reported any MQTT data within the
    last `hours` hours. Public (so the dashboard banner can poll without a token).
"""
from datetime import datetime, timezone, timedelta
from typing import List, Optional

from fastapi import APIRouter, Query

router = APIRouter(prefix="/api/alerts", tags=["alerts"])

# Set from server.py
db = None


def set_db(database):
    global db
    db = database


def _parse_iso(value) -> Optional[datetime]:
    """Best-effort ISO-8601 parser that always returns a tz-aware UTC datetime."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not isinstance(value, str) or not value:
        return None
    s = value.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


@router.get("/offline")
async def offline_devices(hours: float = Query(2.0, ge=0.1, le=720)):
    """Return devices whose last reading is older than `hours` hours.

    A device that has never reported at all is NOT listed here — it simply will
    not exist in either `*_latest` collection. (Use the category/registered-devices
    endpoints to surface those.)
    """
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=hours)

    offline: List[dict] = []

    # ---- Flowmeters
    fm_cursor = db.flowmeter_latest.find({}, {"_id": 0}).limit(1000)
    async for doc in fm_cursor:
        last_seen = _parse_iso(doc.get("received_at")) or _parse_iso(doc.get("timestamp"))
        if last_seen is None or last_seen >= cutoff:
            continue
        offline.append({
            "kind": "flowmeter",
            "instrument_type": "flowmeter",
            "hardware_id": doc.get("hardware_id"),
            "last_seen": last_seen.isoformat(),
            "minutes_since_last_seen": int((now - last_seen).total_seconds() // 60),
        })

    # ---- Generic instruments (DWLR, pH, TDS, conductivity, …)
    inst_cursor = db.instrument_latest.find({}, {"_id": 0}).limit(1000)
    async for doc in inst_cursor:
        last_seen = _parse_iso(doc.get("received_at")) or _parse_iso(doc.get("timestamp"))
        if last_seen is None or last_seen >= cutoff:
            continue
        offline.append({
            "kind": "instrument",
            "instrument_type": doc.get("instrument_type"),
            "hardware_id": doc.get("hardware_id"),
            "last_seen": last_seen.isoformat(),
            "minutes_since_last_seen": int((now - last_seen).total_seconds() // 60),
        })

    # Most-stale first
    offline.sort(key=lambda x: x["minutes_since_last_seen"], reverse=True)

    return {
        "threshold_hours": hours,
        "checked_at": now.isoformat(),
        "count": len(offline),
        "offline": offline,
    }
