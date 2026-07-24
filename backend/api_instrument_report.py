"""Instrument Report — connectivity + power-cycle timeline per device.

Endpoint
--------
GET /api/instrument-report/events?days=7
    Returns, grouped by owner (user), each of their instruments' offline /
    back-online / power-cycle events in the given lookback window (1..90d).

How events are derived
----------------------
Every stored reading (in `flowmeter_readings` + `instrument_readings`) is
inspected chronologically per device:

  * **offline_started** — the last reading before a gap larger than
    `OFFLINE_THRESHOLD_HOURS` (2 h by default, matching the offline-alerts
    banner).
  * **back_online**    — the first reading arriving *after* such a gap.
  * **power_cycle**    — reported when EITHER:
      1. The payload carries an explicit boot marker (RB / BOOT / PWR /
         START / RESET) whose numeric value changed vs. the previous
         reading, OR
      2. The gap that just ended was ≥ `POWER_CYCLE_HOURS` (4 h by
         default) — the device most likely lost mains + restarted.

The current-state field (`state`: `online` | `offline` | `no_data`) is
computed from the last reading vs. now.

Only real readings are used — synthetic (`_dummy: true`) readings are
excluded from every query, so no fake data ever appears in this report.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/instrument-report", tags=["instrument-report"])

# Set from server.py
db = None


def set_db(database):
    global db
    db = database


# --------------------------------------------------------------------------- config
OFFLINE_THRESHOLD_HOURS = float(os.getenv("OFFLINE_THRESHOLD_HOURS", "2"))
POWER_CYCLE_HOURS       = float(os.getenv("POWER_CYCLE_HOURS", "4"))
BOOT_FIELDS = ("RB", "BOOT", "PWR", "START", "RESET", "REBOOT")


def _parse_iso(s) -> Optional[datetime]:
    if not s or not isinstance(s, str):
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def _pick_ts(row: dict) -> Optional[datetime]:
    """Pick the best timestamp — `received_at` (ingest time) is preferred so
    events line up with when the backend actually saw the reading. Falls back
    to `timestamp` (device wall clock) when absent."""
    return _parse_iso(row.get("received_at")) or _parse_iso(row.get("timestamp"))


def _boot_marker(row: dict) -> Optional[float]:
    """Return the numeric boot / reset counter from a reading, if any."""
    values = row.get("values") or {}
    src = values if isinstance(values, dict) else {}
    # Some flowmeter payloads flatten these onto the root.
    for f in BOOT_FIELDS:
        if f in src and src[f] is not None:
            try:
                return float(src[f])
            except (TypeError, ValueError):
                continue
        if f in row and row[f] is not None:
            try:
                return float(row[f])
            except (TypeError, ValueError):
                continue
    return None


def _fmt_gap_minutes(delta_seconds: float) -> int:
    return max(0, int(round(delta_seconds / 60.0)))


async def _events_for_instrument(reg: dict, start: datetime) -> Dict:
    """Scan a single instrument's readings and emit the event list."""
    hw = reg["hardware_id"]
    itype = (reg.get("instrument_type") or "").lower()
    collection = db.flowmeter_readings if itype == "flowmeter" else db.instrument_readings

    query = {
        "hardware_id": hw,
        "received_at": {"$gte": start.isoformat()},
        "_dummy": {"$ne": True},
    }
    # instrument_readings additionally has instrument_type for scoping
    if itype and itype != "flowmeter":
        query["instrument_type"] = itype

    projection = {"_id": 0, "received_at": 1, "timestamp": 1, "values": 1}
    # flowmeter payload flattens booleans onto the root — include them so
    # `_boot_marker` can spot boot flags there too.
    if itype == "flowmeter":
        for f in BOOT_FIELDS:
            projection[f] = 1

    rows: List[dict] = []
    async for r in collection.find(query, projection).sort("received_at", 1):
        ts = _pick_ts(r)
        if ts is None:
            continue
        rows.append({"ts": ts, "row": r, "boot": _boot_marker(r)})

    events: List[dict] = []
    offline_threshold = timedelta(hours=OFFLINE_THRESHOLD_HOURS)
    power_cycle_gap = timedelta(hours=POWER_CYCLE_HOURS)
    prev_boot: Optional[float] = None
    first_seen: Optional[datetime] = rows[0]["ts"] if rows else None
    last_seen: Optional[datetime] = rows[-1]["ts"] if rows else None

    for i, item in enumerate(rows):
        cur_ts = item["ts"]
        cur_boot = item["boot"]

        if i > 0:
            gap = cur_ts - rows[i - 1]["ts"]
            if gap >= offline_threshold:
                events.append({
                    "type": "offline_started",
                    "at": rows[i - 1]["ts"].isoformat(),
                    "gap_minutes": _fmt_gap_minutes(gap.total_seconds()),
                })
                events.append({
                    "type": "back_online",
                    "at": cur_ts.isoformat(),
                    "gap_minutes": _fmt_gap_minutes(gap.total_seconds()),
                })
                # Long-gap heuristic → power cycle
                if gap >= power_cycle_gap:
                    events.append({
                        "type": "power_cycle",
                        "at": cur_ts.isoformat(),
                        "reason": f"back online after {_fmt_gap_minutes(gap.total_seconds())} min offline",
                    })

        # Explicit boot-field change → power cycle
        if cur_boot is not None and prev_boot is not None and cur_boot != prev_boot:
            events.append({
                "type": "power_cycle",
                "at": cur_ts.isoformat(),
                "reason": f"boot counter changed {prev_boot:g} → {cur_boot:g}",
            })
        if cur_boot is not None:
            prev_boot = cur_boot

    # Determine current state
    now = datetime.now(timezone.utc)
    if last_seen is None:
        state = "no_data"
    elif (now - last_seen) > offline_threshold:
        state = "offline"
    else:
        state = "online"

    # Count each event type for the summary chips
    counts = {"offline_started": 0, "back_online": 0, "power_cycle": 0}
    for ev in events:
        counts[ev["type"]] = counts.get(ev["type"], 0) + 1

    return {
        "hardware_id": hw,
        "instrument_type": itype,
        "label": reg.get("label") or hw,
        "location_name": reg.get("location_name"),
        "imei": reg.get("imei"),
        "first_seen": first_seen.isoformat() if first_seen else None,
        "last_seen": last_seen.isoformat() if last_seen else None,
        "state": state,
        "events": events,
        "counts": counts,
        "reading_count": len(rows),
    }


