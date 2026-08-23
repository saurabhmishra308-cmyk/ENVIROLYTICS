"""Admin API endpoints: user management, site activation, data export, certificates."""
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr, field_validator
from typing import Optional, List, Dict
from datetime import datetime, timezone, timedelta
import io
import uuid

import re
from models import UserRole, SiteStatus, SubscriptionType
from auth import hash_password, require_admin, require_operator, get_current_user
from data_export_service import DataExportService, ExcelImportService
from certificate_service import CertificateGenerator

router = APIRouter(prefix="/api/admin", tags=["admin"])

# Global db (set from server.py)
db = None

# Usernames — user-facing login handle. Accept letters, digits, and a
# useful set of special characters (dots, dashes, underscores, plus, @,
# and a few punctuation marks). 3..30 chars. Case-preserving.
USERNAME_RE = re.compile(r"^[A-Za-z0-9._!$@\-+]{3,30}$")


# ============================
# Shield helper — enforces admin/staff invisibility to staff callers
# ============================
def _staff_can_see(caller: dict, target: dict) -> bool:
    """A staff caller cannot see or act on the admin, nor any OTHER staff.
    They CAN act on themselves and on clients. Admin sees everything."""
    if not target:
        return False
    if (caller.get("role") or "").lower() == "admin":
        return True
    target_role = (target.get("role") or "").lower()
    if target_role == "admin":
        return False
    if target_role == "staff" and target.get("id") != caller.get("id"):
        return False
    return True


async def _shield_target(user_id: str, caller: dict) -> dict:
    """Fetch the target user OR 404. When the caller is staff and the
    target is admin/other-staff, we return 404 (not 403) so the endpoint
    never leaks the target's existence."""
    target = await db.users.find_one({"id": user_id})
    if not target or not _staff_can_see(caller, target):
        raise HTTPException(status_code=404, detail="User not found")
    return target


# ============================
# Models
# ============================
class AdminCreateUserRequest(BaseModel):
    email: EmailStr
    username: Optional[str] = None
    password: str
    full_name: str
    role: str = "client"
    company_name: Optional[str] = None
    phone: Optional[str] = None
    location_name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    # Up to 2 additional email addresses that will also receive offline
    # alerts for this client's devices. Client-only — sub-user creation is
    # a separate flow that does not accept these fields.
    notification_emails: Optional[List[str]] = None

    @field_validator("username")
    @classmethod
    def _validate_username(cls, v):
        if v is None:
            return v
        v = v.strip()
        if not v:
            return None
        if not USERNAME_RE.match(v):
            raise ValueError("Username must be 3..30 chars — letters, digits, and any of . _ - + ! $ @")
        return v

    @field_validator("notification_emails")
    @classmethod
    def _cap_two(cls, v):
        if not v:
            return v
        cleaned = [e.strip().lower() for e in v if e and e.strip()]
        if len(cleaned) > 2:
            raise ValueError("A user can have at most 2 notification emails")
        return cleaned or None


class AdminUpdateUserRequest(BaseModel):
    full_name: Optional[str] = None
    username: Optional[str] = None
    company_name: Optional[str] = None
    phone: Optional[str] = None
    location_name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    role: Optional[str] = None
    notification_emails: Optional[List[str]] = None

    @field_validator("username")
    @classmethod
    def _validate_username(cls, v):
        if v is None:
            return v
        v = v.strip()
        if not v:
            return None
        if not USERNAME_RE.match(v):
            raise ValueError("Username must be 3..30 chars — letters, digits, and any of . _ - + ! $ @")
        return v

    @field_validator("notification_emails")
    @classmethod
    def _cap_two(cls, v):
        if v is None:
            return v
        cleaned = [e.strip().lower() for e in v if e and e.strip()]
        if len(cleaned) > 2:
            raise ValueError("A user can have at most 2 notification emails")
        return cleaned


class ActivateSiteRequest(BaseModel):
    user_id: str
    subscription_type: SubscriptionType


