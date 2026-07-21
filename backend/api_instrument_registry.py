"""Instrument Registry — admin-managed catalogue of every physical device.

Each registered device is owned by a single user (`owner_user_id`). The dashboard
listing endpoints use `visible_hardware_ids()` so non-admin users only ever see
their own instruments. Admin sees everything.

Endpoints (all require admin except `list` which is owner-scoped):
  GET    /api/instrument-registry              → list (admin: all, client: own)
  POST   /api/instrument-registry              → create
  PUT    /api/instrument-registry/{hw_id}      → update (label, owner, location, category)
  DELETE /api/instrument-registry/{hw_id}      → cascade delete registration + all readings
  POST   /api/instrument-registry/wipe-demo    → one-shot: delete every hardcoded demo device

Side-effects on create: auto-subscribes the MQTT client to the correct topic so
real data starts flowing immediately when the field instrument publishes.
"""
import secrets
from datetime import datetime, timezone
from typing import Optional, List, Set, Dict
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

from auth import require_admin, get_current_user

router = APIRouter(prefix="/api/instrument-registry", tags=["instrument-registry"])

db = None
mqtt_service = None

SUPPORTED_TYPES = {"flowmeter", "dwlr", "ph", "tds", "conductivity", "dometer", "water_quality"}
SUPPORTED_SOURCES = {"mqtt", "https_ingest", "qespl_api"}
FLOWMETER_CATEGORIES = {"groundwater_abstraction", "stp_inlet", "stp_outlet"}

# Canonical demo device IDs (also defined in field_simulator.py)
DEMO_HARDWARE_IDS = [
    "FM_GW_001", "FM_STP_IN", "FM_STP_OUT",
    "DWLR001", "PH001", "TDS001", "COND001",
]


def set_db(database):
    global db
    db = database


def set_mqtt(svc):
    global mqtt_service
    mqtt_service = svc


# ---------------------------------------------------------------- helpers
async def visible_hardware_ids(user: dict) -> Optional[Set[str]]:
    """Return the set of hardware_ids the user is allowed to see.

    Filter is universal — even admin only sees devices that exist in the
    `instrument_registry`. This enforces "only registered instruments are real"
    and hides orphan/test data from old simulator runs or QA tests.

    For non-admin users, the set is further scoped to their owned devices.
    Returns `None` only if the user is an admin AND wants the global view
    (currently never — kept as escape hatch for migrations).
    """
    query: Dict = {} if user.get("role") == "admin" else {"owner_user_id": user.get("id")}
    cursor = db.instrument_registry.find(query, {"hardware_id": 1, "_id": 0})
    return {doc["hardware_id"] async for doc in cursor}


def _normalise_type(t: str) -> str:
    t = (t or "").lower().strip()
    if t not in SUPPORTED_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported instrument type. Allowed: {sorted(SUPPORTED_TYPES)}",
        )
    return t


def _normalise_category(t: str, c: Optional[str]) -> Optional[str]:
    if t != "flowmeter":
        return None
    if not c:
        return "groundwater_abstraction"
    if c not in FLOWMETER_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid category. Allowed: {sorted(FLOWMETER_CATEGORIES)}",
        )
    return c


def _topic_for(instrument_type: str, hardware_id: str) -> str:
    if instrument_type == "flowmeter":
        return f"{hardware_id}/0"
    return f"{instrument_type}/{hardware_id}/data"


async def _subscribe_topic(instrument_type: str, hardware_id: str):
    """Subscribe MQTT client to this device's topic. Safe to call repeatedly."""
    if not mqtt_service:
        return
    try:
        if instrument_type == "flowmeter":
            mqtt_service.subscribe_flowmeter(hardware_id)
        else:
            mqtt_service.subscribe_topic(_topic_for(instrument_type, hardware_id), instrument_type=instrument_type)
    except Exception as e:
        # Never fail the API call because of MQTT subscription errors
        print(f"[registry] MQTT subscribe failed for {hardware_id}: {e}")


async def _enrich_with_owner(items: List[dict]) -> List[dict]:
    """Attach owner email + name to each registry item."""
    owner_ids = list({i["owner_user_id"] for i in items if i.get("owner_user_id")})
    if not owner_ids:
        return items
    owners = {
        u["id"]: u
        async for u in db.users.find(
            {"id": {"$in": owner_ids}}, {"_id": 0, "id": 1, "email": 1, "full_name": 1, "company_name": 1}
        )
    }
    for it in items:
        owner = owners.get(it.get("owner_user_id"))
        it["owner_email"] = owner.get("email") if owner else None
        it["owner_name"] = (owner.get("full_name") or owner.get("company_name") or owner.get("email")) if owner else None
    return items


# ---------------------------------------------------------------- models
class CreateInstrumentRequest(BaseModel):
    hardware_id: str = Field(..., min_length=1, max_length=64)
    instrument_type: str = Field(..., description="flowmeter | dwlr | ph | tds | conductivity | dometer | water_quality")
    owner_user_id: str = Field(..., description="user.id of the assigned client")
    label: Optional[str] = None
    location_name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    category: Optional[str] = None  # flowmeter only
    device_source: Optional[str] = Field(None, description="mqtt (default) | https_ingest | qespl_api")
    qespl_device_id: Optional[str] = Field(None, description="QESPL DTU device serial, required when device_source=qespl_api")