@router.get("/events")
async def instrument_events(
    days: int = Query(7, ge=1, le=90, description="Lookback window in days"),
    user: dict = Depends(get_current_user),
):
    """Grouped connectivity + power-cycle timeline.

    * Admin — sees every user and every registered device.
    * Client / sub-user — sees only their own installed instruments.
    """
    if db is None:
        raise HTTPException(status_code=503, detail="Database not initialised")

    start = datetime.now(timezone.utc) - timedelta(days=days)
    is_admin = user.get("role") == "admin"

    # Load registered instruments — admins see all, everyone else only their own.
    reg_query: Dict = {} if is_admin else {"owner_user_id": user.get("id")}
    registry: List[dict] = []
    async for reg in db.instrument_registry.find(reg_query, {"_id": 0}):
        registry.append(reg)

    owner_ids = list({r.get("owner_user_id") for r in registry if r.get("owner_user_id")})
    owners: Dict[str, dict] = {}
    if owner_ids:
        async for u in db.users.find(
            {"id": {"$in": owner_ids}},
            {"_id": 0, "id": 1, "email": 1, "full_name": 1, "company_name": 1, "location_name": 1, "role": 1},
        ):
            owners[u["id"]] = u

    # Build per-user grouping
    users_map: Dict[str, dict] = {}
    for reg in registry:
        oid = reg.get("owner_user_id") or "unassigned"
        owner = owners.get(oid) if oid != "unassigned" else None
        user_entry = users_map.setdefault(oid, {
            "user_id": oid,
            "email": (owner or {}).get("email"),
            "full_name": (owner or {}).get("full_name") or (owner or {}).get("company_name"),
            "role": (owner or {}).get("role"),
            "location_name": (owner or {}).get("location_name"),
            "instruments": [],
        })
        inst_report = await _events_for_instrument(reg, start)
        user_entry["instruments"].append(inst_report)

    # Sort users by full_name / email, instruments by label
    users_list = sorted(users_map.values(), key=lambda u: (u.get("full_name") or u.get("email") or ""))
    for u in users_list:
        u["instruments"].sort(key=lambda i: (i.get("label") or i.get("hardware_id") or ""))

    # Aggregate totals (used by summary cards on the frontend)
    totals = {"users": len(users_list), "instruments": 0, "online": 0, "offline": 0,
              "no_data": 0, "offline_events": 0, "power_cycles": 0}
    for u in users_list:
        for inst in u["instruments"]:
            totals["instruments"] += 1
            totals[inst["state"]] += 1
            totals["offline_events"] += inst["counts"].get("offline_started", 0)
            totals["power_cycles"] += inst["counts"].get("power_cycle", 0)

    return {
        "window_days": days,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "offline_threshold_hours": OFFLINE_THRESHOLD_HOURS,
        "power_cycle_hours": POWER_CYCLE_HOURS,
        "totals": totals,
        "users": users_list,
    }
