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
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Set, Dict
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

from auth import require_admin, get_current_user

router = APIRouter(prefix="/api/instrument-registry", tags=["instrument-registry"])

db = None
mqtt_service = None

SUPPORTED_TYPES = {"flowmeter", "dwlr", "ph", "tds", "conductivity", "wq_stp", "do_meter", "chlorine_analyzer"}
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
    if user.get("role") != "admin":
        hidden = await hidden_device_types(user)
        if hidden:
            query["instrument_type"] = {"$nin": sorted(hidden)}
    cursor = db.instrument_registry.find(query, {"hardware_id": 1, "_id": 0})
    return {doc["hardware_id"] async for doc in cursor}


async def hidden_device_types(user: dict) -> Set[str]:
    """Instrument types the (non-admin) user's admin has toggled OFF.

    Admins always get an empty set (god mode). Missing keys default to
    visible so legacy accounts behave exactly as before."""
    if user.get("role") == "admin":
        return set()
    from api_admin import DEVICE_TYPE_PERMISSIONS  # local import — avoids cycle
    doc = await db.users.find_one({"id": user.get("id")}, {"_id": 0, "view_permissions": 1}) or {}
    vp = doc.get("view_permissions") or {}
    return {itype for key, itype in DEVICE_TYPE_PERMISSIONS.items() if vp.get(key, True) is False}


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
    """Attach owner email + name + location to each registry item."""
    owner_ids = list({i["owner_user_id"] for i in items if i.get("owner_user_id")})
    if not owner_ids:
        return items
    owners = {
        u["id"]: u
        async for u in db.users.find(
            {"id": {"$in": owner_ids}},
            {"_id": 0, "id": 1, "email": 1, "full_name": 1, "company_name": 1, "location_name": 1},
        )
    }
    for it in items:
        owner = owners.get(it.get("owner_user_id"))
        it["owner_email"] = owner.get("email") if owner else None
        it["owner_name"] = (owner.get("full_name") or owner.get("company_name") or owner.get("email")) if owner else None
        # Owner's home location — used by the dashboard tiles as a fallback
        # when the device itself has no `location_name` set.
        it["owner_location_name"] = owner.get("location_name") if owner else None
    return items


# ---------------------------------------------------------------- models
class CreateInstrumentRequest(BaseModel):
    hardware_id: str = Field(..., min_length=1, max_length=64)
    instrument_type: str = Field(..., description="flowmeter | dwlr | ph | tds | conductivity | wq_stp | do_meter")
    owner_user_id: str = Field(..., description="user.id of the assigned client")
    label: Optional[str] = None
    location_name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    category: Optional[str] = None  # flowmeter only
    imei: Optional[str] = Field(None, description="SIM/IMEI (MQTT) or vendor deviceId (HTTP) — how live data is matched to the device")
    manual_water_temp_c: Optional[float] = Field(None, description="Admin-set water temperature (°C) for DWLR devices — device does not send this")
    # STP / DO meter — capacity metadata used by the Water Quality dashboard
    plant_capacity_kld: Optional[float] = Field(None, description="STP plant capacity in KLD (kilolitres per day)")
    tank_capacity_kld: Optional[float] = Field(None, description="Individual aeration tank capacity in KLD")
    # Which aeration tank this DO probe is mounted in (only used for do_meter).
    # Facilities with two or more aeration tanks (parallel-flow STPs) install
    # one DO sensor per tank; this number lets the dashboard split them.
    aeration_tank_number: Optional[int] = Field(None, ge=1, le=100,
                                                 description="Aeration tank number (1..100) for DO analyzers")
    # How this device delivers telemetry to the backend. 'mqtt' (default) covers
    # every device on the shared broker; 'http' is reserved for devices that
    # POST readings over HTTP (e.g. ESPL / gateway REST endpoints).
    source: Optional[str] = Field("mqtt", description="mqtt | http")


