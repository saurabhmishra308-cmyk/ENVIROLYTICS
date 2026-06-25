"""Monthly abstract-limit feature.

Admins (and sub-users with the `limits` permission) can attach BOTH a monthly
minimum and maximum abstract limit (in KL) plus a customer notification email
to any flowmeter. A background task scans every `LIMIT_CHECK_INTERVAL_MIN`
minutes; when this month's consumption crosses the configured min or max we
email:

  - the device owner (from instrument_registry → users.email)
  - the per-limit customer_email (if different from owner)
  - every globally configured ops recipient

…all gated by a per-(hardware, month, kind) idempotency key in
`limit_alerts_state` so each breach is delivered exactly once per calendar
month.

Admin can also toggle `visible_to_client` per limit. When false the limit is
HIDDEN from the client (admin still sees it). When true the client sees the
configured min/max + their current consumption on the Limits page.

Endpoints
---------
GET    /api/limits                   (auth — scoped per-user)
POST   /api/limits                   (admin or permission=limits)
PUT    /api/limits/{hardware_id}     (admin or permission=limits)
DELETE /api/limits/{hardware_id}     (admin or permission=limits)
POST   /api/limits/check-now         (admin) — trigger one scan immediately
"""
import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

from auth import get_current_user
import api_instrument_registry

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
    min_limit_kl: float = Field(0, ge=0, description="Optional lower-bound; 0 disables under-abstraction alerts")
    customer_email: EmailStr
    is_active: bool = True
    visible_to_client: bool = False


class UpdateLimitPayload(BaseModel):
    label: Optional[str] = None
    monthly_limit_kl: Optional[float] = Field(None, ge=0)
    min_limit_kl: Optional[float] = Field(None, ge=0)
    customer_email: Optional[EmailStr] = None
    is_active: Optional[bool] = None
    visible_to_client: Optional[bool] = None


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
    max_kl = float(doc.get("monthly_limit_kl", 0))
    min_kl = float(doc.get("min_limit_kl", 0))
    return {
        "hardware_id": doc.get("hardware_id"),
        "label": doc.get("label"),
        "monthly_limit_kl": max_kl,
        "min_limit_kl": min_kl,
        "customer_email": doc.get("customer_email"),
        "is_active": doc.get("is_active", True),
        "visible_to_client": bool(doc.get("visible_to_client", False)),
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
        "consumption_kl_this_month": consumption_kl,
        "exceeded": consumption_kl > max_kl and max_kl > 0,
        "below_minimum": consumption_kl < min_kl and min_kl > 0,
    }


# --------------------------------------------------------------------------- CRUD
@router.get("")
async def list_limits(user: dict = Depends(get_current_user)):
    """List limits + current month consumption.

    - Admin: sees ALL limits.
    - Sub-user with `limits` permission: sees the limits the admin allows them to manage.
    - Client / sub-user without permission: sees only their own owned-device limits AND
      only those whose `visible_to_client` is true.
    """
    is_admin = user.get("role") == "admin"
    has_perm = bool((user.get("permissions") or {}).get("limits"))
    visible_hw: Optional[set] = None
    if not is_admin:
        visible_hw = await api_instrument_registry.visible_hardware_ids(user)

    items: List[dict] = []
    async for doc in db.flow_limits.find({}, {"_id": 0}):
        if visible_hw is not None and doc.get("hardware_id") not in visible_hw:
            continue
        # Non-admin without permission only sees activated-for-client entries
        if not is_admin and not has_perm and not doc.get("visible_to_client", False):
            continue
        cons = await _month_consumption_kl(doc["hardware_id"])
        items.append(_serialise(doc, cons))
    return {"limits": items, "count": len(items)}


