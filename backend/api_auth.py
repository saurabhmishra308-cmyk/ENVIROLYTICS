"""Authentication API endpoints + admin seed."""
import os
import uuid
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel, EmailStr
from typing import Optional
from auth import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user,
    require_admin,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Global db reference (set from server.py)
db = None


def set_db(database):
    global db
    db = database


# ============================
# Models
# ============================
class LoginRequest(BaseModel):
    # Accepts either an email address or a username. Kept as `email` for
    # backward-compatibility with the existing frontend / test suites that
    # already POST `{email, password}`.
    email: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class AdminChangeUserPasswordRequest(BaseModel):
    user_id: str
    new_password: str


# ============================
# Brute force protection
# ============================
MAX_FAILED_ATTEMPTS = 5
LOCKOUT_MINUTES = 15


def _get_client_ip(request: Request) -> str:
    """Resolve real client IP behind k8s/cloudflare proxies."""
    # Cloudflare passes the real IP in cf-connecting-ip
    cf_ip = request.headers.get("cf-connecting-ip")
    if cf_ip:
        return cf_ip.strip()
    # Standard reverse-proxy header (left-most IP is the original client)
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def _is_locked_out(identifier: str) -> bool:
    record = await db.login_attempts.find_one({"identifier": identifier})
    if not record:
        return False
    if record.get("count", 0) < MAX_FAILED_ATTEMPTS:
        return False
    last = record.get("last_attempt")
    if isinstance(last, str):
        last = datetime.fromisoformat(last)
    if last and (datetime.now(timezone.utc) - last) < timedelta(minutes=LOCKOUT_MINUTES):
        return True
    # Lockout expired -- clear it
    await db.login_attempts.delete_one({"identifier": identifier})
    return False


async def _record_failed(identifier: str):
    now = datetime.now(timezone.utc).isoformat()
    await db.login_attempts.update_one(
        {"identifier": identifier},
        {"$inc": {"count": 1}, "$set": {"last_attempt": now}},
        upsert=True,
    )


async def _clear_attempts(identifier: str):
    await db.login_attempts.delete_one({"identifier": identifier})


# ============================
# Endpoints
# ============================
@router.post("/login")
async def login(req: LoginRequest, request: Request):
    identifier_raw = (req.email or "").strip()
    # Emails are case-insensitive; usernames are case-sensitive (they're
    # user-picked, and admins may set both `Bob` and `bob` as distinct
    # accounts if they wish).
    email_lc = identifier_raw.lower()
    client_ip = _get_client_ip(request)
    identifier = f"{client_ip}:{email_lc}"
    email_only_id = f"email:{email_lc}"

    if await _is_locked_out(identifier) or await _is_locked_out(email_only_id):
        raise HTTPException(
            status_code=429,
            detail=f"Too many failed attempts. Try again in {LOCKOUT_MINUTES} minutes.",
        )

    # Match on email (case-insensitive) OR username (case-sensitive).
    # Login via internal user_id is intentionally NOT supported — clients
    # log in with their email or the username admin shares with them.
    user = await db.users.find_one({
        "$or": [
            {"email": email_lc},
            {"username": identifier_raw},
        ],
    })
    if not user or not verify_password(req.password, user.get("password_hash", "")):
        await _record_failed(identifier)
        await _record_failed(email_only_id)
        raise HTTPException(status_code=401, detail="Invalid username/email or password")

    if not user.get("is_active", True):
        raise HTTPException(status_code=403, detail="Account is deactivated")

    await _clear_attempts(identifier)
    await _clear_attempts(email_only_id)

    token = create_access_token(
        user_id=user["id"], email=user["email"], role=user.get("role", "client")
    )
    perms = user.get("permissions") or {}
    # Handle both dict and list formats for permissions
    if isinstance(perms, list):
        # Convert list to dict (e.g., ["view_water_quality"] -> {"view_water_quality": True})
        perms_dict = {k: True for k in perms}
    else:
        perms_dict = perms
    permissions = {
        k: bool(perms_dict.get(k, False))
        for k in ("dashboard", "reports", "analysis", "certificates", "audit", "limits")
    }
    if user.get("role") == "admin":
        permissions = {k: True for k in permissions}
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user["id"],
            "email": user["email"],
            "username": user.get("username"),
            "full_name": user.get("full_name", ""),
            "role": user.get("role", "client"),
            "permissions": permissions,
        },
    }


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return user


@router.get("/me/view-permissions")
async def my_view_permissions(user: dict = Depends(get_current_user)):
    """Effective view-permissions for the current user. Admins get every key
    set to True; clients get their stored map (with True defaults for
    keys they have never been explicitly toggled on)."""
    from api_admin import VIEW_PERMISSION_KEYS  # local import to avoid cycles
    if user.get("role") == "admin":
        return {"role": "admin", "permissions": {k: True for k in VIEW_PERMISSION_KEYS}}
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0, "view_permissions": 1}) or {}
    stored = fresh.get("view_permissions") or {}
    perms = {k: bool(stored.get(k, True)) for k in VIEW_PERMISSION_KEYS}
    return {"role": user.get("role", "client"), "permissions": perms}


@router.post("/logout")
async def logout(user: dict = Depends(get_current_user)):
    # For Bearer token approach, logout is client-side (drop token)
    return {"success": True, "message": "Logged out"}


