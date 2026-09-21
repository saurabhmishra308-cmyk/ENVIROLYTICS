"""Flowmeter category + aggregation + reading-edit endpoints.

Categories:
  - groundwater_abstraction  (Water Abstraction tile)
  - stp_inlet                (Water Quality tile)
  - stp_outlet               (Water Quality tile)
"""
import io
from datetime import datetime, timezone, timedelta
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from auth import require_admin, get_current_user
import api_instrument_registry
from data_export_service import DataExportService

router = APIRouter(prefix="/api/flowmeter-mgmt", tags=["flowmeter-management"])

# Set from server.py
db = None

VALID_CATEGORIES = {"groundwater_abstraction", "stp_inlet", "stp_outlet"}

# Production unit transition: readings before 27-Aug-2026 stored cumulative
# totalisers in m³; from 27-Aug-2026 the device reports cumulative totalisers
# in litres. All user-facing cumulative volume and consumption values are KL.
TOTALISER_LITRE_CUTOFF = "2026-08-27T00:00:00+00:00"


def _totaliser_to_kl(value: Optional[float], measurement_timestamp: Optional[str]) -> float:
    """Normalize a stored cumulative totaliser to KL across the unit change."""
    try:
        v = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    ts = str(measurement_timestamp or "")
    # Before the transition the numeric value is m³, which is numerically equal
    # to KL. From the transition onward the numeric value is litres.
    return v / 1000.0 if ts >= TOTALISER_LITRE_CUTOFF else v


def set_db(database):
    global db
    db = database


# ============================
# Models
# ============================
class SetCategoryRequest(BaseModel):
    category: str = Field(..., description="One of groundwater_abstraction | stp_inlet | stp_outlet")
    label: Optional[str] = None


class EditFlowmeterReading(BaseModel):
    timestamp: Optional[str] = None
    # Preferred canonical unit; either field is accepted for backward compat.
    flow_rate_m3h: Optional[float] = None
    flow_rate_lph: Optional[float] = None
    # User-facing totaliser values are always KL. The backend converts KL
    # to the device's historical storage unit when persisting edits.
    forward_totalizer: Optional[float] = None
    reverse_totalizer: Optional[float] = None
    temperature: Optional[float] = None


class EditInstrumentReading(BaseModel):
    timestamp: Optional[str] = None
    values: Optional[dict] = None


# ============================
# Helpers
# ============================
def _validate_category(c: str) -> str:
    if c not in VALID_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid category '{c}'. Allowed: {sorted(VALID_CATEGORIES)}",
        )
    return c


async def _get_category(hardware_id: str) -> dict:
    doc = await db.flowmeter_categories.find_one({"hardware_id": hardware_id})
    if not doc:
        return {"hardware_id": hardware_id, "category": "groundwater_abstraction", "label": None}
    doc.pop("_id", None)
    return doc


def _lph_to_m3h(lph: Optional[float]) -> float:
    return float(lph or 0) / 1000.0


def _l_to_kl(litres: Optional[float]) -> float:
    return float(litres or 0) / 1000.0


class IngestFlowmeterReading(BaseModel):
    hardware_id: str
    # Preferred canonical unit — if you have it, send this and leave the
    # legacy fields blank. Everything else is derived from it.
    flow_rate_m3h: Optional[float] = None
    # Legacy — kept for backward compat with older ingest scripts. If
    # only `flow_rate_lph` is provided we auto-convert to m³/h.
    flow_rate_lph: Optional[float] = None
    # Universal fallback: pass any raw value + a unit code (1..12 per
    # get_unit_name); we normalise to m³/h at persist time.
    flow_rate_raw: Optional[float] = None
    flow_unit_code: Optional[int] = None
    forward_totalizer: float = 0
    reverse_totalizer: float = 0
    temperature: float = 0
    timestamp: Optional[str] = None


