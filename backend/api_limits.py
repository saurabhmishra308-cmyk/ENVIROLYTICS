"""Monthly abstract-limit feature.

Admins (and sub-users with the `limits` permission) can attach a monthly
abstract limit (in KL) plus a customer notification email to any flowmeter.
A background task scans every `LIMIT_CHECK_INTERVAL_MIN` minutes; when this
month's consumption crosses the limit we email the customer once per
month-per-device (idempotent via `limit_alerts_state`).

Endpoints
---------
GET  /api/limits                         (auth)
POST /api/limits                         (admin or permission=limits)
PUT  /api/limits/{hardware_id}           (admin or permission=limits)
DELETE /api/limits/{hardware_id}         (admin or permission=limits)
POST /api/limits/check-now               (admin) — trigger one scan immediately
"""
import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

from auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/limits", tags=["limits"])

# Set from server.py
db = None


def set_db(database):
    global db
    db = database


def _ensure_permission(user: dict):
    """Allow admin OR sub-user whose `permissions.limits` is True."""
    if user.get("role") == "admin":
        return
    perms = user.get("permissions") or {}
    if not perms.get("limits"):
        raise HTTPException(status_code=403, detail="You don't have permission to manage flow limits.")


# --------------------------------------------------------------------------- models
class LimitPayload(BaseModel):
    hardware_id: str = Field(..., min_length=1)
    label: Optional[str] = None
    monthly_limit_kl: float = Field(..., ge=0)
    customer_email: EmailStr
    is_active: bool = True


class UpdateLimitPayload(BaseModel):
    label: Optional[str] = None
    monthly_limit_kl: Optional[float] = Field(None, ge=0)
    customer_email: Optional[EmailStr] = None
    is_active: Optional[bool] = None


# --------------------------------------------------------------------------- helpers
def _month_start(now: Optional[datetime] = None) -> datetime:
    n = now or datetime.now(timezone.utc)
    return n.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


async def _month_consumption_kl(hardware_id: str) -> float:
    """Forward-totaliser delta between the first reading of the month and the latest."""
    start = _month_start().isoformat()
    first = await db.flowmeter_readings.find_one(
        {"hardware_id": hardware_id, "timestamp": {"$gte": start}},
        sort=[("timestamp", 1)],
    )
    last = await db.flowmeter_latest.find_one({"hardware_id": hardware_id})
    if not first or not last:
        return 0.0
    delta_l = max(0.0, float(last.get("forward_totalizer", 0)) - float(first.get("forward_totalizer", 0)))
    return round(delta_l / 1000.0, 3)


def _serialise(doc: dict, consumption_kl: float = 0.0) -> dict:
    return {
        "hardware_id": doc.get("hardware_id"),
        "label": doc.get("label"),
        "monthly_limit_kl": float(doc.get("monthly_limit_kl", 0)),
        "customer_email": doc.get("customer_email"),
        "is_active": doc.get("is_active", True),
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
        "consumption_kl_this_month": consumption_kl,
        "exceeded": consumption_kl > float(doc.get("monthly_limit_kl", 0)) and float(doc.get("monthly_limit_kl", 0)) > 0,
    }


# --------------------------------------------------------------------------- CRUD
@router.get("")
async def list_limits(user: dict = Depends(get_current_user)):
    """List all limits + current month consumption. Read-only for any logged-in user."""
    items: List[dict] = []
    async for doc in db.flow_limits.find({}, {"_id": 0}):
        cons = await _month_consumption_kl(doc["hardware_id"])
        items.append(_serialise(doc, cons))
    return {"limits": items, "count": len(items)}


@router.post("")
async def create_limit(payload: LimitPayload, user: dict = Depends(get_current_user)):
    _ensure_permission(user)
    if await db.flow_limits.find_one({"hardware_id": payload.hardware_id}):
        raise HTTPException(status_code=409, detail="A limit for this hardware already exists.")
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "hardware_id": payload.hardware_id,
        "label": payload.label,
        "monthly_limit_kl": float(payload.monthly_limit_kl),
        "customer_email": str(payload.customer_email).lower(),
        "is_active": bool(payload.is_active),
        "created_at": now,
        "updated_at": now,
        "created_by": user.get("id"),
    }
    await db.flow_limits.insert_one(doc)
    doc.pop("_id", None)
    cons = await _month_consumption_kl(payload.hardware_id)
    return _serialise(doc, cons)


