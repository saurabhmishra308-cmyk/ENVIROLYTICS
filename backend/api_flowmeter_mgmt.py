"""Flowmeter category + aggregation + reading-edit endpoints.

Categories:
  - groundwater_abstraction  (Water Abstraction tile)
  - stp_inlet                (Water Quality tile)
  - stp_outlet               (Water Quality tile)
"""
import io
import os
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
    flow_rate_lph: Optional[float] = None
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
    flow_rate_lph: float
    forward_totalizer: float = 0
    reverse_totalizer: float = 0
    temperature: float = 0
    timestamp: Optional[str] = None


@router.post("/ingest")
async def ingest_flowmeter(req: IngestFlowmeterReading, admin: dict = Depends(require_admin)):
    """Admin — store a flowmeter reading directly (for demos / when MQTT broker is offline)."""
    now_iso = (req.timestamp or datetime.now(timezone.utc).isoformat())
    doc = {
        "hardware_id": req.hardware_id,
        "flow_rate_lph": req.flow_rate_lph,
        "flow_rate_lpm": req.flow_rate_lph / 60.0,
        "forward_totalizer": req.forward_totalizer,
        "reverse_totalizer": req.reverse_totalizer,
        "temperature": req.temperature,
        "unit_code": 2,
        "unit_name": "L",
        "timestamp": now_iso,
        "received_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.flowmeter_readings.insert_one(dict(doc))
    await db.flowmeter_latest.update_one(
        {"hardware_id": req.hardware_id}, {"$set": doc}, upsert=True
    )
    return {"success": True, "stored": doc}


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
    items = await cursor.to_list(length=500)
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
async def _earliest_after(hardware_id: str, after_dt: datetime) -> Optional[dict]:
    """First reading on or after a given datetime."""
    cursor = (
        db.flowmeter_readings
        .find({"hardware_id": hardware_id, "timestamp": {"$gte": after_dt.isoformat()}})
        .sort("timestamp", 1)
        .limit(1)
    )
    items = await cursor.to_list(length=1)
    return items[0] if items else None


async def _latest_reading(hardware_id: str) -> Optional[dict]:
    return await db.flowmeter_latest.find_one({"hardware_id": hardware_id})


async def _abstraction_between(hardware_id: str, start_dt: datetime, end_dt: datetime) -> float:
    """Total volume (KL) abstracted between two timestamps using forward_totalizer deltas.

    Uses the first reading at-or-after start, and the last reading at-or-before end.
    """
    first = await _earliest_after(hardware_id, start_dt)
    if not first:
        return 0.0
    last_cursor = (
        db.flowmeter_readings
        .find({"hardware_id": hardware_id, "timestamp": {"$lte": end_dt.isoformat()}})
        .sort("timestamp", -1)
        .limit(1)
    )
    last_items = await last_cursor.to_list(length=1)
    last = last_items[0] if last_items else None
    if not last:
        return 0.0
    delta_l = max(0.0, float(last.get("forward_totalizer", 0)) - float(first.get("forward_totalizer", 0)))
    return _l_to_kl(delta_l)


@router.get("/{hardware_id}/aggregate")
async def aggregate_volume(hardware_id: str, user: dict = Depends(get_current_user)):
    """Return current flow rate (m³/hr) + hourly/weekly/monthly/yearly consumption in KL."""
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
        "totaliser_forward_kl": _l_to_kl(latest.get("forward_totalizer", 0) if latest else 0),
        "totaliser_reverse_kl": _l_to_kl(latest.get("reverse_totalizer", 0) if latest else 0),
        "consumption_kl": {
            "hourly": round(hourly, 3),
            "daily": round(daily, 3),
            "weekly": round(weekly, 3),
            "monthly": round(monthly, 3),
            "yearly": round(yearly, 3),
        },
        "last_reading_at": latest.get("timestamp") if latest else None,
    }