@router.post("/ingest")
async def ingest_flowmeter(req: IngestFlowmeterReading, admin: dict = Depends(require_admin)):
    """Admin — store a flowmeter reading directly (for demos / when
    MQTT broker is offline). The value is coerced to canonical m³/h
    at persist time regardless of the incoming unit."""
    # Import here to avoid a circular top-level import
    from mqtt_utils import convert_flow_to_m3h, m3h_to_lph as _m3h_to_lph

    # Resolve the canonical value in this order of preference.
    if req.flow_rate_m3h is not None:
        flow_m3h = round(float(req.flow_rate_m3h), 4)
        unit_code = 6           # M3/H (canonical)
    elif req.flow_rate_raw is not None and req.flow_unit_code is not None:
        flow_m3h = convert_flow_to_m3h(req.flow_rate_raw, req.flow_unit_code)
        unit_code = int(req.flow_unit_code)
    elif req.flow_rate_lph is not None:
        # Legacy behaviour — treat as L/H.
        flow_m3h = round(float(req.flow_rate_lph) / 1000.0, 4)
        unit_code = 3           # L/H
    else:
        raise HTTPException(status_code=400, detail="Must supply flow_rate_m3h, flow_rate_lph, or (flow_rate_raw + flow_unit_code)")

    flow_lph = _m3h_to_lph(flow_m3h)
    now_iso = (req.timestamp or datetime.now(timezone.utc).isoformat())
    doc = {
        "hardware_id": req.hardware_id,
        "flow_rate_m3h": flow_m3h,
        "flow_rate_lph": flow_lph,
        "flow_rate_lpm": flow_lph / 60.0,
        "forward_totalizer": req.forward_totalizer,
        "reverse_totalizer": req.reverse_totalizer,
        "temperature": req.temperature,
        "unit_code": unit_code,
        "unit_name": "m3/h",
        "canonical_unit": "m3/h",
        "timestamp": now_iso,
        "measurement_timestamp": now_iso,
        "received_at": datetime.now(timezone.utc).isoformat(),
    }
    # Idempotent historical storage keyed by device measurement timestamp.
    duplicate = await db.flowmeter_readings.find_one(
        {"hardware_id": req.hardware_id, "measurement_timestamp": now_iso},
        {"_id": 1},
    )
    if not duplicate:
        await db.flowmeter_readings.insert_one(dict(doc))

    # Delayed manual/import records must not overwrite a newer live cache.
    latest = await db.flowmeter_latest.find_one(
        {"hardware_id": req.hardware_id}, {"measurement_timestamp": 1, "timestamp": 1, "_id": 0}
    )
    latest_ts = str(
        (latest or {}).get("measurement_timestamp")
        or (latest or {}).get("timestamp")
        or ""
    )
    if not latest_ts or now_iso >= latest_ts:
        await db.flowmeter_latest.update_one(
            {"hardware_id": req.hardware_id}, {"$set": doc}, upsert=True
        )
    return {"success": True, "stored": doc, "duplicate": bool(duplicate)}


