"""Device offline + limit-breach alerts (user-scoped).

A device is considered "offline" if its latest reading is older than the configured
threshold (default 2 hours). Scans both `flowmeter_latest` and `instrument_latest`.

Endpoints
---------
GET /api/alerts/offline?hours=2
    Returns the list of devices that have not reported any MQTT data within the
    last `hours` hours. Authenticated — scoped to the caller's owned instruments.
    Admin sees everything.

GET /api/alerts/limit-breaches
    Returns flowmeter limits that are currently breached (above max or below
    min) for the caller's owned instruments. Used by the dashboard banner.
"""
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Set

from fastapi import APIRouter, Depends, Query

from auth import get_current_user
import api_instrument_registry

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
async def offline_devices(
    hours: float = Query(2.0, ge=0.1, le=720),
    user: dict = Depends(get_current_user),
):
    """Return devices whose last reading is older than `hours` hours, scoped to the
    caller's visible instruments (admin sees all registered devices)."""
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=hours)

    visible: Set[str] = await api_instrument_registry.visible_hardware_ids(user)
    if not visible:
        return {"threshold_hours": hours, "checked_at": now.isoformat(), "count": 0, "offline": []}

    offline: List[dict] = []

    # ---- Flowmeters
    fm_cursor = db.flowmeter_latest.find({}, {"_id": 0}).limit(1000)
    async for doc in fm_cursor:
        hw = doc.get("hardware_id")
        if hw not in visible:
            continue
        last_seen = _parse_iso(doc.get("received_at")) or _parse_iso(doc.get("timestamp"))
        if last_seen is None or last_seen >= cutoff:
            continue
        offline.append({
            "kind": "flowmeter",
            "instrument_type": "flowmeter",
            "hardware_id": hw,
            "last_seen": last_seen.isoformat(),
            "minutes_since_last_seen": int((now - last_seen).total_seconds() // 60),
        })

    # ---- Generic instruments (DWLR, pH, TDS, conductivity, …)
    inst_cursor = db.instrument_latest.find({}, {"_id": 0}).limit(1000)
    async for doc in inst_cursor:
        hw = doc.get("hardware_id")
        if hw not in visible:
            continue
        last_seen = _parse_iso(doc.get("received_at")) or _parse_iso(doc.get("timestamp"))
        if last_seen is None or last_seen >= cutoff:
            continue
        offline.append({
            "kind": "instrument",
            "instrument_type": doc.get("instrument_type"),
            "hardware_id": hw,
            "last_seen": last_seen.isoformat(),
            "minutes_since_last_seen": int((now - last_seen).total_seconds() // 60),
        })

    # Also surface registered devices that have NEVER reported any data.
    seen_hw = {o["hardware_id"] for o in offline}
    reported_hw: Set[str] = set()
    async for doc in db.flowmeter_latest.find({}, {"_id": 0, "hardware_id": 1}):
        if doc.get("hardware_id"):
            reported_hw.add(doc["hardware_id"])
    async for doc in db.instrument_latest.find({}, {"_id": 0, "hardware_id": 1}):
        if doc.get("hardware_id"):
            reported_hw.add(doc["hardware_id"])

    never_reported = visible - reported_hw - seen_hw
    if never_reported:
        async for reg in db.instrument_registry.find(
            {"hardware_id": {"$in": list(never_reported)}}, {"_id": 0}
        ):
            offline.append({
                "kind": "instrument" if reg.get("instrument_type") != "flowmeter" else "flowmeter",
                "instrument_type": reg.get("instrument_type"),
                "hardware_id": reg.get("hardware_id"),
                "last_seen": None,
                "minutes_since_last_seen": None,
                "never_reported": True,
            })

    # Most-stale first; never-reported last (treated as oldest with None sort)
    offline.sort(key=lambda x: x["minutes_since_last_seen"] or 1e9, reverse=True)

    return {
        "threshold_hours": hours,
        "checked_at": now.isoformat(),
        "count": len(offline),
        "offline": offline,
    }


@router.get("/limit-breaches")
async def limit_breaches(user: dict = Depends(get_current_user)):
    """Return active flowmeter limits whose current-month consumption is OUT of bounds
    for the caller's visible instruments. Admin sees everything."""
    import api_limits  # lazy to avoid circulars

    is_admin = user.get("role") == "admin"
    visible: Optional[Set[str]] = await api_instrument_registry.visible_hardware_ids(user)

    breaches: List[dict] = []
    async for doc in db.flow_limits.find({"is_active": True}, {"_id": 0}):
        hw = doc.get("hardware_id")
        if not is_admin and (visible is None or hw not in visible):
            continue
        cons = await api_limits._month_consumption_kl(hw)
        max_kl = float(doc.get("monthly_limit_kl", 0))
        min_kl = float(doc.get("min_limit_kl", 0))
        kind = None
        if max_kl > 0 and cons > max_kl:
            kind = "exceeded"
        elif min_kl > 0 and cons < min_kl:
            kind = "below_min"
        if not kind:
            continue
        breaches.append({
            "hardware_id": hw,
            "label": doc.get("label") or hw,
            "kind": kind,
            "consumption_kl_this_month": cons,
            "monthly_limit_kl": max_kl,
            "min_limit_kl": min_kl,
        })
    return {"count": len(breaches), "breaches": breaches}