class UpdateInstrumentRequest(BaseModel):
    instrument_type: Optional[str] = None
    owner_user_id: Optional[str] = None
    label: Optional[str] = None
    location_name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    category: Optional[str] = None
    device_source: Optional[str] = None
    qespl_device_id: Optional[str] = None


# ---------------------------------------------------------------- routes
@router.get("")
async def list_instruments(
    instrument_type: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """List registered instruments. Admin sees all; client sees only their own.

    Optional filter `instrument_type` narrows to a single device type
    (flowmeter | dwlr | ph | tds | conductivity).
    """
    query: Dict = {}
    if user.get("role") != "admin":
        query["owner_user_id"] = user.get("id")
    if instrument_type:
        query["instrument_type"] = _normalise_type(instrument_type)
    cursor = db.instrument_registry.find(query, {"_id": 0}).sort("created_at", -1)
    items = await cursor.to_list(length=2000)
    items = await _enrich_with_owner(items)
    return {"instruments": items, "count": len(items)}


@router.post("")
async def create_instrument(req: CreateInstrumentRequest, admin: dict = Depends(require_admin)):
    """Register a new physical device and assign it to a client."""
    hardware_id = req.hardware_id.strip()
    if not hardware_id:
        raise HTTPException(status_code=400, detail="hardware_id is required")

    if await db.instrument_registry.find_one({"hardware_id": hardware_id}):
        raise HTTPException(status_code=409, detail=f"Instrument '{hardware_id}' already registered")

    owner = await db.users.find_one({"id": req.owner_user_id})
    if not owner:
        raise HTTPException(status_code=404, detail="Owner user not found")

    itype = _normalise_type(req.instrument_type)
    category = _normalise_category(itype, req.category)

    # Data source (default = mqtt to preserve legacy behaviour)
    device_source = (req.device_source or "mqtt").strip().lower()
    if device_source not in SUPPORTED_SOURCES:
        raise HTTPException(status_code=400, detail=f"Unsupported device_source '{device_source}'. Valid: {sorted(SUPPORTED_SOURCES)}")
    if device_source == "qespl_api" and not (req.qespl_device_id and req.qespl_device_id.strip()):
        raise HTTPException(status_code=400, detail="qespl_device_id is required when device_source is 'qespl_api'")

    doc = {
        "hardware_id": hardware_id,
        "instrument_type": itype,
        "owner_user_id": req.owner_user_id,
        "label": (req.label or hardware_id).strip(),
        "location_name": req.location_name,
        "latitude": req.latitude,
        "longitude": req.longitude,
        "category": category,
        "device_source": device_source,
        "qespl_device_id": (req.qespl_device_id or "").strip() or None,
        "device_key": secrets.token_urlsafe(24),  # for HTTPS ingestion auth
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": admin.get("id"),
    }
    await db.instrument_registry.insert_one(dict(doc))

    # If it's a flowmeter, also write the category record so existing UI works
    if itype == "flowmeter" and category:
        await db.flowmeter_categories.update_one(
            {"hardware_id": hardware_id},
            {"$set": {
                "hardware_id": hardware_id,
                "category": category,
                "label": doc["label"],
                "updated_at": doc["created_at"],
            }},
            upsert=True,
        )

    # Subscribe MQTT only when this device actually uses MQTT
    if device_source == "mqtt":
        await _subscribe_topic(itype, hardware_id)

    return {"success": True, "instrument": doc}


@router.put("/{hardware_id}")
async def update_instrument(hardware_id: str, req: UpdateInstrumentRequest, admin: dict = Depends(require_admin)):
    existing = await db.instrument_registry.find_one({"hardware_id": hardware_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Instrument not registered")

    updates: Dict = {}
    if req.owner_user_id is not None:
        owner = await db.users.find_one({"id": req.owner_user_id})
        if not owner:
            raise HTTPException(status_code=404, detail="Owner user not found")
        updates["owner_user_id"] = req.owner_user_id
    if req.label is not None:
        updates["label"] = req.label.strip()
    if req.location_name is not None:
        updates["location_name"] = req.location_name
    if req.latitude is not None:
        updates["latitude"] = req.latitude
    if req.longitude is not None:
        updates["longitude"] = req.longitude
    if req.instrument_type is not None:
        updates["instrument_type"] = _normalise_type(req.instrument_type)
    if req.category is not None:
        itype = updates.get("instrument_type", existing.get("instrument_type"))
        updates["category"] = _normalise_category(itype, req.category)

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    updates["updated_by"] = admin.get("id")
    await db.instrument_registry.update_one({"hardware_id": hardware_id}, {"$set": updates})

    # Mirror category change to flowmeter_categories for legacy UI
    new_type = updates.get("instrument_type", existing.get("instrument_type"))
    if new_type == "flowmeter" and ("category" in updates or "label" in updates):
        await db.flowmeter_categories.update_one(
            {"hardware_id": hardware_id},
            {"$set": {
                "hardware_id": hardware_id,
                "category": updates.get("category", existing.get("category")),
                "label": updates.get("label", existing.get("label")),
                "updated_at": updates["updated_at"],
            }},
            upsert=True,
        )
    return {"success": True, "updated_fields": list(updates.keys())}


@router.delete("/{hardware_id}")
async def delete_instrument(hardware_id: str, admin: dict = Depends(require_admin)):
    """Cascade delete: registry + all readings + categories + limits + alerts state."""
    existing = await db.instrument_registry.find_one({"hardware_id": hardware_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Instrument not registered")

    summary = {
        "flowmeter_readings": (await db.flowmeter_readings.delete_many({"hardware_id": hardware_id})).deleted_count,
        "flowmeter_latest":   (await db.flowmeter_latest.delete_many({"hardware_id": hardware_id})).deleted_count,
        "flowmeter_categories": (await db.flowmeter_categories.delete_many({"hardware_id": hardware_id})).deleted_count,
        "instrument_readings": (await db.instrument_readings.delete_many({"hardware_id": hardware_id})).deleted_count,
        "instrument_latest":   (await db.instrument_latest.delete_many({"hardware_id": hardware_id})).deleted_count,
        "limits":              (await db.flowmeter_limits.delete_many({"hardware_id": hardware_id})).deleted_count if "flowmeter_limits" in await db.list_collection_names() else 0,
    }
    await db.instrument_registry.delete_one({"hardware_id": hardware_id})
    return {"success": True, "hardware_id": hardware_id, "removed": summary}


@router.post("/purge-orphans")
async def purge_orphan_data(admin: dict = Depends(require_admin)):
    """Delete all readings, categories, and latest entries for any hardware_id
    that is NOT in the instrument_registry. Use this to clean up old test data
    or simulator history once you switch to real-device-only mode."""
    registered = {doc["hardware_id"] async for doc in db.instrument_registry.find({}, {"hardware_id": 1, "_id": 0})}

    collections = [
        "flowmeter_readings", "flowmeter_latest", "flowmeter_categories",
        "instrument_readings", "instrument_latest",
    ]
    if "flowmeter_limits" in await db.list_collection_names():
        collections.append("flowmeter_limits")

    summary = {}
    for coll in collections:
        result = await db[coll].delete_many({"hardware_id": {"$nin": list(registered) or [""]}})
        summary[coll] = result.deleted_count
    return {"success": True, "registered_devices": len(registered), "purged": summary}


@router.post("/wipe-demo")
async def wipe_demo_data(admin: dict = Depends(require_admin)):
    """One-shot: delete every reading / registry / category for the hardcoded demo
    devices used during development. Use this before the first real deployment."""
    summary = {"per_device": {}}
    for hw in DEMO_HARDWARE_IDS:
        summary["per_device"][hw] = {
            "flowmeter_readings": (await db.flowmeter_readings.delete_many({"hardware_id": hw})).deleted_count,
            "flowmeter_latest":   (await db.flowmeter_latest.delete_many({"hardware_id": hw})).deleted_count,
            "flowmeter_categories": (await db.flowmeter_categories.delete_many({"hardware_id": hw})).deleted_count,
            "instrument_readings": (await db.instrument_readings.delete_many({"hardware_id": hw})).deleted_count,
            "instrument_latest":   (await db.instrument_latest.delete_many({"hardware_id": hw})).deleted_count,
            "instrument_registry": (await db.instrument_registry.delete_many({"hardware_id": hw})).deleted_count,
        }
    summary["device_count"] = len(DEMO_HARDWARE_IDS)
    return {"success": True, "wiped": summary}


@router.post("/{hardware_id}/rotate-key")
async def rotate_device_key(hardware_id: str, admin: dict = Depends(require_admin)):
    """Generate a fresh device_key and invalidate the previous one. Use this when
    a device is replaced or its key is suspected leaked."""
    existing = await db.instrument_registry.find_one({"hardware_id": hardware_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Instrument not found")
    new_key = secrets.token_urlsafe(24)
    await db.instrument_registry.update_one(
        {"hardware_id": hardware_id},
        {"$set": {"device_key": new_key, "key_rotated_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"success": True, "hardware_id": hardware_id, "device_key": new_key}


@router.post("/backfill-keys")
async def backfill_device_keys(admin: dict = Depends(require_admin)):
    """One-shot: add a freshly-generated `device_key` to every legacy instrument
    that doesn't have one yet. Safe to run multiple times."""
    cursor = db.instrument_registry.find({"device_key": {"$in": [None, ""]}}, {"hardware_id": 1, "_id": 0})
    updated = 0
    async for doc in cursor:
        await db.instrument_registry.update_one(
            {"hardware_id": doc["hardware_id"]},
            {"$set": {"device_key": secrets.token_urlsafe(24)}},
        )
        updated += 1
    return {"success": True, "updated": updated}
