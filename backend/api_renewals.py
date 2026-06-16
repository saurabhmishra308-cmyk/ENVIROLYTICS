"""Service-expiry renewal reminders.

Each user has a `service_term_years` (default 1) and either an explicit
`service_expiry_date` OR we compute it from `created_at + service_term_years`.

A background task runs daily; for every user whose expiry is within the
reminder window (default 60 days), we email them once per window via Resend.
We track per-user state in the `renewal_reminders_state` collection so the
same user is not re-emailed for the same window.
"""
import asyncio
import logging
import os
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import require_admin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/renewals", tags=["renewals"])

# Set from server.py
db = None


def set_db(database):
    global db
    db = database


DEFAULT_TERM_YEARS = float(os.environ.get("SERVICE_TERM_YEARS_DEFAULT", "1"))
DEFAULT_REMINDER_DAYS = int(os.environ.get("RENEWAL_REMINDER_DAYS", "60"))


# --------------------------------------------------------------------------- helpers
def _parse_iso(value) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str) and value:
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


def _expiry_for(user: dict) -> Optional[datetime]:
    """Use explicit service_expiry_date if set; else created_at + service_term_years."""
    explicit = _parse_iso(user.get("service_expiry_date"))
    if explicit:
        return explicit
    created = _parse_iso(user.get("created_at"))
    if not created:
        return None
    term_y = float(user.get("service_term_years", DEFAULT_TERM_YEARS))
    return created + timedelta(days=term_y * 365.25)


def _summary(user: dict) -> dict:
    exp = _expiry_for(user)
    now = datetime.now(timezone.utc)
    days_left = (exp - now).days if exp else None
    return {
        "id": user.get("id"),
        "email": user.get("email"),
        "full_name": user.get("full_name", ""),
        "role": user.get("role", "client"),
        "created_at": user.get("created_at"),
        "service_term_years": float(user.get("service_term_years", DEFAULT_TERM_YEARS)),
        "service_expiry_date": exp.isoformat() if exp else None,
        "days_until_expiry": days_left,
        "status": (
            "expired"   if days_left is not None and days_left < 0 else
            "expiring"  if days_left is not None and days_left <= DEFAULT_REMINDER_DAYS else
            "active"
        ) if days_left is not None else "unknown",
    }


# --------------------------------------------------------------------------- models
class UpdateExpiryPayload(BaseModel):
    service_expiry_date: Optional[str] = Field(None, description="ISO date (YYYY-MM-DD) or full ISO datetime")
    service_term_years: Optional[float] = Field(None, ge=0.1, le=10)


# --------------------------------------------------------------------------- routes
@router.get("")
async def list_renewals(admin: dict = Depends(require_admin)):
    """Renewal status for every user. Admin-only."""
    items = []
    async for u in db.users.find({}, {"_id": 0, "password_hash": 0}):
        items.append(_summary(u))
    items.sort(key=lambda x: (x.get("days_until_expiry") if x.get("days_until_expiry") is not None else 99999))
    return {"users": items, "count": len(items), "reminder_window_days": DEFAULT_REMINDER_DAYS}


@router.put("/{user_id}")
async def update_renewal(user_id: str, payload: UpdateExpiryPayload, admin: dict = Depends(require_admin)):
    existing = await db.users.find_one({"id": user_id})
    if not existing:
        raise HTTPException(status_code=404, detail="User not found")
    update = {}
    if payload.service_expiry_date is not None:
        parsed = _parse_iso(payload.service_expiry_date) or _parse_iso(payload.service_expiry_date + "T00:00:00+00:00")
        if not parsed:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD or ISO 8601.")
        update["service_expiry_date"] = parsed.isoformat()
    if payload.service_term_years is not None:
        update["service_term_years"] = float(payload.service_term_years)
    if update:
        await db.users.update_one({"id": user_id}, {"$set": update})
    refreshed = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    # Clear any prior reminder-sent marker so the new window can re-fire.
    await db.renewal_reminders_state.delete_many({"user_id": user_id})
    return _summary(refreshed)


