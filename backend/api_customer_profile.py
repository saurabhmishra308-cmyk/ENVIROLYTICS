"""Customer / Client profile.

Extends the `users` collection with the compliance metadata that CGWA, SGWA,
CPCB and state pollution boards routinely ask for during audits (NOC / CTO
validity, borewell counts, rainwater harvesting details, representative
contact). Admins have full edit access; every other role can only read
their own profile.

Endpoints
---------
GET  /api/customer-profile               — current user's profile
GET  /api/customer-profile/{user_id}     — admin only; any user's profile
PUT  /api/customer-profile/{user_id}     — admin only; update fields
POST /api/customer-profile/{user_id}/logo — admin only; upload company logo (JPEG)
GET  /api/customer-profile/logo/{fname}  — serves stored logos
GET  /api/customer-profile/list          — admin only; every user + profile summary
"""
from __future__ import annotations

import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from auth import get_current_user, require_admin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/customer-profile", tags=["customer-profile"])

db = None
LOGO_DIR = os.path.join(os.path.dirname(__file__), "uploads", "logos")
os.makedirs(LOGO_DIR, exist_ok=True)

# Fields the admin can write to the users doc through this API. Any other
# field on the users record (auth data, permissions, etc.) is untouchable.
_PROFILE_FIELDS = {
    "customer_name",          # per CTO / NOC — official company name
    "site_name",              # human-friendly site name
    "unit_name",              # unit identifier when the customer has many
    "address",                # full postal address
    "representative_name",
    "representative_designation",
    "representative_email",
    "representative_phone",
    "noc_mode",               # "single" | "per_borewell" — governs how NOCs are reminded
    "noc_number",
    "noc_issue_date",
    "noc_validity_years",     # duration of validity
    "noc_expiry_date",        # explicit expiry (helps reminders)
    "cto_number",
    "cto_issue_date",
    "cto_expiry_date",
    "boreholes_permitted",    # renamed in UI to "Borewell permitted"
    "abstraction_borewells_count",
    "permitted_daily_kl",     # KLD (kilolitres per day)
    "permitted_yearly_kl",    # KL per year
    "piezometers_count",
    "rwh_structure_count",
    "rwh_catchment_area_sqm",
    "notes",
}


def set_db(database):
    global db
    db = database


class ProfileUpdate(BaseModel):
    customer_name: Optional[str] = None
    site_name: Optional[str] = None
    unit_name: Optional[str] = None
    address: Optional[str] = None
    representative_name: Optional[str] = None
    representative_designation: Optional[str] = None
    representative_email: Optional[str] = None
    representative_phone: Optional[str] = None
    noc_mode: Optional[str] = None
    noc_number: Optional[str] = None
    noc_issue_date: Optional[str] = None
    noc_validity_years: Optional[int] = Field(None, ge=0, le=50)
    noc_expiry_date: Optional[str] = None
    cto_number: Optional[str] = None
    cto_issue_date: Optional[str] = None
    cto_expiry_date: Optional[str] = None
    boreholes_permitted: Optional[int] = Field(None, ge=0)
    abstraction_borewells_count: Optional[int] = Field(None, ge=0)
    permitted_daily_kl: Optional[float] = Field(None, ge=0)
    permitted_yearly_kl: Optional[float] = Field(None, ge=0)
    piezometers_count: Optional[int] = Field(None, ge=0)
    rwh_structure_count: Optional[int] = Field(None, ge=0)
    rwh_catchment_area_sqm: Optional[float] = Field(None, ge=0)
    notes: Optional[str] = None


def _clean(v):
    if isinstance(v, str):
        return v.strip() or None
    return v