@router.put("/{hardware_id}")
async def update_limit(hardware_id: str, payload: UpdateLimitPayload, user: dict = Depends(get_current_user)):
    _ensure_permission(user)
    existing = await db.flow_limits.find_one({"hardware_id": hardware_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Limit not found")
    update = {}
    if payload.label is not None:
        update["label"] = payload.label
    if payload.monthly_limit_kl is not None:
        update["monthly_limit_kl"] = float(payload.monthly_limit_kl)
    if payload.customer_email is not None:
        update["customer_email"] = str(payload.customer_email).lower()
    if payload.is_active is not None:
        update["is_active"] = bool(payload.is_active)
    if update:
        update["updated_at"] = datetime.now(timezone.utc).isoformat()
        await db.flow_limits.update_one({"hardware_id": hardware_id}, {"$set": update})
    refreshed = await db.flow_limits.find_one({"hardware_id": hardware_id}, {"_id": 0})
    cons = await _month_consumption_kl(hardware_id)
    return _serialise(refreshed, cons)


@router.delete("/{hardware_id}")
async def delete_limit(hardware_id: str, user: dict = Depends(get_current_user)):
    _ensure_permission(user)
    res = await db.flow_limits.delete_one({"hardware_id": hardware_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Limit not found")
    return {"success": True, "hardware_id": hardware_id}


# --------------------------------------------------------------------------- background scanner
def _month_key(now: Optional[datetime] = None) -> str:
    n = now or datetime.now(timezone.utc)
    return n.strftime("%Y-%m")


async def _maybe_notify(limit_doc: dict, consumption_kl: float) -> dict:
    """If the device exceeded its limit AND we haven't emailed for this month yet,
    send the email and mark notified. Imports notification_service lazily to avoid
    a circular import."""
    if not limit_doc.get("is_active", True):
        return {"sent": False, "reason": "inactive"}
    limit = float(limit_doc.get("monthly_limit_kl", 0))
    if limit <= 0 or consumption_kl <= limit:
        return {"sent": False, "reason": "within limit"}

    month_key = _month_key()
    hw = limit_doc["hardware_id"]
    already = await db.limit_alerts_state.find_one({"hardware_id": hw, "month": month_key})
    if already:
        return {"sent": False, "reason": "already notified this month"}

    customer = limit_doc.get("customer_email")
    if not customer:
        return {"sent": False, "reason": "no customer email"}

    import notification_service as ns  # lazy import
    label = limit_doc.get("label") or hw
    html = f"""
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8fa;padding:24px 0;">
      <tr><td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
          <tr><td style="background:#1a2332;padding:18px 24px;">
            <div style="font-family:Arial,sans-serif;color:#4a9fd8;font-weight:700;letter-spacing:1px;font-size:16px;">ENVIROLYTICS MONITOR</div>
          </td></tr>
          <tr><td style="padding:24px;font-family:Arial,sans-serif;color:#0f172a;">
            <p style="font-size:11px;letter-spacing:2px;color:#b91c1c;font-weight:700;margin:0 0 6px;">ABSTRACTION LIMIT EXCEEDED</p>
            <h2 style="margin:0 0 10px;font-size:20px;">{label} has crossed its monthly limit</h2>
            <p style="font-size:14px;color:#475569;line-height:1.5;">
              The borewell <strong>{hw}</strong> has abstracted
              <strong>{consumption_kl:.2f} KL</strong> so far this month, exceeding the
              approved monthly limit of <strong>{limit:.2f} KL</strong>.
            </p>
            <p style="font-size:14px;color:#475569;line-height:1.5;">
              Please reduce abstraction immediately or raise a fresh permit. Continued
              over-abstraction may attract penalties under the CGWA / SPCB framework.
            </p>
            <p style="font-size:12px;color:#94a3b8;margin:18px 0 0;">
              This is an automated message from Envirolytics Monitor.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
    """
    subject = f"Envirolytics — Abstraction limit exceeded for {label}"
    result = await ns._send([customer], subject, html)
    if result.get("sent"):
        await db.limit_alerts_state.update_one(
            {"hardware_id": hw, "month": month_key},
            {"$set": {
                "hardware_id": hw, "month": month_key,
                "consumption_kl": consumption_kl,
                "limit_kl": limit,
                "customer_email": customer,
                "notified_at": datetime.now(timezone.utc).isoformat(),
            }},
            upsert=True,
        )
    return result


async def check_all_limits():
    """One scan pass. Safe to call manually."""
    out = {"checked": 0, "sent": 0}
    async for d in db.flow_limits.find({"is_active": True}, {"_id": 0}):
        out["checked"] += 1
        cons = await _month_consumption_kl(d["hardware_id"])
        r = await _maybe_notify(d, cons)
        if r.get("sent"):
            out["sent"] += 1
    return out


@router.post("/check-now")
async def check_now(user: dict = Depends(get_current_user)):
    _ensure_permission(user)
    return await check_all_limits()


async def background_loop():
    interval_min = float(os.environ.get("LIMIT_CHECK_INTERVAL_MIN", "60"))
    sleep_s = max(60.0, interval_min * 60.0)
    logger.info(f"[limits] background loop started (interval={interval_min} min)")
    while True:
        try:
            await asyncio.sleep(sleep_s)
            await check_all_limits()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error(f"[limits] background loop error: {e}")