class UpdateInstrumentRequest(BaseModel):
    instrument_type: Optional[str] = None
    owner_user_id: Optional[str] = None
    label: Optional[str] = None
    location_name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    category: Optional[str] = None
    imei: Optional[str] = None
    manual_water_temp_c: Optional[float] = None
    plant_capacity_kld: Optional[float] = None
    tank_capacity_kld: Optional[float] = None
    aeration_tank_number: Optional[int] = Field(None, ge=1, le=100)
    source: Optional[str] = None


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
    hidden: Set[str] = set()
    if user.get("role") != "admin":
        query["owner_user_id"] = user.get("id")
        hidden = await hidden_device_types(user)
        if hidden:
            query["instrument_type"] = {"$nin": sorted(hidden)}
    if instrument_type:
        t = _normalise_type(instrument_type)
        if t in hidden:
            return {"instruments": [], "count": 0}
        query["instrument_type"] = t
    cursor = db.instrument_registry.find(query, {"_id": 0}).sort("created_at", -1)
    items = await cursor.to_list(length=2000)
    items = await _enrich_with_owner(items)
    # Retention preview — attach `retention_purge_count` = number of stored
    # readings older than the device's `data_retention_days` window. Admins
    # see this at a glance so they know how much the next daily purge will
    # drop.
    now = datetime.now(timezone.utc)
    for it in items:
        days = it.get("data_retention_days")
        try:
            days = int(days) if days is not None else 0
        except (TypeError, ValueError):
            days = 0
        if days <= 0:
            it["retention_purge_count"] = 0
            continue
        cutoff = (now - timedelta(days=days)).isoformat()
        coll = db.flowmeter_readings if (it.get("instrument_type") or "").lower() == "flowmeter" else db.instrument_readings
        it["retention_purge_count"] = await coll.count_documents({
            "hardware_id": it.get("hardware_id"),
            "received_at": {"$lt": cutoff},
        })
    return {"instruments": items, "count": len(items)}