async def _profile_for_user(uid: str) -> dict:
    """Return a full profile dict for the given user id, plus the number of
    instruments they own (calculated on the fly)."""
    doc = await db.users.find_one({"id": uid}, {"_id": 0, "password_hash": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="User not found")

    installed = await db.instrument_registry.count_documents({"owner_user_id": uid})
    # Break instruments down by type so the profile page can show a nice summary.
    by_type: dict = {}
    async for reg in db.instrument_registry.find(
        {"owner_user_id": uid},
        {"_id": 0, "instrument_type": 1, "hardware_id": 1, "label": 1},
    ):
        t = (reg.get("instrument_type") or "other").lower()
        by_type.setdefault(t, []).append({
            "hardware_id": reg.get("hardware_id"),
            "label": reg.get("label"),
        })

    for k in _PROFILE_FIELDS:
        doc.setdefault(k, None)
    doc["instruments_installed_count"] = installed
    doc["instruments_by_type"] = by_type
    return doc


@router.get("")
async def my_profile(user: dict = Depends(get_current_user)):
    return await _profile_for_user(user.get("id"))


@router.get("/list")
async def list_all_profiles(admin: dict = Depends(require_admin)):
    """Compact list of every non-admin user + summary — feeds the admin
    picker on the Customer Profile page."""
    rows = []
    async for u in db.users.find({}, {"_id": 0, "password_hash": 0}):
        if u.get("role") == "admin":
            continue
        installed = await db.instrument_registry.count_documents({"owner_user_id": u.get("id")})
        rows.append({
            "id": u.get("id"),
            "email": u.get("email"),
            "full_name": u.get("full_name") or u.get("company_name"),
            "customer_name": u.get("customer_name"),
            "site_name": u.get("site_name"),
            "unit_name": u.get("unit_name"),
            "role": u.get("role"),
            "instruments_installed_count": installed,
            "noc_expiry_date": u.get("noc_expiry_date"),
            "cto_expiry_date": u.get("cto_expiry_date"),
            "logo_path": u.get("logo_path"),
        })
    rows.sort(key=lambda r: (r.get("customer_name") or r.get("full_name") or r.get("email") or ""))
    return {"users": rows, "count": len(rows)}


@router.get("/{user_id}")
async def get_profile(user_id: str, user: dict = Depends(get_current_user)):
    if user.get("role") != "admin" and user.get("id") != user_id:
        raise HTTPException(status_code=403, detail="You can only view your own profile")
    return await _profile_for_user(user_id)


@router.put("/{user_id}")
async def update_profile(user_id: str, payload: ProfileUpdate, admin: dict = Depends(require_admin)):
    doc = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="User not found")
    update = {k: _clean(v) for k, v in payload.model_dump(exclude_unset=True).items() if k in _PROFILE_FIELDS}
    if not update:
        raise HTTPException(status_code=400, detail="No profile fields provided")
    update["profile_updated_at"] = datetime.now(timezone.utc).isoformat()
    update["profile_updated_by"] = admin.get("id")
    await db.users.update_one({"id": user_id}, {"$set": update})
    return await _profile_for_user(user_id)


_LOGO_EXT = re.compile(r"^[A-Za-z0-9_.\-]+\.jpe?g$")


@router.post("/{user_id}/logo")
async def upload_logo(user_id: str, file: UploadFile = File(...), admin: dict = Depends(require_admin)):
    doc = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "logo_path": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="User not found")

    ct = (file.content_type or "").lower()
    if ct not in ("image/jpeg", "image/jpg", "image/pjpeg"):
        raise HTTPException(status_code=400, detail="Only JPEG images are accepted")

    ext = "jpg" if not (file.filename or "").lower().endswith("jpeg") else "jpeg"
    safe_name = f"{user_id}_{uuid.uuid4().hex[:12]}.{ext}"
    dest_path = os.path.join(LOGO_DIR, safe_name)
    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Logo must be ≤ 5 MB")
    with open(dest_path, "wb") as f:
        f.write(content)

    # Clean up the previous logo so we don't accumulate orphaned files.
    prev = (doc or {}).get("logo_path")
    if prev and prev != safe_name and _LOGO_EXT.match(prev):
        prev_full = os.path.join(LOGO_DIR, prev)
        if os.path.exists(prev_full):
            try:
                os.remove(prev_full)
            except OSError:
                logger.warning("Could not delete previous logo %s", prev_full)

    await db.users.update_one({"id": user_id}, {"$set": {
        "logo_path": safe_name,
        "logo_uploaded_at": datetime.now(timezone.utc).isoformat(),
        "logo_uploaded_by": admin.get("id"),
    }})
    return {"success": True, "logo_path": safe_name}


@router.get("/logo/{filename}")
async def serve_logo(filename: str, user: dict = Depends(get_current_user)):
    # Filename validation — only allow the exact pattern we store.
    if not _LOGO_EXT.match(filename):
        raise HTTPException(status_code=400, detail="Invalid logo filename")
    path = os.path.join(LOGO_DIR, filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Logo not found")

    # Only the owner or admin may fetch a logo (prevents cross-tenant browsing).
    if user.get("role") != "admin":
        owner = await db.users.find_one(
            {"logo_path": filename},
            {"_id": 0, "id": 1},
        )
        if not owner or owner.get("id") != user.get("id"):
            raise HTTPException(status_code=403, detail="Not permitted to view this logo")
    return FileResponse(path, media_type="image/jpeg")
