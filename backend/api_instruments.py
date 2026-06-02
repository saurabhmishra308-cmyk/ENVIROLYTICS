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
from auth import require_admin

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
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "instrument_type": instrument_type,
        "hardware_id": hardware_id,
        "values": values,
        "location": location,
        "timestamp": now_iso,
        "received_at": now_iso,
    }
    await db.instrument_readings.insert_one(dict(doc))
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
async def latest_all_types():
    """Public — latest reading per device across ALL instrument types (dashboard summary)."""
    cursor = db.instrument_latest.find({}, {"_id": 0})
    items = await cursor.to_list(length=500)
    by_type = {}
    for r in items:
        by_type.setdefault(r["instrument_type"], []).append(r)
    return {"by_type": by_type, "total": len(items)}


@router.get("/{instrument_type}/latest")
async def latest_for_type(instrument_type: str):
    """Public — latest reading per device for an instrument type."""
    t = _validate_type(instrument_type)
    cursor = db.instrument_latest.find({"instrument_type": t}, {"_id": 0})
    items = await cursor.to_list(length=200)
    return {"instrument_type": t, "readings": items, "count": len(items)}


@router.get("/{instrument_type}/{hardware_id}/latest")
async def latest_for_device(instrument_type: str, hardware_id: str):
    t = _validate_type(instrument_type)
    doc = await db.instrument_latest.find_one(
        {"instrument_type": t, "hardware_id": hardware_id}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="No reading yet")
    return doc


@router.get("/{instrument_type}/{hardware_id}/history")
async def history_for_device(instrument_type: str, hardware_id: str, limit: int = 100):
    t = _validate_type(instrument_type)
    if limit < 1 or limit > 1000:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 1000")
    cursor = (
        db.instrument_readings.find(
            {"instrument_type": t, "hardware_id": hardware_id}
        )
        .sort("timestamp", -1)
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
