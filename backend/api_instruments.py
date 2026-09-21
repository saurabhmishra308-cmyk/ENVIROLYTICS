"""Generic instrument API for non-flowmeter sensors (DWLR, pH, TDS, conductivity, BOD, COD, TSS).

Topic schema: `{instrument_type}/{hardware_id}/data` (e.g., `dwlr/DWLR001/data`).
Payload: JSON object with sensor fields, e.g.:
  - DWLR  : { "LEVEL": 15.8, "TEMPER": 24.1, "BATTERY": 87 }
  - pH    : { "PH": 7.2, "TEMPER": 25.0 }
  - TDS   : { "TDS": 285, "TEMPER": 25.0 }
  - Cond  : { "CONDUCTIVITY": 450, "TEMPER": 25.0 }
  - BOD   : { "BOD": 12.5 }
  - COD   : { "COD": 38.2 }
  - TSS   : { "TSS": 18.5 }
"""
from datetime import datetime, timezone
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from auth import require_admin, get_current_user
import api_instrument_registry

router = APIRouter(prefix="/api/instruments", tags=["instruments"])

# Set from server.py
db = None
mqtt_service = None

SUPPORTED_TYPES = {"dwlr", "ph", "tds", "conductivity"}


def set_db(database):
    global db
    db = database


def set_mqtt(svc):
    global mqtt_service
    mqtt_service = svc


async def _assert_device_visible(hardware_id: str, user: dict):
    """Authorize device-specific reads using the same registry ownership rule as list/latest endpoints."""
    visible = await api_instrument_registry.visible_hardware_ids(user)
    if visible is not None and hardware_id not in visible:
        raise HTTPException(status_code=403, detail="Not authorised to view this device")


async def _enrich_with_registry(items: list):
    """Attach `manual_water_temp_c` and `label` from the instrument_registry.

    Mutates in place. Silently no-ops for hardware_ids not in the registry.
    """
    if not items:
        return items
    hw_ids = [r["hardware_id"] for r in items if r.get("hardware_id")]
    if not hw_ids:
        return items
    regs = {
        r["hardware_id"]: r
        async for r in db.instrument_registry.find(
            {"hardware_id": {"$in": hw_ids}},
            {"_id": 0, "hardware_id": 1, "label": 1, "manual_water_temp_c": 1, "imei": 1},
        )
    }
    for r in items:
        reg = regs.get(r.get("hardware_id"))
        if not reg:
            continue
        if reg.get("manual_water_temp_c") is not None:
            r["manual_water_temp_c"] = reg["manual_water_temp_c"]
        if reg.get("label"):
            r["label"] = reg["label"]
    return items


# ============================
# Pydantic Models
# ============================
class InstrumentSubscription(BaseModel):
    instrument_type: str
    hardware_id: str
    location: Optional[str] = None


class InstrumentReading(BaseModel):
    """Generic reading — admin can POST this to simulate a device for testing/demo."""
    hardware_id: str
    values: dict = Field(..., description="Sensor field map, e.g. {'PH': 7.2, 'TEMPER': 25.0}")
    location: Optional[str] = None


# ============================
# Helpers
# ============================
def _validate_type(instrument_type: str) -> str:
    t = instrument_type.lower()
    if t not in SUPPORTED_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported instrument type '{instrument_type}'. Supported: {sorted(SUPPORTED_TYPES)}",
        )
    return t


async def _store_reading(instrument_type: str, hardware_id: str, values: dict, location: Optional[str] = None):
    registered = await db.instrument_registry.find_one(
        {"hardware_id": hardware_id},
        {"_id": 0, "hardware_id": 1, "instrument_type": 1},
    )
    if not registered:
        raise HTTPException(status_code=404, detail="Instrument not registered")
    if registered.get("instrument_type") != instrument_type:
        raise HTTPException(status_code=400, detail="Instrument type does not match registry")

    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "instrument_type": instrument_type,
        "hardware_id": hardware_id,
        "values": values,
        "location": location,
        "timestamp": now_iso,
        "measurement_timestamp": now_iso,
        "received_at": now_iso,
    }

    await db.instrument_readings.insert_one(dict(doc))

    current = await db.instrument_latest.find_one(
        {"instrument_type": instrument_type, "hardware_id": hardware_id},
        {"measurement_timestamp": 1, "timestamp": 1, "_id": 0},
    )
    current_ts = str(
        (current or {}).get("measurement_timestamp")
        or (current or {}).get("timestamp")
        or ""
    )
    if not current_ts or now_iso >= current_ts:
        await db.instrument_latest.update_one(
            {"instrument_type": instrument_type, "hardware_id": hardware_id},
            {"$set": doc},
            upsert=True,
        )
    return doc