# ============================
# Category management (admin)
# ============================
@router.put("/{hardware_id}/category")
async def set_category(hardware_id: str, req: SetCategoryRequest, admin: dict = Depends(require_admin)):
    cat = _validate_category(req.category)
    await db.flowmeter_categories.update_one(
        {"hardware_id": hardware_id},
        {"$set": {"hardware_id": hardware_id, "category": cat, "label": req.label,
                  "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"success": True, "hardware_id": hardware_id, "category": cat, "label": req.label}


@router.get("/categories")
async def list_categories(user: dict = Depends(get_current_user)):
    cursor = db.flowmeter_categories.find({}, {"_id": 0})
    items = []
    async for item in cursor:
        items.append(item)
    visible = await api_instrument_registry.visible_hardware_ids(user)
    if visible is not None:
        items = [r for r in items if r.get("hardware_id") in visible]
    return {"categories": items}


@router.delete("/{hardware_id}/category")
async def delete_category(hardware_id: str, admin: dict = Depends(require_admin)):
    await db.flowmeter_categories.delete_one({"hardware_id": hardware_id})
    return {"success": True}


# ============================
# Aggregations — totaliser & flow in KL
# ============================
async def _assert_flowmeter_visible(hardware_id: str, user: dict):
    visible = await api_instrument_registry.visible_hardware_ids(user)
    if visible is not None and hardware_id not in visible:
        raise HTTPException(status_code=403, detail="Not authorised to view this device")


async def _earliest_after(hardware_id: str, after_dt: datetime) -> Optional[dict]:
    """First reading on or after a given datetime."""
    cursor = (
        db.flowmeter_readings
        .find({"hardware_id": hardware_id,
               "$or": [
                   {"measurement_timestamp": {"$gte": after_dt.isoformat()}},
                   {"measurement_timestamp": {"$exists": False}, "timestamp": {"$gte": after_dt.isoformat()}},
               ]})
        .sort([("measurement_timestamp", 1), ("timestamp", 1)])
        .limit(1)
    )
    items = await cursor.to_list(length=1)
    return items[0] if items else None


async def _latest_reading(hardware_id: str) -> Optional[dict]:
    return await db.flowmeter_latest.find_one({"hardware_id": hardware_id})


async def _abstraction_between(hardware_id: str, start_dt: datetime, end_dt: datetime) -> float:
    """Total volume (KL) from the chronological forward-totaliser chain.

    Include the last valid reading before the requested window so the first
    in-window reading can contribute its chronological delta. The device's
    final totaliser is the next chronological reading's initial totaliser.
    Never use insertion/received order for this calculation. Duplicate
    timestamps are ignored, and a decreasing totaliser is treated as a meter
    reset/rollover rather than creating negative consumption.
    """
    projection = {
        "_id": 0,
        "timestamp": 1,
        "measurement_timestamp": 1,
        "forward_totalizer": 1,
    }

    # Boundary reading: the most recent measurement before start_dt. Check
    # canonical measurement time and legacy timestamp separately so documents
    # without measurement_timestamp remain fully supported.
    before_measurement = await db.flowmeter_readings.find_one(
        {"hardware_id": hardware_id,
         "measurement_timestamp": {"$lt": start_dt.isoformat()}},
        projection,
        sort=[("measurement_timestamp", -1)],
    )
    before_legacy = await db.flowmeter_readings.find_one(
        {"hardware_id": hardware_id,
         "measurement_timestamp": {"$exists": False},
         "timestamp": {"$lt": start_dt.isoformat()}},
        projection,
        sort=[("timestamp", -1)],
    )

    boundary = None
    candidates = [r for r in (before_measurement, before_legacy) if r]
    if candidates:
        boundary = max(
            candidates,
            key=lambda r: str(r.get("measurement_timestamp") or r.get("timestamp") or ""),
        )

    cursor = db.flowmeter_readings.find(
        {"hardware_id": hardware_id,
         "$or": [
             {"measurement_timestamp": {"$gte": start_dt.isoformat(), "$lte": end_dt.isoformat()}},
             {"measurement_timestamp": {"$exists": False}, "timestamp": {"$gte": start_dt.isoformat(), "$lte": end_dt.isoformat()}},
         ]},
        projection,
    )
    rows = await cursor.to_list(length=20000)
    if boundary:
        rows.append(boundary)

    if len(rows) < 2:
        return 0.0

    def _effective_ts(row):
        return str(row.get("measurement_timestamp") or row.get("timestamp") or "")

    rows.sort(key=_effective_ts)

    total_kl = 0.0
    prev_ts = None
    prev_total_kl = None
    for row in rows:
        ts = _effective_ts(row)
        if not ts or ts == prev_ts:
            continue
        total_kl_reading = _totaliser_to_kl(row.get("forward_totalizer", 0), ts)
        if prev_total_kl is not None:
            delta_kl = total_kl_reading - prev_total_kl
            if delta_kl >= 0:
                total_kl += delta_kl
            # A decrease is a meter reset/rollover; start a new chain at
            # the new normalized final reading instead of fabricating usage.
        prev_ts = ts
        prev_total_kl = total_kl_reading
    return round(total_kl, 9)


@router.get("/{hardware_id}/aggregate")
async def aggregate_volume(hardware_id: str, user: dict = Depends(get_current_user)):
    """Return current flow rate (m³/hr) + hourly/weekly/monthly/yearly consumption in KL."""
    await _assert_flowmeter_visible(hardware_id, user)
    latest = await _latest_reading(hardware_id)
    now = datetime.now(timezone.utc)
    flow_lph = float(latest.get("flow_rate_lph", 0)) if latest else 0.0
    cat = await _get_category(hardware_id)

    hourly = await _abstraction_between(hardware_id, now - timedelta(hours=1), now)
    daily = await _abstraction_between(hardware_id, now - timedelta(days=1), now)
    weekly = await _abstraction_between(hardware_id, now - timedelta(days=7), now)
    monthly = await _abstraction_between(hardware_id, now - timedelta(days=30), now)
    yearly = await _abstraction_between(hardware_id, now - timedelta(days=365), now)

    return {
        "hardware_id": hardware_id,
        "category": cat.get("category"),
        "label": cat.get("label"),
        "flow_rate_m3h": round(_lph_to_m3h(flow_lph), 3),
        "flow_rate_lph": flow_lph,
        "totaliser_forward_kl": _totaliser_to_kl(
            latest.get("forward_totalizer", 0) if latest else 0,
            (latest.get("measurement_timestamp") or latest.get("timestamp")) if latest else None,
        ),
        "totaliser_reverse_kl": _totaliser_to_kl(
            latest.get("reverse_totalizer", 0) if latest else 0,
            (latest.get("measurement_timestamp") or latest.get("timestamp")) if latest else None,
        ),
        "consumption_kl": {
            "hourly": round(hourly, 3),
            "daily": round(daily, 3),
            "weekly": round(weekly, 3),
            "monthly": round(monthly, 3),
            "yearly": round(yearly, 3),
        },
        "last_reading_at": (latest.get("measurement_timestamp") or latest.get("timestamp")) if latest else None,
        "last_received_at": latest.get("received_at") if latest else None,
    }


@router.get("/{hardware_id}/hourly-buckets")
async def hourly_buckets(hardware_id: str, hours: int = Query(24, ge=1, le=168), user: dict = Depends(get_current_user)):
    """Bucketed hourly abstraction for the last N hours (KL per hour). Used by Flowmeter detail chart."""
    await _assert_flowmeter_visible(hardware_id, user)
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    buckets = []
    # Pre-fetch boundary reading for each hour
    for i in range(hours, 0, -1):
        start = now - timedelta(hours=i)
        end = now - timedelta(hours=i - 1)
        kl = await _abstraction_between(hardware_id, start, end)
        buckets.append({
            "start": start.isoformat(),
            "end": end.isoformat(),
            "hour_label": start.strftime("%H:00"),
            "abstraction_kl": round(kl, 3),
        })
    return {"hardware_id": hardware_id, "buckets": buckets, "count": len(buckets)}


# ============================
# Reading edits with totaliser integrity check
# ============================

async def _chronological_neighbor(
    hardware_id: str,
    measurement_timestamp: str,
    direction: str,
    exclude_id,
) -> Optional[dict]:
    """Return the nearest chronological reading using measurement time authority.

    Legacy timestamp is considered only for documents that have no
    measurement_timestamp. Mongo sort ordering for missing fields is otherwise
    able to put legacy rows ahead of authoritative rows.
    """
    operator = "$lt" if direction == "previous" else "$gt"
    sort_direction = -1 if direction == "previous" else 1

    measurement = await db.flowmeter_readings.find_one(
        {
            "hardware_id": hardware_id,
            "measurement_timestamp": {operator: measurement_timestamp},
            "_id": {"$ne": exclude_id},
        },
        sort=[("measurement_timestamp", sort_direction)],
    )
    legacy = await db.flowmeter_readings.find_one(
        {
            "hardware_id": hardware_id,
            "measurement_timestamp": {"$exists": False},
            "timestamp": {operator: measurement_timestamp},
            "_id": {"$ne": exclude_id},
        },
        sort=[("timestamp", sort_direction)],
    )

    candidates = [row for row in (measurement, legacy) if row]
    if not candidates:
        return None
    if direction == "previous":
        return max(candidates, key=lambda row: str(
            row.get("measurement_timestamp") or row.get("timestamp") or ""
        ))
    return min(candidates, key=lambda row: str(
        row.get("measurement_timestamp") or row.get("timestamp") or ""
    ))

@router.put("/readings/flowmeter/{reading_id}")
async def edit_flowmeter_reading(reading_id: str, req: EditFlowmeterReading, admin: dict = Depends(require_admin)):
    """Edit a stored flowmeter reading.

    STRICT validation: if `forward_totalizer` (or `reverse_totalizer`) is changed, the new value must
    remain between the previous and next chronological readings for the same hardware_id. Otherwise the
    sequence would become inconsistent (totaliser must be monotonic).
    """
    from bson import ObjectId
    try:
        obj_id = ObjectId(reading_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid reading id")

    existing = await db.flowmeter_readings.find_one({"_id": obj_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Reading not found")

    hardware_id = existing["hardware_id"]
    new_ts = req.timestamp or existing.get("measurement_timestamp") or existing["timestamp"]

    # Timestamp edits must preserve the one-reading-per-device-measurement
    # invariant. Reject a second row with the same authoritative timestamp.
    if req.timestamp is not None:
        duplicate = await db.flowmeter_readings.find_one(
            {
                "hardware_id": hardware_id,
                "measurement_timestamp": req.timestamp,
                "_id": {"$ne": obj_id},
            },
            {"_id": 1},
        )
        if duplicate:
            raise HTTPException(
                status_code=409,
                detail="A flowmeter reading already exists for this measurement timestamp",
            )

    # Totaliser values supplied by the web UI are KL. Compare neighbours in
    # the same canonical KL unit, then convert the edited value back to the
    # device storage unit (m³ before 27-Aug-2026, litres from that date).
    edit_forward_raw = None
    if req.forward_totalizer is not None:
        edit_forward_raw = float(req.forward_totalizer) * (1000.0 if new_ts >= TOTALISER_LITRE_CUTOFF else 1.0)
        prev = await _chronological_neighbor(hardware_id, new_ts, "previous", obj_id)
        nxt = await _chronological_neighbor(hardware_id, new_ts, "next", obj_id)
        edit_forward_kl = float(req.forward_totalizer)
        if prev and edit_forward_kl < _totaliser_to_kl(prev.get("forward_totalizer", 0), prev.get("measurement_timestamp") or prev.get("timestamp")) - 1e-6:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Forward totaliser mismatch: new value {req.forward_totalizer} L is LESS than the "
                    f"previous reading at {prev['timestamp']} ({prev.get('forward_totalizer')} L). "
                    f"Totalisers must be monotonically non-decreasing."
                ),
            )
        if nxt and edit_forward_kl > _totaliser_to_kl(nxt.get("forward_totalizer", 0), nxt.get("measurement_timestamp") or nxt.get("timestamp")) + 1e-6:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Forward totaliser mismatch: new value {req.forward_totalizer} L is GREATER than the "
                    f"next reading at {nxt['timestamp']} ({nxt.get('forward_totalizer')} L). "
                    f"Totalisers must be monotonically non-decreasing."
                ),
            )

    # Same canonical-KL validation for reverse totaliser.
    edit_reverse_raw = None
    if req.reverse_totalizer is not None:
        edit_reverse_raw = float(req.reverse_totalizer) * (1000.0 if new_ts >= TOTALISER_LITRE_CUTOFF else 1.0)
        prev = await _chronological_neighbor(hardware_id, new_ts, "previous", obj_id)
        nxt = await _chronological_neighbor(hardware_id, new_ts, "next", obj_id)
        if prev and float(req.reverse_totalizer) < _totaliser_to_kl(prev.get("reverse_totalizer", 0), prev.get("measurement_timestamp") or prev.get("timestamp")) - 1e-6:
            raise HTTPException(
                status_code=400,
                detail="Reverse totaliser mismatch with previous reading.",
            )
        if nxt and float(req.reverse_totalizer) > _totaliser_to_kl(nxt.get("reverse_totalizer", 0), nxt.get("measurement_timestamp") or nxt.get("timestamp")) + 1e-6:
            raise HTTPException(
                status_code=400,
                detail="Reverse totaliser mismatch with next reading.",
            )

    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    if edit_forward_raw is not None:
        updates["forward_totalizer"] = edit_forward_raw
    if edit_reverse_raw is not None:
        updates["reverse_totalizer"] = edit_reverse_raw
    if "timestamp" in updates:
        # The edited timestamp is the device measurement time. Keep the
        # explicit field synchronized so all downstream consumers use the
        # same authoritative clock.
        updates["measurement_timestamp"] = updates["timestamp"]
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    # Whenever the flow rate is edited, keep all three canonical units
    # (m³/h, L/h, L/M) in sync so the reports table stays consistent no
    # matter which UI wrote the edit.
    m3h = updates.pop("flow_rate_m3h", None)
    if m3h is None and updates.get("flow_rate_lph") is not None:
        m3h = round(float(updates["flow_rate_lph"]) / 1000.0, 4)
    if m3h is not None:
        m3h = round(float(m3h), 4)
        updates["flow_rate_m3h"] = m3h
        updates["flow_rate_lph"] = round(m3h * 1000.0, 4)
        updates["flow_rate_lpm"] = round(m3h * 1000.0 / 60.0, 4)

    updates["edited_by"] = admin["id"]
    updates["edited_at"] = datetime.now(timezone.utc).isoformat()

    await db.flowmeter_readings.update_one({"_id": obj_id}, {"$set": updates})

    # Reconcile the latest cache from the authoritative measurement-time ordering.
    # This is required when an admin edits a reading timestamp: the edited row
    # may stop being the latest, or a different row may become latest.
    latest_row = await db.flowmeter_readings.find_one(
        {"hardware_id": hardware_id},
        sort=[("measurement_timestamp", -1), ("timestamp", -1)],
    )
    if latest_row:
        latest_cache = {k: v for k, v in latest_row.items() if k != "_id"}
        await db.flowmeter_latest.update_one(
            {"hardware_id": hardware_id},
            {"$set": latest_cache},
            upsert=True,
        )

    return {"success": True, "updated_fields": list(updates.keys())}


@router.put("/readings/instrument/{reading_id}")
async def edit_instrument_reading(reading_id: str, req: EditInstrumentReading, admin: dict = Depends(require_admin)):
    """Edit a generic instrument reading (DWLR, pH, TDS, conductivity)."""
    from bson import ObjectId
    try:
        obj_id = ObjectId(reading_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid reading id")

    existing = await db.instrument_readings.find_one({"_id": obj_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Reading not found")

    updates = {}
    if req.timestamp is not None:
        updates["timestamp"] = req.timestamp
        updates["measurement_timestamp"] = req.timestamp
    if req.values is not None:
        # Merge into existing values
        merged = dict(existing.get("values") or {})
        merged.update(req.values)
        updates["values"] = merged

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    updates["edited_by"] = admin["id"]
    updates["edited_at"] = datetime.now(timezone.utc).isoformat()
    await db.instrument_readings.update_one({"_id": obj_id}, {"$set": updates})

    # Reconcile latest from measurement-time ordering. Timestamp edits can
    # change which reading is authoritative, so do not compare receipt time
    # or assume the edited row remains latest.
    latest_row = await db.instrument_readings.find_one(
        {
            "instrument_type": existing["instrument_type"],
            "hardware_id": existing["hardware_id"],
        },
        sort=[("measurement_timestamp", -1), ("timestamp", -1)],
    )
    if latest_row:
        latest_cache = {k: v for k, v in latest_row.items() if k != "_id"}
        await db.instrument_latest.update_one(
            {"instrument_type": existing["instrument_type"], "hardware_id": existing["hardware_id"]},
            {"$set": latest_cache},
            upsert=True,
        )

    return {"success": True, "updated_fields": list(updates.keys())}


@router.delete("/readings/flowmeter/{reading_id}")
async def delete_flowmeter_reading(reading_id: str, admin: dict = Depends(require_admin)):
    from bson import ObjectId
    try:
        obj_id = ObjectId(reading_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid reading id")
    res = await db.flowmeter_readings.delete_one({"_id": obj_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Reading not found")
    return {"success": True}


@router.delete("/readings/instrument/{reading_id}")
async def delete_instrument_reading(reading_id: str, admin: dict = Depends(require_admin)):
    from bson import ObjectId
    try:
        obj_id = ObjectId(reading_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid reading id")
    res = await db.instrument_readings.delete_one({"_id": obj_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Reading not found")
    return {"success": True}


# ============================
# Per-user data export — admin sees all; client/sub-user sees only owned devices.
# ============================
@router.get("/export")
async def export_data_scoped(
    format: str = Query(..., regex="^(csv|pdf)$"),
    hardware_id: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """Download CSV / PDF of flowmeter readings — scoped to the caller's owned
    instruments. Admin still sees every registered device."""
    is_admin = user.get("role") == "admin"
    visible = await api_instrument_registry.visible_hardware_ids(user)
    if not is_admin and not visible:
        raise HTTPException(status_code=403, detail="You don't have any instruments assigned to your account yet.")

    if hardware_id and not is_admin and hardware_id not in visible:
        raise HTTPException(status_code=403, detail=f"Instrument '{hardware_id}' is not assigned to your account.")

    if hardware_id:
        query = {"hardware_id": hardware_id}
    elif is_admin:
        query = {}  # admin downloads everything
    else:
        query = {"hardware_id": {"$in": list(visible)}}
    if start_date or end_date:
        time_filter = {}
        if start_date:
            time_filter["$gte"] = start_date
        if end_date:
            time_filter["$lte"] = end_date
        # Measurement timestamp is authoritative, but retain legacy timestamp
        # rows that predate the measurement_timestamp field.
        query["$or"] = [
            {"measurement_timestamp": dict(time_filter)},
            {"measurement_timestamp": {"$exists": False}, "timestamp": dict(time_filter)},
        ]

    # Lifetime retention: allow up to 100k rows per export (~ 15 years of
    # hourly data or ~2 years of 15-min data).  Client can further narrow
    # with hardware_id + start_date/end_date.
    cursor = db.flowmeter_readings.find({**query, "_dummy": {"$ne": True}}).sort([("measurement_timestamp", -1), ("timestamp", -1)]).limit(100000)
    readings = await cursor.to_list(length=100000)
    readings = DataExportService.sanitize_flowmeter_rows(readings)

    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    if format == "csv":
        csv_data = DataExportService.to_csv(readings)
        return StreamingResponse(
            io.BytesIO(csv_data),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=flowmeter_data_{today}.csv"},
        )
    pdf_data = DataExportService.to_pdf(readings, "Flowmeter Readings Report")
    return StreamingResponse(
        io.BytesIO(pdf_data),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=flowmeter_report_{today}.pdf"},
    )


# ============================
# Per-user DWLR daily aggregate (level mWC + temperature)
# ============================
@router.get("/dwlr/{hardware_id}/daily")
async def dwlr_daily(
    hardware_id: str,
    days: int = Query(30, ge=1, le=3650),
    user: dict = Depends(get_current_user),
):
    """Return daily-averaged DWLR level (mWC) + temperature for the given hardware_id."""
    is_admin = user.get("role") == "admin"
    visible = await api_instrument_registry.visible_hardware_ids(user)
    if not is_admin and hardware_id not in visible:
        raise HTTPException(status_code=403, detail="Instrument not in your account.")

    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days)

    buckets = {}
    seen_measurement_ts = set()
    cursor = db.instrument_readings.find(
        {"instrument_type": "dwlr", "hardware_id": hardware_id,
         "$or": [
             {"measurement_timestamp": {"$gte": start.isoformat(), "$lte": end.isoformat()}},
             {"measurement_timestamp": {"$exists": False}, "timestamp": {"$gte": start.isoformat(), "$lte": end.isoformat()}},
         ],
         "_dummy": {"$ne": True}},
        {"_id": 0, "timestamp": 1, "measurement_timestamp": 1, "values": 1},
    )
    async for r in cursor:
        ts = r.get("measurement_timestamp") or r.get("timestamp")
        if not isinstance(ts, str):
            continue
        if ts in seen_measurement_ts:
            continue
        seen_measurement_ts.add(ts)
        try:
            day = datetime.fromisoformat(ts.replace("Z", "+00:00")).date().isoformat()
        except ValueError:
            continue
        v = r.get("values", {}) or {}
        level = v.get("LEVEL") if isinstance(v.get("LEVEL"), (int, float)) else v.get("level")
        temp = v.get("TEMPER") if isinstance(v.get("TEMPER"), (int, float)) else v.get("temperature")
        agg = buckets.setdefault(day, {"level_sum": 0.0, "level_n": 0, "temp_sum": 0.0, "temp_n": 0})
        if isinstance(level, (int, float)):
            agg["level_sum"] += float(level)
            agg["level_n"] += 1
        if isinstance(temp, (int, float)):
            agg["temp_sum"] += float(temp)
            agg["temp_n"] += 1

    series = []
    # DWLR devices don't send temperature — use admin-set manual temp from registry.
    reg = await db.instrument_registry.find_one(
        {"hardware_id": hardware_id}, {"_id": 0, "manual_water_temp_c": 1}
    )
    manual_temp = reg.get("manual_water_temp_c") if reg else None
    for d in sorted(buckets.keys()):
        a = buckets[d]
        temp_val = round(a["temp_sum"] / a["temp_n"], 2) if a["temp_n"] else manual_temp
        series.append({
            "date": d,
            "level_mwc": round(a["level_sum"] / a["level_n"], 3) if a["level_n"] else None,
            "temperature_c": temp_val,
            "samples": max(a["level_n"], a["temp_n"]),
        })
    return {
        "hardware_id": hardware_id,
        "days": days,
        "series": series,
        "count": len(series),
        "manual_water_temp_c": manual_temp,
    }
