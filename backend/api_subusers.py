"""Sub-user management with permission scopes.

Admins can create / list / update / delete sub-users. Each sub-user gets a
boolean permission for each app section:

    dashboard      — Live dashboard (instrument grid, weather, alerts)
    reports        — Reports & data downloads
    analysis       — Data analysis charts
    certificates   — Certificates management
    audit          — Audit log

Admin users always have all permissions implicitly.
"""
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

from auth import hash_password, require_admin

router = APIRouter(prefix="/api/users", tags=["users"])

# Set from server.py
db = None


def set_db(database):
    global db
    db = database


PERMISSION_KEYS = ("dashboard", "reports", "analysis", "certificates", "audit", "limits")


def _default_permissions() -> Dict[str, bool]:
    return {k: False for k in PERMISSION_KEYS}


def _normalise_permissions(p) -> Dict[str, bool]:
    """Return a Dict[str, bool] view of the caller's permissions.

    Historically some user documents stored `permissions` as a list of
    granted keys (e.g. ``["view_water_quality"]``) while newer docs use a
    ``{key: bool}`` mapping. This helper accepts both shapes so the
    /api/users/subusers endpoint doesn't 500 when legacy rows are read.
    """
    if not p:
        return _default_permissions()
    if isinstance(p, list):
        granted = {str(k) for k in p}
        return {k: (k in granted) for k in PERMISSION_KEYS}
    if isinstance(p, dict):
        return {k: bool(p.get(k, False)) for k in PERMISSION_KEYS}
    return _default_permissions()


def _serialise_user(u: dict) -> dict:
    return {
        "id": u.get("id"),
        "email": u.get("email"),
        "full_name": u.get("full_name", ""),
        "role": u.get("role", "client"),
        "is_active": u.get("is_active", True),
        "permissions": _normalise_permissions(u.get("permissions")),
        "created_at": u.get("created_at"),
        "created_by": u.get("created_by"),
    }


class CreateSubUserRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8)
    full_name: str = Field(..., min_length=1)
    permissions: Dict[str, bool] = Field(default_factory=_default_permissions)


class UpdateSubUserRequest(BaseModel):
    full_name: Optional[str] = None
    is_active: Optional[bool] = None
    permissions: Optional[Dict[str, bool]] = None


# --------------------------------------------------------------------------- routes
@router.get("/subusers")
async def list_subusers(admin: dict = Depends(require_admin)):
    cursor = db.users.find({"role": {"$ne": "admin"}}, {"_id": 0, "password_hash": 0})
    items = [_serialise_user(u) async for u in cursor]
    items.sort(key=lambda u: u.get("created_at") or "", reverse=True)
    return {"users": items, "count": len(items)}


@router.post("/subusers")
async def create_subuser(req: CreateSubUserRequest, admin: dict = Depends(require_admin)):
    email = req.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="A user with this email already exists.")
    now_dt = datetime.now(timezone.utc)
    term_years = 1.0
    service_expiry = (now_dt + timedelta(days=term_years * 365.25)).isoformat()
    doc = {
        "id": f"user_{uuid.uuid4().hex[:12]}",
        "email": email,
        "username": email.split("@")[0],
        "password_hash": hash_password(req.password),
        "full_name": req.full_name.strip(),
        "role": "client",
        "is_active": True,
        "permissions": _normalise_permissions(req.permissions),
        "created_at": now_dt.isoformat(),
        "created_by": admin.get("id"),
        "service_term_years": term_years,
        "service_expiry_date": service_expiry,
    }
    await db.users.insert_one(doc)
    return _serialise_user(doc)


@router.put("/subusers/{user_id}")
async def update_subuser(user_id: str, req: UpdateSubUserRequest, admin: dict = Depends(require_admin)):
    existing = await db.users.find_one({"id": user_id})
    if not existing:
        raise HTTPException(status_code=404, detail="User not found")
    if existing.get("role") == "admin":
        raise HTTPException(status_code=400, detail="Cannot modify admin via sub-user endpoint")

    update: Dict = {}
    if req.full_name is not None:
        update["full_name"] = req.full_name.strip()
    if req.is_active is not None:
        update["is_active"] = bool(req.is_active)
    if req.permissions is not None:
        update["permissions"] = _normalise_permissions(req.permissions)
    if update:
        await db.users.update_one({"id": user_id}, {"$set": update})

    refreshed = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    return _serialise_user(refreshed)


@router.delete("/subusers/{user_id}")
async def delete_subuser(user_id: str, admin: dict = Depends(require_admin)):
    existing = await db.users.find_one({"id": user_id})
    if not existing:
        raise HTTPException(status_code=404, detail="User not found")
    if existing.get("role") == "admin":
        raise HTTPException(status_code=400, detail="Cannot delete admin")
    await db.users.delete_one({"id": user_id})
    return {"success": True, "id": user_id}