# ============================
# Endpoints
# ============================
@router.get("/types")
async def list_types():
    """Public — list supported instrument types."""
    return {"types": sorted(SUPPORTED_TYPES)}


@router.get("/all/latest")
async def latest_all_types(user: dict = Depends(get_current_user)):
    """Latest reading per device across ALL instrument types (filtered by ownership for non-admin)."""
    cursor = db.instrument_latest.find({"_dummy": {"$ne": True}}, {"_id": 0})
    items = []
    async for row in cursor:
        items.append(row)
    visible = await api_instrument_registry.visible_hardware_ids(user)
    if visible is not None:
        items = [r for r in items if r.get("hardware_id") in visible]
    await _enrich_with_registry(items)
    by_type = {}
    for r in items:
        by_type.setdefault(r["instrument_type"], []).append(r)
    return {"by_type": by_type, "total": len(items)}


@router.get("/{instrument_type}/latest")
async def latest_for_type(instrument_type: str, user: dict = Depends(get_current_user)):
    """Latest reading per device for an instrument type (filtered by ownership for non-admin)."""
    t = _validate_type(instrument_type)
    cursor = db.instrument_latest.find({"instrument_type": t, "_dummy": {"$ne": True}}, {"_id": 0})
    items = []
    async for row in cursor:
        items.append(row)
    visible = await api_instrument_registry.visible_hardware_ids(user)
    if visible is not None:
        items = [r for r in items if r.get("hardware_id") in visible]
    await _enrich_with_registry(items)
    return {"instrument_type": t, "readings": items, "count": len(items)}


@router.get("/{instrument_type}/{hardware_id}/latest")
async def latest_for_device(instrument_type: str, hardware_id: str, user: dict = Depends(get_current_user)):
    t = _validate_type(instrument_type)
    await _assert_device_visible(hardware_id, user)
    doc = await db.instrument_latest.find_one(
        {"instrument_type": t, "hardware_id": hardware_id, "_dummy": {"$ne": True}}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="No reading yet")
    return doc


@router.get("/{instrument_type}/{hardware_id}/history")
async def history_for_device(instrument_type: str, hardware_id: str, limit: int = 5000, user: dict = Depends(get_current_user)):
    t = _validate_type(instrument_type)
    await _assert_device_visible(hardware_id, user)
    if limit < 1 or limit > 20000:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 20000")
    cursor = (
        db.instrument_readings.find(
            {"instrument_type": t, "hardware_id": hardware_id,
             "_dummy": {"$ne": True}}
        )
         .sort([("measurement_timestamp", -1), ("timestamp", -1), ("received_at", -1)])
        .limit(limit)
    )
    items = await cursor.to_list(length=limit)
    for r in items:
        r["_id"] = str(r["_id"])
    return {"instrument_type": t, "hardware_id": hardware_id, "readings": items, "count": len(items)}


@router.post("/subscribe")
async def subscribe(sub: InstrumentSubscription, admin: dict = Depends(require_admin)):
    """Admin — subscribe the MQTT client to a topic for this device."""
    t = _validate_type(sub.instrument_type)
    if not mqtt_service:
        raise HTTPException(status_code=503, detail="MQTT service not available")
    topic = f"{t}/{sub.hardware_id}/data"
    mqtt_service.subscribe_topic(topic, instrument_type=t)
    return {"success": True, "topic": topic, "connected": mqtt_service.connected}


@router.post("/ingest")
async def ingest(reading: InstrumentReading, instrument_type: str, admin: dict = Depends(require_admin)):
    """Admin — directly insert a reading (for demo / when MQTT broker is offline).

    Use this to simulate device data and exercise the end-to-end UI pipeline without a live broker.
    """
    t = _validate_type(instrument_type)
    doc = await _store_reading(t, reading.hardware_id, reading.values, reading.location)
    return {"success": True, "stored": doc}