@router.post("")
async def create_limit(payload: LimitPayload, user: dict = Depends(get_current_user)):
    _ensure_permission(user)
    if await db.flow_limits.find_one({"hardware_id": payload.hardware_id}):
        raise HTTPException(status_code=409, detail="A limit for this hardware already exists.")
    if payload.min_limit_kl and payload.monthly_limit_kl and payload.min_limit_kl > payload.monthly_limit_kl:
        raise HTTPException(status_code=400, detail="min_limit_kl cannot exceed monthly_limit_kl")
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "hardware_id": payload.hardware_id,
        "label": payload.label,
        "monthly_limit_kl": float(payload.monthly_limit_kl),
        "min_limit_kl": float(payload.min_limit_kl or 0),
        "customer_email": str(payload.customer_email).lower(),
        "is_active": bool(payload.is_active),
        "visible_to_client": bool(payload.visible_to_client),
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
    if payload.min_limit_kl is not None:
        update["min_limit_kl"] = float(payload.min_limit_kl)
    if payload.customer_email is not None:
        update["customer_email"] = str(payload.customer_email).lower()
    if payload.is_active is not None:
        update["is_active"] = bool(payload.is_active)
    if payload.visible_to_client is not None:
        update["visible_to_client"] = bool(payload.visible_to_client)
    # sanity
    new_max = update.get("monthly_limit_kl", existing.get("monthly_limit_kl", 0))
    new_min = update.get("min_limit_kl", existing.get("min_limit_kl", 0))
    if new_min and new_max and new_min > new_max:
        raise HTTPException(status_code=400, detail="min_limit_kl cannot exceed monthly_limit_kl")
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
    """Send a breach email if EITHER monthly max is exceeded or monthly min undershot
    (and we haven't notified for that breach kind this month yet).

    Recipients = owner_email (from instrument_registry → users) + customer_email
    (configured on the limit) + every globally configured ops recipient.
    """
    if not limit_doc.get("is_active", True):
        return {"sent": False, "reason": "inactive"}

    max_kl = float(limit_doc.get("monthly_limit_kl", 0))
    min_kl = float(limit_doc.get("min_limit_kl", 0))
    hw = limit_doc["hardware_id"]

    # Detect which breach kind (if any) applies; we send a separate notification
    # for each kind so each is independently throttled.
    breaches: List[dict] = []
    if max_kl > 0 and consumption_kl > max_kl:
        breaches.append({"kind": "exceeded", "threshold": max_kl, "color": "#b91c1c", "label_text": "ABSTRACTION LIMIT EXCEEDED",
                          "headline_suffix": "has crossed its monthly limit",
                          "body_intro": f"abstracted <strong>{consumption_kl:.2f} KL</strong> so far this month, "
                                          f"exceeding the approved monthly limit of <strong>{max_kl:.2f} KL</strong>."})
    if min_kl > 0 and consumption_kl < min_kl:
        breaches.append({"kind": "below_min", "threshold": min_kl, "color": "#92400e", "label_text": "ABSTRACTION BELOW MINIMUM",
                          "headline_suffix": "is below its monthly minimum",
                          "body_intro": f"only abstracted <strong>{consumption_kl:.2f} KL</strong> so far this month, "
                                          f"below the configured monthly minimum of <strong>{min_kl:.2f} KL</strong>."})

    if not breaches:
        return {"sent": False, "reason": "within limit"}

    import notification_service as ns  # lazy import to avoid circular

    # Resolve recipients
    owner_id, owner_email = await ns._owner_email_for(db, hw)
    customer = (limit_doc.get("customer_email") or "").strip().lower() or None
    global_ops = await ns.get_recipients(db)
    label = limit_doc.get("label") or hw
    month_key = _month_key()

    results = []
    for breach in breaches:
        # Idempotency: already-notified for this hw + month + kind?
        already = await db.limit_alerts_state.find_one(
            {"hardware_id": hw, "month": month_key, "kind": breach["kind"]}
        )
        if already:
            results.append({"kind": breach["kind"], "sent": False, "reason": "already notified this month"})
            continue

        recipients: List[str] = []
        if owner_email:
            recipients.append(owner_email)
        if customer and customer not in recipients:
            recipients.append(customer)
        for r in global_ops:
            if r and r not in recipients:
                recipients.append(r)
        if not recipients:
            results.append({"kind": breach["kind"], "sent": False, "reason": "no recipients"})
            continue

        html = f"""
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8fa;padding:24px 0;">
          <tr><td align="center">
            <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
              <tr><td style="background:#1a2332;padding:18px 24px;">
                <div style="font-family:Arial,sans-serif;color:#4a9fd8;font-weight:700;letter-spacing:1px;font-size:16px;">ENVIROLYTICS MONITOR</div>
              </td></tr>
              <tr><td style="padding:24px;font-family:Arial,sans-serif;color:#0f172a;">
                <p style="font-size:11px;letter-spacing:2px;color:{breach['color']};font-weight:700;margin:0 0 6px;">{breach['label_text']}</p>
                <h2 style="margin:0 0 10px;font-size:20px;">{label} {breach['headline_suffix']}</h2>
                <p style="font-size:14px;color:#475569;line-height:1.5;">
                  The borewell <strong>{hw}</strong> has {breach['body_intro']}
                </p>
                <p style="font-size:14px;color:#475569;line-height:1.5;">
                  Please review the abstraction pattern and take corrective action.
                </p>
                <p style="font-size:12px;color:#94a3b8;margin:18px 0 0;">
                  This is an automated message from Envirolytics Monitor.
                </p>
              </td></tr>
            </table>
          </td></tr>
        </table>
        """
        subject = f"Envirolytics — {breach['label_text'].title()} for {label}"
        result = await ns._send(recipients, subject, html)
        if result.get("sent"):
            await db.limit_alerts_state.update_one(
                {"hardware_id": hw, "month": month_key, "kind": breach["kind"]},
                {"$set": {
                    "hardware_id": hw, "month": month_key, "kind": breach["kind"],
                    "consumption_kl": consumption_kl,
                    "threshold_kl": breach["threshold"],
                    "owner_email": owner_email,
                    "customer_email": customer,
                    "recipients": recipients,
                    "notified_at": datetime.now(timezone.utc).isoformat(),
                }},
                upsert=True,
            )
        results.append({"kind": breach["kind"], **result, "recipients": recipients})

    return {"sent": any(r.get("sent") for r in results), "results": results}


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