@router.post("/run-now")
async def run_now(admin: dict = Depends(require_admin)):
    """Trigger one immediate scan + email pass."""
    return await scan_and_remind()


# --------------------------------------------------------------------------- mailer
async def _send_reminder(user: dict, exp: datetime, days_left: int) -> dict:
    import notification_service as ns  # lazy import
    customer = user.get("email")
    if not customer:
        return {"sent": False, "reason": "no email"}
    full_name = user.get("full_name") or "Customer"
    expiry_str = exp.strftime("%d %B %Y")
    html = f"""
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8fa;padding:24px 0;">
      <tr><td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
          <tr><td style="background:#1a2332;padding:18px 24px;">
            <div style="font-family:Arial,sans-serif;color:#4a9fd8;font-weight:700;letter-spacing:1px;font-size:16px;">ENVIROLYTICS MONITOR</div>
          </td></tr>
          <tr><td style="padding:24px;font-family:Arial,sans-serif;color:#0f172a;">
            <p style="font-size:11px;letter-spacing:2px;color:#f59e0b;font-weight:700;margin:0 0 6px;">RENEWAL REMINDER</p>
            <h2 style="margin:0 0 10px;font-size:20px;">Hello {full_name},</h2>
            <p style="font-size:14px;color:#475569;line-height:1.5;">
              Your Envirolytics Monitor online data-hosting subscription is scheduled to
              expire on <strong>{expiry_str}</strong> ({days_left} days from today).
            </p>
            <p style="font-size:14px;color:#475569;line-height:1.5;">
              To avoid interruption of dashboards, certificate access and IoT data ingestion,
              please reach out to your account manager or reply to this email to initiate renewal.
            </p>
            <p style="font-size:12px;color:#94a3b8;margin:18px 0 0;">
              You are receiving this automatic reminder because your subscription is within
              the {DEFAULT_REMINDER_DAYS}-day renewal window.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
    """
    subject = f"Action required: Envirolytics subscription renewal due {expiry_str}"
    return await ns._send([customer], subject, html)


async def scan_and_remind() -> dict:
    """Scan all users; for each in the reminder window, send + record."""
    now = datetime.now(timezone.utc)
    out = {"checked": 0, "due": 0, "sent": 0}
    async for u in db.users.find({"is_active": True}, {"_id": 0}):
        out["checked"] += 1
        exp = _expiry_for(u)
        if not exp:
            continue
        days_left = (exp - now).days
        if days_left < 0 or days_left > DEFAULT_REMINDER_DAYS:
            continue
        out["due"] += 1
        # Idempotency: send at most one reminder per expiry-date+user
        marker = exp.isoformat()
        already = await db.renewal_reminders_state.find_one(
            {"user_id": u.get("id"), "expiry": marker},
        )
        if already:
            continue
        result = await _send_reminder(u, exp, days_left)
        if result.get("sent"):
            await db.renewal_reminders_state.update_one(
                {"user_id": u.get("id"), "expiry": marker},
                {"$set": {
                    "user_id": u.get("id"),
                    "email": u.get("email"),
                    "expiry": marker,
                    "notified_at": now.isoformat(),
                    "days_left_when_notified": days_left,
                }},
                upsert=True,
            )
            out["sent"] += 1
    return out


async def background_loop():
    """Daily-ish scan (every RENEWAL_SCAN_INTERVAL_HOURS hours, default 24)."""
    interval_h = float(os.environ.get("RENEWAL_SCAN_INTERVAL_HOURS", "24"))
    sleep_s = max(3600.0, interval_h * 3600.0)
    logger.info(f"[renewals] background loop started (interval={interval_h}h)")
    while True:
        try:
            await asyncio.sleep(sleep_s)
            await scan_and_remind()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error(f"[renewals] background loop error: {e}")
