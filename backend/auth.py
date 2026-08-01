"""JWT authentication utilities for Envirolytics Monitor."""
import os
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict
from fastapi import HTTPException, Request, Depends

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24 hours


def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def hash_password(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
        "type": "access",
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> Optional[Dict]:
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            return None
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


# Global db reference (set from server.py)
db = None


def set_db(database):
    global db
    db = database


def _extract_token(request: Request) -> Optional[str]:
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:]
    return request.cookies.get("access_token")


async def get_current_user(request: Request) -> Dict:
    token = _extract_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = await db.users.find_one({"id": payload["sub"]})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    user.pop("password_hash", None)
    user.pop("_id", None)
    # Normalise permissions so the frontend always sees a complete map.
    perms = user.get("permissions") or {}
    # Handle both dict and list formats for permissions
    if isinstance(perms, list):
        # Convert list to dict (e.g., ["view_water_quality"] -> {"view_water_quality": True})
        perms_dict = {k: True for k in perms}
    else:
        perms_dict = perms
    # Create normalized permissions dict with standard permissions
    normalized_perms = {
        k: bool(perms_dict.get(k, False))
        for k in ("dashboard", "reports", "analysis", "certificates", "audit", "limits")
    }
    # Preserve any additional permissions (like view_water_quality)
    for k, v in perms_dict.items():
        if k not in normalized_perms:
            normalized_perms[k] = bool(v)
    user["permissions"] = normalized_perms
    # View Access dialog (new source of truth) — expose the client's stored
    # view_permissions map on the user object so per-page gates can honor
    # what the admin toggled in the View Access dialog. Missing keys are
    # deliberately left absent; downstream code defaults missing = visible.
    user["view_permissions"] = user.get("view_permissions") or {}
    # Admins implicitly have everything.
    if user.get("role") == "admin":
        user["permissions"] = {k: True for k in user["permissions"]}
    return user


async def require_admin(request: Request) -> Dict:
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


async def require_operator(request: Request) -> Dict:
    """Admin OR staff. Staff have full read/write on clients and devices
    but the 'admin' account is shielded (invisible) from them at every
    endpoint. Enforced individually per handler that operates on users."""
    user = await get_current_user(request)
    if user.get("role") not in ("admin", "staff"):
        raise HTTPException(status_code=403, detail="Operator access required")
    return user