async def _create_one_instrument(req: "CreateInstrumentRequest", admin: dict) -> dict:
    """Shared create logic — used by both the single-create endpoint and
    the bulk-create endpoint. Returns the persisted registry document."""
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

    imei = (req.imei or "").strip() or None
    if imei:
        clash = await db.instrument_registry.find_one({"imei": imei})
        if clash:
            raise HTTPException(status_code=409, detail=f"IMEI/deviceId '{imei}' is already registered to another instrument")

    doc = {
        "hardware_id": hardware_id,
        "instrument_type": itype,
        "owner_user_id": req.owner_user_id,
        "label": (req.label or hardware_id).strip(),
        "location_name": req.location_name,
        "latitude": req.latitude,
        "longitude": req.longitude,
        "category": category,
        "imei": imei,
        "manual_water_temp_c": req.manual_water_temp_c if itype == "dwlr" else None,
        # Capacity metadata — STP + DO meter only, ignored for other types.
        "plant_capacity_kld": req.plant_capacity_kld if itype in ("wq_stp", "do_meter", "chlorine_analyzer") else None,
        "tank_capacity_kld": req.tank_capacity_kld if itype in ("wq_stp", "do_meter", "chlorine_analyzer") else None,
        # DO-Analyzer-only: which aeration tank the sensor is mounted in.
        "aeration_tank_number": int(req.aeration_tank_number) if (itype == "do_meter" and req.aeration_tank_number) else None,
        # Source: default to HTTP for QESPL-only instrument types
        # (DO/Chlorine/OCEMS) unless the admin explicitly picks something
        # else. These types never arrive over MQTT in practice, and
        # defaulting them to MQTT silently prevented the poller from
        # picking them up ("registered device but dashboard shows No data
        # yet"). Every other type still defaults to MQTT.
        "source": (
            (req.source or "").lower()
            if (req.source or "").lower() in ("mqtt", "http")
            else ("http" if itype in ("do_meter", "chlorine_analyzer", "wq_stp") else "mqtt")
        ),
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

    # Subscribe MQTT so real-device data starts flowing (no-op for HTTP source)
    if doc["source"] == "mqtt":
        await _subscribe_topic(itype, hardware_id)

    return doc


@router.post("")
async def create_instrument(req: CreateInstrumentRequest, admin: dict = Depends(require_admin)):
    """Register a new physical device and assign it to a client."""
    doc = await _create_one_instrument(req, admin)
    return {"success": True, "instrument": doc}


# --------------------------------------------------------------------------- bulk create
class BulkCreateRequest(BaseModel):
    instruments: List[CreateInstrumentRequest] = Field(
        ..., min_length=1, max_length=100,
        description="1..100 instrument definitions to register in one call.",
    )


@router.post("/bulk")
async def create_bulk_instruments(req: BulkCreateRequest, admin: dict = Depends(require_admin)):
    """Register multiple instruments in a single call.

    Each entry is validated & created independently — if one row fails
    (duplicate hardware_id, unknown owner, invalid type, …) the others
    still succeed. The response lists both `created` and `errors` so the
    UI can show a per-row status.
    """
    created: List[dict] = []
    errors: List[dict] = []
    for idx, item in enumerate(req.instruments):
        try:
            doc = await _create_one_instrument(item, admin)
            created.append({
                "index": idx,
                "hardware_id": doc["hardware_id"],
                "instrument_type": doc["instrument_type"],
                "source": doc["source"],
                "imei": doc.get("imei"),
            })
        except HTTPException as e:
            errors.append({
                "index": idx,
                "hardware_id": (item.hardware_id or "").strip(),
                "error": str(e.detail),
                "status_code": e.status_code,
            })
        except Exception as e:  # noqa: BLE001
            errors.append({
                "index": idx,
                "hardware_id": (item.hardware_id or "").strip(),
                "error": str(e)[:200],
                "status_code": 500,
            })
    return {
        "success": len(errors) == 0,
        "created_count": len(created),
        "error_count": len(errors),
        "created": created,
        "errors": errors,
    }


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
    if req.imei is not None:
        new_imei = req.imei.strip() or None
        if new_imei and new_imei != existing.get("imei"):
            clash = await db.instrument_registry.find_one(
                {"imei": new_imei, "hardware_id": {"$ne": hardware_id}}
            )
            if clash:
                raise HTTPException(status_code=409, detail=f"IMEI '{new_imei}' is already registered to another instrument")
        updates["imei"] = new_imei
    if req.manual_water_temp_c is not None:
        # Only meaningful for DWLR; store regardless (harmless for other types).
        updates["manual_water_temp_c"] = float(req.manual_water_temp_c)
    if req.plant_capacity_kld is not None:
        updates["plant_capacity_kld"] = float(req.plant_capacity_kld)
    if req.tank_capacity_kld is not None:
        updates["tank_capacity_kld"] = float(req.tank_capacity_kld)
    if req.aeration_tank_number is not None:
        updates["aeration_tank_number"] = int(req.aeration_tank_number)
    elif "aeration_tank_number" in getattr(req, "model_fields_set", set()):
        # Explicit `null` in the request body → clear the mapping.
        updates["aeration_tank_number"] = None
    if req.source is not None:
        s = req.source.lower().strip()
        if s not in ("mqtt", "http"):
            raise HTTPException(status_code=400, detail="source must be 'mqtt' or 'http'")
        updates["source"] = s

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


# --------------------------------------------------------------------------- rename
class RenameHardwareIdRequest(BaseModel):
    new_hardware_id: str = Field(..., min_length=1, max_length=64,
                                  description="New hardware_id — must be unique across the registry.")


# Collections that carry `hardware_id` as a foreign key. Order does not
# matter for correctness (each collection is independent), but we keep the
# registry last so the source of truth is only flipped after every FK is
# updated. If any downstream update fails we abort BEFORE touching the
# registry, leaving the whole system consistent.
_HW_ID_COLLECTIONS = (
    "flowmeter_readings",
    "flowmeter_latest",
    "flowmeter_categories",
    "instrument_readings",
    "instrument_latest",
    "flow_limits",
    "limit_alerts_state",
    "notification_state",
    "audit_log",
    "camera_streams",
    "renewals",
    "renewal_reminders_state",
    "login_attempts",
    "certificates",
)


@router.post("/{hardware_id}/rename")
async def rename_hardware_id(
    hardware_id: str,
    req: RenameHardwareIdRequest,
    admin: dict = Depends(require_admin),
):
    """Rename a device's `hardware_id` across every collection that references it.

    Steps
    -----
    1. Validate the new id is non-empty, differs from the current one, and is
       not already registered to another device.
    2. Update every foreign-key collection (readings, latest, categories,
       limits, alerts state, audit log, cameras, certificates, renewals) so
       that history stays attached to the same instrument.
    3. Update the primary `instrument_registry` document last.
    4. Write an audit-log entry so ops can trace who renamed what.

    Note: MongoDB standalone deployments don't support cross-collection
    transactions. Failure between steps 2 and 3 would leave FK rows updated
    but the registry key still pointing at the old id — safe (never orphans
    data), but the admin can safely re-run this endpoint with the same new id
    and it will simply flip the registry row.
    """
    new_id = req.new_hardware_id.strip()
    if not new_id:
        raise HTTPException(status_code=400, detail="new_hardware_id is required")
    if new_id == hardware_id:
        raise HTTPException(status_code=400, detail="new_hardware_id is identical to the current id")

    existing = await db.instrument_registry.find_one({"hardware_id": hardware_id})
    if not existing:
        raise HTTPException(status_code=404, detail=f"Instrument '{hardware_id}' not found")

    clash = await db.instrument_registry.find_one({"hardware_id": new_id})
    if clash and clash.get("hardware_id") != hardware_id:
        raise HTTPException(status_code=409, detail=f"Hardware id '{new_id}' is already registered")

    # Update every FK collection first
    per_collection: Dict[str, int] = {}
    existing_collections = set(await db.list_collection_names())
    for coll in _HW_ID_COLLECTIONS:
        if coll not in existing_collections:
            continue
        result = await db[coll].update_many(
            {"hardware_id": hardware_id},
            {"$set": {"hardware_id": new_id}},
        )
        per_collection[coll] = result.modified_count

    # Flip the source of truth last
    await db.instrument_registry.update_one(
        {"hardware_id": hardware_id},
        {"$set": {
            "hardware_id": new_id,
            "previous_hardware_id": hardware_id,
            "renamed_at": datetime.now(timezone.utc).isoformat(),
            "renamed_by": admin.get("id"),
        }},
    )

    # Audit trail — separate write so the payload survives even if the
    # cascade update above only touched a subset of collections.
    await db.audit_log.insert_one({
        "action": "rename_hardware_id",
        "entity_type": "instrument_registry",
        "entity_id": new_id,
        "old_hardware_id": hardware_id,
        "new_hardware_id": new_id,
        "actor_id": admin.get("id"),
        "actor_email": admin.get("email"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "affected_rows": per_collection,
    })

    return {
        "success": True,
        "old_hardware_id": hardware_id,
        "new_hardware_id": new_id,
        "affected_rows": per_collection,
        "total_rows_updated": sum(per_collection.values()),
    }


# --------------------------------------------------------------------------- data frequency
class DataFrequencyRequest(BaseModel):
    minutes: int = Field(..., ge=0, le=1440,
                         description="Minutes between stored readings (5..1440). 0 disables throttling.")
    # LIFETIME RETENTION: field kept in the model for backward compat with
    # older clients that still send it, but always ignored by the server.
    # Every instrument reading is retained forever so clients can recall
    # historical data at any point.
    retention_days: Optional[int] = Field(None, ge=0, le=3650,
                                          description="[DEPRECATED — ignored] Data is retained for lifetime.")


@router.put("/{hardware_id}/data-frequency")
async def set_data_frequency(
    hardware_id: str,
    req: DataFrequencyRequest,
    admin: dict = Depends(require_admin),
):
    """Configure how often incoming readings are persisted for this device.

    A value of `0` disables throttling — every reading that arrives is stored.
    Any positive value (5..1440 min) instructs the ingestion layer to drop
    readings that arrive within the interval since the last stored reading.
    The `_latest` collections are always updated so the live dashboard tile
    reflects the most recent value.

    NOTE: `retention_days` is intentionally ignored — every reading is
    kept for lifetime so clients can query any historical range.
    """
    if req.minutes and (req.minutes < 5 or req.minutes > 1440):
        raise HTTPException(status_code=400, detail="Frequency must be 0, or between 5 and 1440 minutes")
    existing = await db.instrument_registry.find_one({"hardware_id": hardware_id}, {"_id": 0, "hardware_id": 1})
    if not existing:
        raise HTTPException(status_code=404, detail="Instrument not found")
    await db.instrument_registry.update_one(
        {"hardware_id": hardware_id},
        {"$set": {
            "data_frequency_minutes": int(req.minutes) or None,
            "data_retention_days": None,      # Force lifetime retention.
            "data_frequency_updated_at": datetime.now(timezone.utc).isoformat(),
            "data_frequency_updated_by": admin.get("id"),
        }},
    )
    return {
        "success": True,
        "hardware_id": hardware_id,
        "data_frequency_minutes": int(req.minutes) or None,
        "data_retention_days": None,
        "retention_policy": "lifetime",
    }


# --------------------------------------------------------------------------- clear history
class ClearHistoryRequest(BaseModel):
    from_ts: Optional[str] = Field(None, description="Inclusive ISO datetime (UTC). Omit for open-ended lower bound.")
    to_ts: Optional[str] = Field(None, description="Inclusive ISO datetime (UTC). Omit for open-ended upper bound.")


def _parse_iso_bound(s: Optional[str], field: str) -> Optional[str]:
    if s is None or s == "":
        return None
    try:
        dt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid {field}: expected ISO datetime")
    return dt.astimezone(timezone.utc).isoformat()


def _iso_variants(iso: Optional[str]) -> Optional[list]:
    """Return both `+00:00` and `Z` string forms of a UTC ISO timestamp so
    a Mongo range query catches rows stored in either format. Older
    ingestion paths wrote `...Z` while newer ones write `...+00:00`."""
    if not iso:
        return None
    variants = {iso}
    if iso.endswith("+00:00"):
        variants.add(iso[:-6] + "Z")
    elif iso.endswith("Z"):
        variants.add(iso[:-1] + "+00:00")
    return sorted(variants)


@router.post("/{hardware_id}/clear-history")
async def clear_history(
    hardware_id: str,
    req: ClearHistoryRequest,
    admin: dict = Depends(require_admin),
):
    """Delete historical readings for one device, within an optional date range.

    * Both bounds omitted → wipes *all* history for the device (readings and
      the `_latest` cache).
    * Any bound provided → deletes only rows whose `received_at` falls inside
      the closed interval; `_latest` is preserved when it's outside the range.

    Every clear is logged to `audit_log` with the affected row counts so it's
    reversible via forensics.
    """
    existing = await db.instrument_registry.find_one({"hardware_id": hardware_id}, {"_id": 0, "instrument_type": 1})
    if not existing:
        raise HTTPException(status_code=404, detail="Instrument not found")

    from_iso = _parse_iso_bound(req.from_ts, "from_ts")
    to_iso = _parse_iso_bound(req.to_ts, "to_ts")

    # Build a Mongo filter that catches rows stored with EITHER `+00:00` or
    # `Z` as the trailing UTC marker — historically both formats have been
    # written to disk by different ingestion paths (raw MQTT wrote `Z`, the
    # HTTPS poller wrote `+00:00`). A plain string range on one variant
    # would miss the other.
    def _range_filter(field: str) -> dict:
        f_variants = _iso_variants(from_iso)
        t_variants = _iso_variants(to_iso)
        # Build one $or clause per (from-variant, to-variant) combination so
        # each individual comparison is a pure string range on Mongo's side
        # (indexable). At most 2×2 = 4 clauses.
        clauses: list = []
        f_opts = f_variants if f_variants else [None]
        t_opts = t_variants if t_variants else [None]
        for f in f_opts:
            for t in t_opts:
                inner: dict = {}
                if f: inner["$gte"] = f
                if t: inner["$lte"] = t
                if inner:
                    clauses.append({field: inner})
        return {"$or": clauses} if clauses else {}

    range_clause = _range_filter("received_at")

    reading_query: Dict = {"hardware_id": hardware_id}
    if range_clause:
        reading_query.update(range_clause)

    fm_res = await db.flowmeter_readings.delete_many(reading_query)
    inst_res = await db.instrument_readings.delete_many(reading_query)

    # Also drop `_latest` when either it falls inside the range or no range
    # was given at all (i.e. full wipe). Prevents a stale tile from surviving
    # after a full historic purge.
    latest_res_fm = latest_res_inst = None
    if not range_clause:
        latest_res_fm = await db.flowmeter_latest.delete_many({"hardware_id": hardware_id})
        latest_res_inst = await db.instrument_latest.delete_many({"hardware_id": hardware_id})
    else:
        latest_range = _range_filter("received_at")
        latest_res_fm = await db.flowmeter_latest.delete_many({"hardware_id": hardware_id, **latest_range})
        latest_res_inst = await db.instrument_latest.delete_many({"hardware_id": hardware_id, **latest_range})

    counts = {
        "flowmeter_readings": fm_res.deleted_count,
        "instrument_readings": inst_res.deleted_count,
        "flowmeter_latest": latest_res_fm.deleted_count if latest_res_fm else 0,
        "instrument_latest": latest_res_inst.deleted_count if latest_res_inst else 0,
    }

    await db.audit_log.insert_one({
        "action": "clear_history",
        "entity_type": "instrument_registry",
        "entity_id": hardware_id,
        "hardware_id": hardware_id,
        "from_ts": from_iso,
        "to_ts": to_iso,
        "actor_id": admin.get("id"),
        "actor_email": admin.get("email"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "affected_rows": counts,
    })

    return {
        "success": True,
        "hardware_id": hardware_id,
        "from_ts": from_iso,
        "to_ts": to_iso,
        "affected_rows": counts,
        "total_rows_deleted": sum(counts.values()),
    }


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


# ============================================================================
# DUMMY-DATA AUTOMATION — for instruments offline due to poor network
# ============================================================================
class DummyConfigRequest(BaseModel):
    enabled: bool = Field(..., description="Turn dummy-data generation on/off")
    min_value: Optional[float] = Field(None, description="Lower bound of the generated value")
    max_value: Optional[float] = Field(None, description="Upper bound of the generated value")
    interval_seconds: Optional[int] = Field(
        900, ge=30, le=86400,
        description="Seconds between dummy readings (30s..24h). Default 15min."
    )


@router.get("/{hardware_id}/dummy")
async def get_dummy_config(hardware_id: str, admin: dict = Depends(require_admin)):
    inst = await db.instrument_registry.find_one(
        {"hardware_id": hardware_id}, {"_id": 0, "dummy_config": 1, "instrument_type": 1}
    )
    if not inst:
        raise HTTPException(status_code=404, detail="Instrument not found")
    return {
        "hardware_id": hardware_id,
        "instrument_type": inst.get("instrument_type"),
        "dummy_config": inst.get("dummy_config") or {
            "enabled": False, "min_value": None, "max_value": None,
            "interval_seconds": 900,
        },
    }


@router.put("/{hardware_id}/dummy")
async def set_dummy_config(hardware_id: str, req: DummyConfigRequest,
                            admin: dict = Depends(require_admin)):
    """Enable/disable dummy-data generation for an instrument (admin only).

    When enabling, `min_value` and `max_value` are required. `interval_seconds`
    defaults to 15 minutes.
    """
    inst = await db.instrument_registry.find_one({"hardware_id": hardware_id}, {"_id": 0})
    if not inst:
        raise HTTPException(status_code=404, detail="Instrument not found")

    if req.enabled:
        if req.min_value is None or req.max_value is None:
            raise HTTPException(status_code=400,
                                detail="min_value and max_value are required when enabling dummy mode")
        if req.max_value <= req.min_value:
            raise HTTPException(status_code=400,
                                detail="max_value must be strictly greater than min_value")

    cfg = {
        "enabled": bool(req.enabled),
        "min_value": float(req.min_value) if req.min_value is not None else None,
        "max_value": float(req.max_value) if req.max_value is not None else None,
        "interval_seconds": int(req.interval_seconds or 900),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "updated_by": admin.get("id"),
        "last_generated_at": (inst.get("dummy_config") or {}).get("last_generated_at"),
    }
    await db.instrument_registry.update_one(
        {"hardware_id": hardware_id},
        {"$set": {"dummy_config": cfg}},
    )
    # Audit trail — production accountability for who flipped dummy mode
    await db.audit_log.insert_one({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "entity_type": "instrument_dummy_config",
        "entity_id": hardware_id,
        "action": "enable" if req.enabled else "disable",
        "actor_id": admin.get("id"),
        "actor_email": admin.get("email"),
        "detail": {
            "min_value": cfg["min_value"],
            "max_value": cfg["max_value"],
            "interval_seconds": cfg["interval_seconds"],
        },
    })
    return {"success": True, "hardware_id": hardware_id, "dummy_config": cfg}


@router.get("/dummy/all")
async def list_dummy_enabled(admin: dict = Depends(require_admin)):
    """List every instrument that has dummy mode currently ON."""
    cursor = db.instrument_registry.find(
        {"dummy_config.enabled": True},
        {"_id": 0, "hardware_id": 1, "instrument_type": 1, "label": 1, "dummy_config": 1},
    )
    items = await cursor.to_list(length=500)
    return {"count": len(items), "instruments": items}



class DummyBackfillRequest(BaseModel):
    from_date: str = Field(..., description="ISO date/datetime for the start of the backfill window (UTC assumed)")
    to_date: str = Field(..., description="ISO date/datetime for the end of the window (UTC assumed)")
    interval_seconds: int = Field(900, ge=30, le=86400,
                                   description="Seconds between generated readings (30s..24h)")
    min_value: float = Field(..., description="Lower bound of the generated values")
    max_value: float = Field(..., description="Upper bound of the generated values")


@router.post("/{hardware_id}/dummy/backfill")
async def backfill_dummy_history(hardware_id: str, req: DummyBackfillRequest,
                                  admin: dict = Depends(require_admin)):
    """Backfill up to **5 years** of historical dummy readings for an instrument.

    Timestamps use the exact same wire format as real IoT device payloads
    (`TIME: YYMMDDHHMMSS` for DWLR, ISO 8601 for internal `timestamp` /
    `received_at`), and generated values follow the same realistic bounded
    random walk used by the live dummy loop, so the historical series looks
    organic and never repeats exactly across days.

    Guardrails:
    * `from_date` cannot be more than 5 years in the past.
    * `to_date` is clamped to `now` if it's in the future.
    * Total rows per call are capped at 200,000 — use a larger interval if
      the requested window would exceed that.
    """
    inst = await db.instrument_registry.find_one({"hardware_id": hardware_id}, {"_id": 0})
    if not inst:
        raise HTTPException(status_code=404, detail="Instrument not found")

    try:
        from_dt = datetime.fromisoformat(req.from_date.replace("Z", "+00:00"))
        to_dt = datetime.fromisoformat(req.to_date.replace("Z", "+00:00"))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid date format: {e}")

    from dummy_data_service import backfill_history  # local import to avoid startup cycle
    try:
        result = await backfill_history(
            db, inst,
            from_dt=from_dt, to_dt=to_dt,
            interval_seconds=int(req.interval_seconds),
            lo=float(req.min_value), hi=float(req.max_value),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    # Audit trail
    await db.audit_log.insert_one({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "entity_type": "instrument_dummy_backfill",
        "entity_id": hardware_id,
        "action": "backfill",
        "actor_id": admin.get("id"),
        "actor_email": admin.get("email"),
        "detail": {
            "from_date": result["from_date"],
            "to_date": result["to_date"],
            "interval_seconds": result["interval_seconds"],
            "inserted_count": result["inserted_count"],
            "min_value": result["min_value"],
            "max_value": result["max_value"],
        },
    })
    return {"success": True, **result}