@router.post("/change-password")
async def change_password(
    req: ChangePasswordRequest, user: dict = Depends(get_current_user)
):
    """User can change their own password if they know the current one."""
    db_user = await db.users.find_one({"id": user["id"]})
    if not db_user or not verify_password(req.current_password, db_user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    if len(req.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"password_hash": hash_password(req.new_password)}},
    )
    return {"success": True, "message": "Password updated"}


@router.post("/admin/change-user-password")
async def admin_change_user_password(
    req: AdminChangeUserPasswordRequest, admin: dict = Depends(require_admin)
):
    """Admin-only: change any user's password without knowing the old one."""
    if len(req.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    result = await db.users.update_one(
        {"id": req.user_id},
        {"$set": {"password_hash": hash_password(req.new_password)}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"success": True, "message": "Password reset by admin"}


# ============================
# Hidden admin recovery (undocumented endpoint)
# ============================
# If the admin password ever gets changed and forgotten, POST to this hidden
# endpoint with the secret recovery token from backend/.env to reset the
# admin's password back to the value stored in ADMIN_PASSWORD.
#   curl -X POST $URL/api/auth/_recover-admin \
#     -H "X-Recovery-Token: <ADMIN_RECOVERY_TOKEN>"
# The endpoint is intentionally NOT listed in the frontend and returns 404
# to callers who don't present the correct token, so it doesn't leak its
# own existence. Rate-limited via the existing brute-force lockout table.
@router.post("/_recover-admin", include_in_schema=False)
async def _recover_admin(request: Request):
    client_ip = _get_client_ip(request)
    identifier = f"recover:{client_ip}"
    if await _is_locked_out(identifier):
        # Same 404 the endpoint returns on wrong token — never confirm existence.
        raise HTTPException(status_code=404, detail="Not Found")

    expected = os.environ.get("ADMIN_RECOVERY_TOKEN", "").strip()
    provided = (request.headers.get("x-recovery-token") or "").strip()
    if not expected or not provided or provided != expected:
        await _record_failed(identifier)
        raise HTTPException(status_code=404, detail="Not Found")

    admin_email = os.environ.get("ADMIN_EMAIL", "admin@envirolytics.com").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "Admin@Envirolytics2026")
    result = await db.users.update_one(
        {"email": admin_email},
        {"$set": {
            "password_hash": hash_password(admin_password),
            "role": "admin",
            "is_active": True,
        }},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not Found")
    await _clear_attempts(identifier)
    return {"success": True, "message": "Admin credentials restored from .env"}


# ============================
# Seed admin (idempotent)
# ============================
async def seed_admin(database):
    """Create default admin if missing, sync password if .env changed."""
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@envirolytics.com").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "Admin@Envirolytics2026")
    admin_name = os.environ.get("ADMIN_NAME", "Envirolytics Admin")

    existing = await database.users.find_one({"email": admin_email})
    lucknow_loc = {"location_name": "Lucknow HQ", "latitude": 26.8467, "longitude": 80.9462}
    if existing is None:
        doc = {
            "id": f"user_{uuid.uuid4().hex[:12]}",
            "email": admin_email,
            "username": admin_email.split("@")[0],
            "password_hash": hash_password(admin_password),
            "full_name": admin_name,
            "role": "admin",
            "is_active": True,
            **lucknow_loc,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await database.users.insert_one(doc)
        print(f"[seed] Admin user created: {admin_email}")
    else:
        # Sync password if changed
        if not verify_password(admin_password, existing.get("password_hash", "")):
            await database.users.update_one(
                {"email": admin_email},
                {"$set": {"password_hash": hash_password(admin_password), "role": "admin", "is_active": True}},
            )
            print(f"[seed] Admin password resynced from .env: {admin_email}")
        else:
            print(f"[seed] Admin user exists: {admin_email}")
        # Backfill location if missing
        if existing.get("latitude") is None or existing.get("longitude") is None:
            await database.users.update_one({"email": admin_email}, {"$set": lucknow_loc})
            print("[seed] Admin location backfilled (Lucknow)")

    # Indexes
    try:
        await database.users.create_index("email", unique=True)
        await database.users.create_index("id", unique=True)
        # `username` is now the client-facing login handle (in addition to
        # email). Unique-sparse so legacy accounts without a username don't
        # collide until we backfill them below.
        await database.users.create_index("username", unique=True, sparse=True)
        await database.login_attempts.create_index("identifier")
    except Exception as e:
        print(f"[seed] Index creation warning: {e}")

    # Backfill: every existing account needs a username so admin can share
    # it with clients. Default = local-part of the email (`alice@x.com` →
    # `alice`) with a numeric suffix on conflict.
    async for u in database.users.find({"username": {"$in": [None, ""]}}, {"id": 1, "email": 1, "_id": 0}):
        base = (u.get("email") or u.get("id") or "user").split("@")[0].strip() or "user"
        candidate = base
        n = 1
        while await database.users.find_one({"username": candidate, "id": {"$ne": u["id"]}}):
            n += 1
            candidate = f"{base}{n}"
        await database.users.update_one({"id": u["id"]}, {"$set": {"username": candidate}})
        print(f"[seed] Backfilled username '{candidate}' for {u.get('email')}")