@router.get("/{hardware_id}/hourly-buckets")
async def hourly_buckets(hardware_id: str, hours: int = Query(24, ge=1, le=168), user: dict = Depends(get_current_user)):
    """Bucketed hourly abstraction for the last N hours (KL per hour). Used by Flowmeter detail chart."""
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
    new_ts = req.timestamp or existing["timestamp"]

    # Validate forward totaliser monotonicity (chronological neighbours by timestamp)
    if req.forward_totalizer is not None:
        prev = await db.flowmeter_readings.find_one(
            {"hardware_id": hardware_id, "timestamp": {"$lt": new_ts}, "_id": {"$ne": obj_id}},
            sort=[("timestamp", -1)],
        )
        nxt = await db.flowmeter_readings.find_one(
            {"hardware_id": hardware_id, "timestamp": {"$gt": new_ts}, "_id": {"$ne": obj_id}},
            sort=[("timestamp", 1)],
        )
        if prev and req.forward_totalizer < float(prev.get("forward_totalizer", 0)) - 1e-6:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Forward totaliser mismatch: new value {req.forward_totalizer} L is LESS than the "
                    f"previous reading at {prev['timestamp']} ({prev.get('forward_totalizer')} L). "
                    f"Totalisers must be monotonically non-decreasing."
                ),
            )
        if nxt and req.forward_totalizer > float(nxt.get("forward_totalizer", 0)) + 1e-6:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Forward totaliser mismatch: new value {req.forward_totalizer} L is GREATER than the "
                    f"next reading at {nxt['timestamp']} ({nxt.get('forward_totalizer')} L). "
                    f"Totalisers must be monotonically non-decreasing."
                ),
            )

    # Same check for reverse totaliser
    if req.reverse_totalizer is not None:
        prev = await db.flowmeter_readings.find_one(
            {"hardware_id": hardware_id, "timestamp": {"$lt": new_ts}, "_id": {"$ne": obj_id}},
            sort=[("timestamp", -1)],
        )
        nxt = await db.flowmeter_readings.find_one(
            {"hardware_id": hardware_id, "timestamp": {"$gt": new_ts}, "_id": {"$ne": obj_id}},
            sort=[("timestamp", 1)],
        )
        if prev and req.reverse_totalizer < float(prev.get("reverse_totalizer", 0)) - 1e-6:
            raise HTTPException(
                status_code=400,
                detail="Reverse totaliser mismatch with previous reading.",
            )
        if nxt and req.reverse_totalizer > float(nxt.get("reverse_totalizer", 0)) + 1e-6:
            raise HTTPException(
                status_code=400,
                detail="Reverse totaliser mismatch with next reading.",
            )

    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    updates["edited_by"] = admin["id"]
    updates["edited_at"] = datetime.now(timezone.utc).isoformat()

    await db.flowmeter_readings.update_one({"_id": obj_id}, {"$set": updates})

    # If this was the latest reading, also update the `flowmeter_latest` cache
    latest = await db.flowmeter_latest.find_one({"hardware_id": hardware_id})
    if latest and latest.get("timestamp") == existing.get("timestamp"):
        await db.flowmeter_latest.update_one({"hardware_id": hardware_id}, {"$set": updates})

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

    # Update latest cache if this is the most recent reading
    latest = await db.instrument_latest.find_one({
        "instrument_type": existing["instrument_type"],
        "hardware_id": existing["hardware_id"],
    })
    if latest and latest.get("timestamp") == existing.get("timestamp"):
        await db.instrument_latest.update_one(
            {"instrument_type": existing["instrument_type"], "hardware_id": existing["hardware_id"]},
            {"$set": updates},
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
        query["timestamp"] = {}
        if start_date:
            query["timestamp"]["$gte"] = start_date
        if end_date:
            query["timestamp"]["$lte"] = end_date

    cursor = db.flowmeter_readings.find(query).sort("timestamp", -1).limit(5000)
    readings = await cursor.to_list(length=5000)
    for r in readings:
        r.pop("_id", None)
        r.pop("raw_data", None)

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
    days: int = Query(30, ge=1, le=365),
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
    cursor = db.instrument_readings.find(
        {"instrument_type": "dwlr", "hardware_id": hardware_id,
         "timestamp": {"$gte": start.isoformat()}},
        {"_id": 0, "timestamp": 1, "values": 1},
    ).limit(20000)
    async for r in cursor:
        ts = r.get("timestamp")
        if not isinstance(ts, str):
            continue
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
    for d in sorted(buckets.keys()):
        a = buckets[d]
        series.append({
            "date": d,
            "level_mwc": round(a["level_sum"] / a["level_n"], 3) if a["level_n"] else None,
            "temperature_c": round(a["temp_sum"] / a["temp_n"], 2) if a["temp_n"] else None,
            "samples": max(a["level_n"], a["temp_n"]),
        })
    return {"hardware_id": hardware_id, "days": days, "series": series, "count": len(series)}


# ============================
# Water-Quality (DO / pH / BOD / COD / TSS / Chlorine / Turbidity) history
# ============================
WQ_PARAMS = ["PH", "DO", "BOD", "COD", "TSS", "CHLORINE", "TURBIDITY", "TDS", "COND", "TEMPER", "ORP"]

# Chlorine dosing thresholds (mg/L free chlorine at STP outlet).
# Per CPCB / SPCB STP discharge norms the residual chlorine must be kept BELOW
# 0.5 mg/L at the final treated outlet. We use 0.5 as the decrease-dosing
# ceiling and 0.2 as the increase-dosing floor. Override via env vars.
CL_TARGET = float(os.getenv("CHLORINE_TARGET_MG_L", "0.5"))
CL_INCREASE_BELOW = float(os.getenv("CHLORINE_INCREASE_BELOW_MG_L", "0.2"))
CL_DECREASE_ABOVE = float(os.getenv("CHLORINE_DECREASE_ABOVE_MG_L", "0.5"))


def _classify_chlorine(free_cl_mg_l: Optional[float]) -> dict:
    if free_cl_mg_l is None:
        return {"status": "unknown", "message": "No chlorine reading available", "color": "gray"}
    if free_cl_mg_l < CL_INCREASE_BELOW:
        return {"status": "increase", "message": f"Increase dosing — free-Cl {free_cl_mg_l:.2f} mg/L is below the {CL_INCREASE_BELOW} mg/L disinfection floor", "color": "red"}
    if free_cl_mg_l > CL_DECREASE_ABOVE:
        return {"status": "decrease", "message": f"Decrease dosing — free-Cl {free_cl_mg_l:.2f} mg/L exceeds the CPCB max {CL_DECREASE_ABOVE} mg/L STP outlet limit", "color": "amber"}
    return {"status": "ok", "message": f"Free-Cl {free_cl_mg_l:.2f} mg/L within CPCB band ({CL_INCREASE_BELOW}–{CL_DECREASE_ABOVE} mg/L)", "color": "green"}


@router.get("/water-quality/{hardware_id}/history")
async def water_quality_history(
    hardware_id: str,
    hours: int = Query(24, ge=1, le=24 * 30),
    user: dict = Depends(get_current_user),
):
    """Return recent Water-Quality readings for a device (dometer / water_quality
    / pH / TDS / conductivity). Each series entry is one raw reading. Chlorine
    dosing recommendation is included based on the LATEST free-Cl value."""
    is_admin = user.get("role") == "admin"
    visible = await api_instrument_registry.visible_hardware_ids(user)
    if not is_admin and hardware_id not in visible:
        raise HTTPException(status_code=403, detail="Instrument not in your account.")

    reg = await db.instrument_registry.find_one({"hardware_id": hardware_id}, {"_id": 0})
    if not reg:
        raise HTTPException(status_code=404, detail="Instrument not registered.")

    end = datetime.now(timezone.utc)
    start = end - timedelta(hours=hours)

    series: List[dict] = []
    cursor = db.instrument_readings.find(
        {"hardware_id": hardware_id, "timestamp": {"$gte": start.isoformat()}},
        {"_id": 0, "timestamp": 1, "values": 1},
    ).sort("timestamp", 1).limit(20000)
    latest_cl: Optional[float] = None
    async for r in cursor:
        ts = r.get("timestamp")
        v = r.get("values", {}) or {}
        point = {"time": ts}
        for k in WQ_PARAMS:
            if isinstance(v.get(k), (int, float)):
                point[k] = round(float(v[k]), 3)
        if len(point) > 1:
            series.append(point)
            if isinstance(v.get("CHLORINE"), (int, float)):
                latest_cl = float(v["CHLORINE"])

    # TDS auto-computed from TSS when TSS live but TDS absent (rough proxy 0.65×TSS).
    # Only used for the fallback chart on the frontend — not written back to DB.
    for p in series:
        if "TDS" not in p and "TSS" in p:
            p["TDS_from_TSS"] = round(p["TSS"] * 0.65, 2)

    chlorine_status = _classify_chlorine(latest_cl)

    return {
        "hardware_id": hardware_id,
        "instrument_type": reg.get("instrument_type"),
        "label": reg.get("label") or hardware_id,
        "hours": hours,
        "count": len(series),
        "series": series,
        "chlorine": {
            "latest_mg_l": latest_cl,
            "target_mg_l": CL_TARGET,
            "increase_below_mg_l": CL_INCREASE_BELOW,
            "decrease_above_mg_l": CL_DECREASE_ABOVE,
            **chlorine_status,
        },
    }