# ============================
# User Management
# ============================
@router.post("/users/create")
async def create_user(req: AdminCreateUserRequest, caller: dict = Depends(require_operator)):
    email = req.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already exists")
    if len(req.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    # Username: use admin-supplied value if provided; else derive from email
    # local-part. Enforce uniqueness by appending a numeric suffix on clash.
    desired = (req.username or email.split("@")[0]).strip()
    candidate = desired
    n = 1
    while await db.users.find_one({"username": candidate}):
        n += 1
        candidate = f"{desired}{n}"
    final_username = candidate

    now_dt = datetime.now(timezone.utc)
    # Roles allowed: 'admin' (blocked below — single-instance policy),
    # 'staff' (elevated operator), or 'client' (default).
    role = req.role if req.role in ("admin", "client", "staff") else "client"
    # Single-admin policy: an admin is seeded at boot; no additional admins
    # may ever be created. Attempts to escalate a new user to admin are
    # rejected so the caller doesn't accidentally spawn a second super-admin.
    if role == "admin":
        raise HTTPException(
            status_code=403,
            detail="Only one admin account is permitted. Create a client or staff account instead.",
        )
    # Service-term expiry applies to clients only. Staff (like admin) never
    # expire and never receive renewal reminder emails.
    term_years = None
    service_expiry = None
    if role == "client":
        term_years = 1.0
        service_expiry = (now_dt + timedelta(days=term_years * 365.25)).isoformat()

    user_doc = {
        "id": f"user_{uuid.uuid4().hex[:12]}",
        "email": email,
        "username": final_username,
        "password_hash": hash_password(req.password),
        "full_name": req.full_name,
        "company_name": req.company_name,
        "phone": req.phone,
        "role": role,
        "is_active": True,
        "location_name": req.location_name,
        "latitude": req.latitude,
        "longitude": req.longitude,
        "created_at": now_dt.isoformat(),
        "created_by": caller["id"],
        "service_term_years": term_years,
        "service_expiry_date": service_expiry,
        "notification_emails": req.notification_emails or [],
    }
    await db.users.insert_one(user_doc)
    user_doc.pop("password_hash", None)
    user_doc.pop("_id", None)
    return {"success": True, "user": user_doc}


@router.get("/users/list")
async def list_users(caller: dict = Depends(require_operator)):
    cursor = db.users.find({}, {"password_hash": 0, "_id": 0})
    users = await cursor.to_list(length=500)
    # Staff callers never see the admin, and never see OTHER staff either.
    if (caller.get("role") or "").lower() == "staff":
        users = [u for u in users if _staff_can_see(caller, u)]
    return {"users": users, "count": len(users)}


@router.get("/users/locations")
async def list_locations(user: dict = Depends(get_current_user)):
    """Any authenticated user can see the location map (lat/long + name only)."""
    cursor = db.users.find(
        {"latitude": {"$ne": None}, "longitude": {"$ne": None}},
        {"_id": 0, "id": 1, "full_name": 1, "company_name": 1, "location_name": 1,
         "latitude": 1, "longitude": 1, "role": 1, "is_active": 1},
    )
    items = await cursor.to_list(length=500)
    return {"locations": items, "count": len(items)}


@router.put("/users/{user_id}/status")
async def toggle_user_status(user_id: str, is_active: bool, caller: dict = Depends(require_operator)):
    target = await _shield_target(user_id, caller)
    if target.get("role") == "admin" and not is_active:
        raise HTTPException(status_code=400, detail="Admin accounts cannot be deactivated")
    await db.users.update_one({"id": user_id}, {"$set": {"is_active": is_active}})
    return {"success": True, "is_active": is_active}


@router.put("/users/{user_id}")
async def update_user(user_id: str, req: AdminUpdateUserRequest, caller: dict = Depends(require_operator)):
    """Update user profile (location, contact info, role, notification_emails)."""
    target = await _shield_target(user_id, caller)
    updates = req.model_dump(exclude_unset=True)
    if "role" in updates and updates["role"] not in ("admin", "client", "staff"):
        raise HTTPException(status_code=400, detail="Invalid role")
    if "role" in updates:
        if target.get("role") == "admin" and updates["role"] != "admin":
            raise HTTPException(status_code=400, detail="Admin role cannot be changed — admin is always god mode")
        if target.get("role") != "admin" and updates["role"] == "admin":
            raise HTTPException(status_code=403, detail="Only one admin account is permitted")
    if "username" in updates and updates["username"]:
        clash = await db.users.find_one({"username": updates["username"], "id": {"$ne": user_id}})
        if clash:
            raise HTTPException(status_code=409, detail=f"Username '{updates['username']}' is already taken")
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    result = await db.users.update_one({"id": user_id}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"success": True, "updated_fields": list(updates.keys())}


@router.delete("/users/{user_id}")
async def delete_user(user_id: str, caller: dict = Depends(require_operator)):
    if user_id == caller["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete self")
    target = await _shield_target(user_id, caller)
    if target.get("role") == "admin":
        raise HTTPException(status_code=400, detail="Admin accounts cannot be deleted")
    result = await db.users.delete_one({"id": user_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"success": True}


# ---------------------------- View Permissions ----------------------------
# Admins pick which sidebar pages / panels a specific client can see.
# The client never sees write CTAs anywhere — this only gates VIEW access.

# Every page/panel key the admin can toggle for a client. Keeping this
# list in one place so the admin UI and the enforcement layer stay in sync.
VIEW_PERMISSION_KEYS = [
    "dashboard",
    "analysis",
    "reports",
    "graph_report",
    "site",
    "certificates",
    "audit_log",
    "customer_profile",
    "water_quality",
    "flowmeter",
    "dwlr",
    "ph",
    "tds",
    "conductivity",
    "rwh_recharge",
]

# Per-device-type visibility toggles. When a key is OFF for a client, every
# device of the mapped instrument_type is filtered out of ALL data endpoints
# (dashboard, reports, water quality, maps, exports) at the backend level.
# Admins always see everything (god mode).
DEVICE_TYPE_PERMISSIONS = {
    "show_flowmeter_devices": "flowmeter",
    "show_dwlr_devices": "dwlr",
    "show_do_devices": "do_meter",
    "show_chlorine_devices": "chlorine_analyzer",
    "show_ocems_devices": "wq_stp",
    "show_ph_devices": "ph",
    "show_tds_devices": "tds",
    "show_conductivity_devices": "conductivity",
}
VIEW_PERMISSION_KEYS += list(DEVICE_TYPE_PERMISSIONS.keys())


class ViewPermissionsRequest(BaseModel):
    permissions: Dict[str, bool]

    @field_validator("permissions")
    @classmethod
    def _keys_only(cls, v):
        unknown = [k for k in v.keys() if k not in VIEW_PERMISSION_KEYS]
        if unknown:
            raise ValueError(f"Unknown permission keys: {unknown}")
        return v


def _default_client_permissions() -> Dict[str, bool]:
    """Sensible defaults for a brand-new client — every page ON. Admin
    can then flip off whatever the client shouldn't see."""
    return {k: True for k in VIEW_PERMISSION_KEYS}


@router.get("/users/{user_id}/view-permissions")
async def get_view_permissions(user_id: str, caller: dict = Depends(require_operator)):
    user = await _shield_target(user_id, caller)
    perms = user.get("view_permissions") or _default_client_permissions()
    # Ensure every current key is present (older users may lack newly-added keys).
    for k in VIEW_PERMISSION_KEYS:
        perms.setdefault(k, True)
    return {"user_id": user_id, "role": user.get("role"), "permissions": perms, "all_keys": VIEW_PERMISSION_KEYS}


@router.put("/users/{user_id}/view-permissions")
async def update_view_permissions(user_id: str, req: ViewPermissionsRequest, caller: dict = Depends(require_operator)):
    user = await _shield_target(user_id, caller)
    if user.get("role") == "admin":
        raise HTTPException(status_code=400, detail="Admins have full access — view permissions do not apply")
    # Merge with current so partial payloads don't wipe untouched keys.
    current = (await db.users.find_one({"id": user_id}, {"_id": 0, "view_permissions": 1}) or {}).get("view_permissions") or _default_client_permissions()
    for k, v in req.permissions.items():
        current[k] = bool(v)
    await db.users.update_one({"id": user_id}, {"$set": {"view_permissions": current}})
    return {"success": True, "permissions": current}


# ============================
# Site Activation
# ============================
@router.post("/site/activate")
async def activate_site(req: ActivateSiteRequest, admin: dict = Depends(require_operator)):
    start = datetime.now(timezone.utc)
    days = {"monthly": 30, "quarterly": 90, "yearly": 365}[req.subscription_type.value]
    end = start + timedelta(days=days)

    doc = {
        "id": f"sub_{uuid.uuid4().hex[:12]}",
        "user_id": req.user_id,
        "subscription_type": req.subscription_type.value,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "status": SiteStatus.ACTIVE.value,
        "created_by": admin["id"],
        "created_at": start.isoformat(),
    }
    await db.site_activations.insert_one(doc)
    doc.pop("_id", None)
    return {"success": True, "activation": doc}


@router.get("/site/status/{user_id}")
async def check_site_status(user_id: str):
    activation = await db.site_activations.find_one(
        {"user_id": user_id}, sort=[("created_at", -1)]
    )
    if not activation:
        return {"status": SiteStatus.INACTIVE.value, "message": "No active subscription"}

    end_date = activation["end_date"]
    if isinstance(end_date, str):
        end_date = datetime.fromisoformat(end_date)
    now = datetime.now(timezone.utc)
    if end_date.tzinfo is None:
        end_date = end_date.replace(tzinfo=timezone.utc)

    if now > end_date:
        return {
            "status": SiteStatus.EXPIRED.value,
            "expired_on": end_date.isoformat(),
        }
    return {
        "status": SiteStatus.ACTIVE.value,
        "subscription_type": activation["subscription_type"],
        "expires_on": end_date.isoformat(),
    }


@router.get("/site/activations")
async def list_activations(admin: dict = Depends(require_operator)):
    cursor = db.site_activations.find({}, {"_id": 0}).sort("created_at", -1)
    items = await cursor.to_list(length=500)
    return {"activations": items, "count": len(items)}


# ============================
# Data Export
# ============================
@router.get("/data/export")
async def export_data(
    format: str = Query(..., regex="^(csv|pdf)$"),
    hardware_id: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    admin: dict = Depends(require_operator),
):
    query = {}
    if hardware_id:
        query["hardware_id"] = hardware_id
    if start_date or end_date:
        query["timestamp"] = {}
        if start_date:
            query["timestamp"]["$gte"] = start_date
        if end_date:
            query["timestamp"]["$lte"] = end_date

    cursor = db.flowmeter_readings.find(query).sort("timestamp", -1).limit(1000)
    readings = await cursor.to_list(length=1000)

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
    else:
        pdf_data = DataExportService.to_pdf(readings, "Flowmeter Readings Report")
        return StreamingResponse(
            io.BytesIO(pdf_data),
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename=flowmeter_report_{today}.pdf"},
        )


# ============================
# Manual Data Import (CSV / Excel) — admin only
# ============================
@router.get("/data/template")
async def data_template(
    instrument_type: str = Query("flowmeter", regex="^(flowmeter|dwlr)$"),
    admin: dict = Depends(require_operator),
):
    """Download a starter CSV template with the exact columns expected by the importer."""
    if instrument_type == "dwlr":
        content = ExcelImportService.dwlr_template_csv()
        fname = "dwlr_template.csv"
    else:
        content = ExcelImportService.flowmeter_template_csv()
        fname = "flowmeter_template.csv"
    return StreamingResponse(
        io.BytesIO(content),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={fname}"},
    )


@router.post("/data/import")
async def import_data(
    file: UploadFile = File(...),
    instrument_type: str = Query("flowmeter", regex="^(flowmeter|dwlr)$"),
    admin: dict = Depends(require_operator),
):
    """Manual data ingestion for admins. Supports both CSV and Excel files.

    `instrument_type=flowmeter` (default) → rows go into `flowmeter_readings`.
    `instrument_type=dwlr` → rows go into `instrument_readings` with `values.LEVEL`
    populated in mWC.

    Download the correct template from `GET /api/admin/data/template?instrument_type=...`
    """
    fname = (file.filename or "").lower()
    if not fname.endswith((".xlsx", ".xls", ".csv")):
        raise HTTPException(status_code=400, detail="Only .csv, .xlsx or .xls files are supported")

    content = await file.read()
    try:
        data = ExcelImportService.parse_file(content, fname)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Failed to parse file: {e}")

    if instrument_type == "dwlr":
        valid_data, errors = ExcelImportService.validate_dwlr_data(data)
        collection = db.instrument_readings
        latest_coll = db.instrument_latest
    else:
        valid_data, errors = ExcelImportService.validate_flowmeter_data(data)
        collection = db.flowmeter_readings
        latest_coll = db.flowmeter_latest

    # -------------------------------------------------------------------
    # Safety: verify every hardware_id in the sheet is registered AND is of
    # the expected type (flowmeter row can only write to a flowmeter,
    # DWLR row can only write to a DWLR). Prevents accidental writes to
    # the wrong client's device or the wrong device type.
    # -------------------------------------------------------------------
    hw_in_sheet = {r.get("hardware_id") for r in valid_data if r.get("hardware_id")}
    latest_ts_by_hw: Dict[str, str] = {}
    if hw_in_sheet:
        registry_docs = await db.instrument_registry.find(
            {"hardware_id": {"$in": list(hw_in_sheet)}},
            {"_id": 0, "hardware_id": 1, "instrument_type": 1, "owner_user_id": 1, "label": 1},
        ).to_list(length=None)
        registered = {d["hardware_id"]: d for d in registry_docs}

        # Pre-fetch the newest existing timestamp per hardware_id so we can
        # reject rows that would overwrite current data. Backfill must
        # ONLY correct old (historical) readings — the live stream is
        # authoritative for anything at or after the newest known ts.
        for hw in hw_in_sheet:
            filt = {"hardware_id": hw}
            if instrument_type == "dwlr":
                filt["instrument_type"] = "dwlr"
            newest = await collection.find_one(filt, {"_id": 0, "timestamp": 1}, sort=[("timestamp", -1)])
            if newest and newest.get("timestamp"):
                latest_ts_by_hw[hw] = str(newest["timestamp"])

        allowed_type = "dwlr" if instrument_type == "dwlr" else "flowmeter"
        good_rows: List[Dict] = []
        for row in valid_data:
            hw = row.get("hardware_id")
            reg = registered.get(hw)
            if not reg:
                errors.append(f"hardware_id '{hw}' is not registered — add it in the Instruments page first")
                continue
            if reg.get("instrument_type") != allowed_type:
                errors.append(
                    f"hardware_id '{hw}' is a {reg.get('instrument_type')} — this template is for {allowed_type} only"
                )
                continue
            # Only permit rows STRICTLY older than the most recent
            # existing reading. Ensures backfill can never overwrite or
            # even touch current/live data — only historical gaps.
            row_ts = row.get("timestamp")
            if isinstance(row_ts, datetime):
                row_ts_str = row_ts.isoformat()
            else:
                row_ts_str = str(row_ts) if row_ts else ""
            latest = latest_ts_by_hw.get(hw)
            if latest and row_ts_str and row_ts_str >= latest:
                errors.append(
                    f"Row for '{hw}' at {row_ts_str} was rejected — backfill only accepts timestamps OLDER than the latest live reading ({latest}). Current data is protected."
                )
                continue
            good_rows.append(row)
        valid_data = good_rows

    if errors and not valid_data:
        return {
            "success": False,
            "message": "Validation errors — nothing imported",
            "errors": errors,
            "error_count": len(errors),
            "inserted_count": 0,
        }

    # -------------------------------------------------------------------
    # Flowmeter-only: back-fill blank `totaliser_start_reading` on the
    # FIRST row per device (no prior in-file row) using the latest
    # historical reading's `forward_totalizer` — enforces the
    # "today's start = yesterday's end" invariant across files.
    # -------------------------------------------------------------------
    if instrument_type == "flowmeter" and valid_data:
        rows_by_hw: Dict[str, List[Dict]] = {}
        for r in valid_data:
            rows_by_hw.setdefault(r["hardware_id"], []).append(r)
        for hw, rows in rows_by_hw.items():
            rows.sort(key=lambda x: str(x.get("timestamp") or ""))
            first = rows[0]
            if first.get("initial_forward_totalizer") in (None, ""):
                first_ts = str(first.get("timestamp") or "")
                prior = await collection.find_one(
                    {"hardware_id": hw, "timestamp": {"$lt": first_ts}},
                    {"_id": 0, "forward_totalizer": 1, "final_forward_totalizer": 1, "timestamp": 1},
                    sort=[("timestamp", -1)],
                )
                if prior:
                    seed = prior.get("final_forward_totalizer")
                    if seed in (None, ""):
                        seed = prior.get("forward_totalizer")
                    if seed not in (None, ""):
                        try:
                            seed_f = round(float(seed), 4)
                            first["initial_forward_totalizer"] = seed_f
                            first["totaliser_start_reading"] = seed_f
                        except (TypeError, ValueError):
                            pass
                # Now that the head row has a start, cascade it down the
                # in-memory list so a same-file chain that started blank
                # is fully sealed.
                prev_end = first.get("final_forward_totalizer") or first.get("forward_totalizer")
                for r in rows[1:]:
                    if r.get("initial_forward_totalizer") in (None, "") and prev_end not in (None, ""):
                        try:
                            v = round(float(prev_end), 4)
                            r["initial_forward_totalizer"] = v
                            r["totaliser_start_reading"] = v
                        except (TypeError, ValueError):
                            pass
                    prev_end = r.get("final_forward_totalizer") or r.get("forward_totalizer") or prev_end

    inserted = 0
    updated = 0
    if valid_data:
        now_iso = datetime.now(timezone.utc).isoformat()
        for row in valid_data:
            row.setdefault("received_at", now_iso)
            if isinstance(row.get("timestamp"), datetime):
                row["timestamp"] = row["timestamp"].isoformat()
            row["_import_source"] = "manual_csv"
            row["_imported_by"] = admin.get("email")

        # ---------------------------------------------------------------
        # Idempotent upsert on {hardware_id, timestamp}. This is CRITICAL
        # for the "correct old data" use-case — admin can safely re-upload
        # a CSV after fixing a bad value in Excel; existing rows for the
        # same timestamp are overwritten, not duplicated.
        # ---------------------------------------------------------------
        for row in valid_data:
            hw = row.get("hardware_id")
            ts = row.get("timestamp")
            if not hw or not ts:
                continue
            filt = {"hardware_id": hw, "timestamp": ts}
            if instrument_type == "dwlr":
                filt["instrument_type"] = "dwlr"
            result = await collection.update_one(filt, {"$set": row}, upsert=True)
            if result.matched_count > 0:
                updated += 1
            else:
                inserted += 1

        # Update `latest` collection with the newest row per hardware_id
        latest_by_hw: Dict[str, Dict] = {}
        for row in valid_data:
            hw = row.get("hardware_id")
            if not hw:
                continue
            prev = latest_by_hw.get(hw)
            if not prev or row.get("timestamp", "") > prev.get("timestamp", ""):
                latest_by_hw[hw] = row
        for hw, row in latest_by_hw.items():
            row_copy = {k: v for k, v in row.items() if k != "_id"}
            filt = {"hardware_id": hw}
            if instrument_type == "dwlr":
                filt["instrument_type"] = "dwlr"
            # Only overwrite the "latest" cache if the imported row is
            # newer than what's already there — never regress the live
            # dashboard by importing an old backfill.
            existing = await latest_coll.find_one(filt, {"_id": 0, "timestamp": 1})
            if not existing or row_copy.get("timestamp", "") > (existing.get("timestamp") or ""):
                await latest_coll.update_one(filt, {"$set": row_copy}, upsert=True)

    return {
        "success": True,
        "inserted_count": inserted,
        "updated_count": updated,
        "error_count": len(errors),
        "errors": errors[:20],   # keep response light — cap at 20 samples
        "message": f"Backfilled {inserted} new historical row(s), corrected {updated} existing historical row(s)"
                   + (f" · {len(errors)} skipped (current data is protected)" if errors else ""),
    }


# ============================
# Certificates
# ============================
@router.post("/certificate/calibration")
async def generate_calibration_cert(
    instrument_id: str,
    instrument_type: str,
    serial_number: str,
    calibrated_by: str = "Envirolytics Team",
    admin: dict = Depends(require_operator),
):
    now = datetime.now(timezone.utc)
    cert_data = {
        "instrument_id": instrument_id,
        "instrument_type": instrument_type,
        "serial_number": serial_number,
        "calibration_date": now,
        "next_calibration_date": now + timedelta(days=365),
        "calibrated_by": calibrated_by,
        "certificate_number": f"CAL-{now.strftime('%Y%m%d')}-{instrument_id}",
        "parameters": {
            "Flow Rate": {"standard": "100 L/min", "measured": "99.8 L/min", "deviation": "0.2%", "status": "Pass"},
            "Accuracy": {"standard": "+/-1%", "measured": "0.2%", "deviation": "Within limits", "status": "Pass"},
            "Repeatability": {"standard": "<0.5%", "measured": "0.15%", "deviation": "Within limits", "status": "Pass"},
        },
    }
    pdf = CertificateGenerator.generate_calibration_certificate(cert_data)
    rec = dict(cert_data)
    rec["calibration_date"] = cert_data["calibration_date"].isoformat()
    rec["next_calibration_date"] = cert_data["next_calibration_date"].isoformat()
    rec["type"] = "calibration"
    await db.certificates.insert_one(rec)
    return StreamingResponse(
        io.BytesIO(pdf),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=calibration_cert_{instrument_id}.pdf"},
    )


@router.post("/certificate/installation")
async def generate_installation_cert(
    instrument_id: str,
    instrument_type: str,
    serial_number: str,
    client_name: str,
    location: str,
    installed_by: str = "Envirolytics Team",
    admin: dict = Depends(require_operator),
):
    now = datetime.now(timezone.utc)
    cert_data = {
        "instrument_id": instrument_id,
        "instrument_type": instrument_type,
        "serial_number": serial_number,
        "client_name": client_name,
        "location": location,
        "installation_date": now,
        "installed_by": installed_by,
        "certificate_number": f"INST-{now.strftime('%Y%m%d')}-{instrument_id}",
    }
    pdf = CertificateGenerator.generate_installation_certificate(cert_data)
    rec = dict(cert_data)
    rec["installation_date"] = cert_data["installation_date"].isoformat()
    rec["type"] = "installation"
    await db.certificates.insert_one(rec)
    return StreamingResponse(
        io.BytesIO(pdf),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=installation_cert_{instrument_id}.pdf"},
    )
