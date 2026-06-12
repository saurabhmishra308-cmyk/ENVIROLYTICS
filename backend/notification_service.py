"""Email notifications for offline IoT devices.

- Admin can register up to 4 recipient emails (stored as a single Mongo doc).
- A background task scans `flowmeter_latest` + `instrument_latest` every
  OFFLINE_ALERT_INTERVAL_MIN minutes. For each device that has been silent for
  >= 2 h, we send an email (once per device, then a OFFLINE_ALERT_COOLDOWN_HOURS
  cooldown) to every configured recipient.
- Resend SDK is sync, so we wrap with `asyncio.to_thread`.
- Disabled when `RESEND_API_KEY` is empty (UI still works for managing recipients).
"""
import asyncio
import logging
import os
from datetime import datetime, timezone, timedelta
from typing import List, Optional

import resend

logger = logging.getLogger(__name__)

MAX_RECIPIENTS = 4
OFFLINE_THRESHOLD_HOURS = 2
SETTINGS_KEY = "offline_alerts"


# --------------------------------------------------------------------------- helpers
def _parse_iso(value) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not isinstance(value, str) or not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _device_key(d: dict) -> str:
    kind = d.get("kind") or d.get("instrument_type") or "device"
    return f"{kind}:{d.get('hardware_id')}"


def _resend_configured() -> bool:
    return bool(os.environ.get("RESEND_API_KEY", "").strip())


# --------------------------------------------------------------------------- recipients store
async def get_recipients(db) -> List[str]:
    doc = await db.notification_settings.find_one({"key": SETTINGS_KEY})
    return list(doc.get("emails", [])) if doc else []


async def set_recipients(db, emails: List[str]) -> List[str]:
    cleaned = []
    seen = set()
    for e in emails or []:
        if not isinstance(e, str):
            continue
        e = e.strip().lower()
        if e and e not in seen:
            cleaned.append(e)
            seen.add(e)
    if len(cleaned) > MAX_RECIPIENTS:
        raise ValueError(f"At most {MAX_RECIPIENTS} recipient emails are allowed.")
    await db.notification_settings.update_one(
        {"key": SETTINGS_KEY},
        {"$set": {"key": SETTINGS_KEY, "emails": cleaned,
                  "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return cleaned


# --------------------------------------------------------------------------- email rendering
def _device_label(d: dict) -> str:
    kind = d.get("kind", "device")
    itype = (d.get("instrument_type") or "").upper()
    hw = d.get("hardware_id", "?")
    if kind == "flowmeter":
        return f"Flowmeter · {hw}"
    return f"{itype or 'DEVICE'} · {hw}"


def _build_email_html(devices: List[dict]) -> str:
    rows = "".join(
        f"""
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #f1f1f1;font-family:Arial,sans-serif;font-size:14px;color:#1a2332;">
            {_device_label(d)}
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #f1f1f1;font-family:Arial,sans-serif;font-size:12px;color:#b91c1c;text-align:right;">
            OFFLINE
          </td>
        </tr>
        """
        for d in devices
    )
    return f"""
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8fa;padding:24px 0;">
      <tr><td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
          <tr><td style="background:#1a2332;padding:18px 24px;">
            <div style="font-family:Arial,sans-serif;color:#4a9fd8;font-weight:700;letter-spacing:1px;font-size:16px;">ENVIROLYTICS MONITOR</div>
            <div style="font-family:Arial,sans-serif;color:#cbd5e1;font-size:10px;letter-spacing:2px;">SUSTAINABILITY PRIVATE LIMITED</div>
          </td></tr>
          <tr><td style="padding:24px;">
            <div style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:2px;color:#b91c1c;font-weight:700;">TELEMETRY ALERT</div>
            <h2 style="font-family:Arial,sans-serif;font-size:20px;color:#0f172a;margin:6px 0 4px;">
              {len(devices)} device{'' if len(devices)==1 else 's'} reporting offline
            </h2>
            <p style="font-family:Arial,sans-serif;font-size:14px;color:#475569;margin:0 0 18px;">
              The following IoT device{'' if len(devices)==1 else 's'} ha{'s' if len(devices)==1 else 've'} not transmitted any data for at least {OFFLINE_THRESHOLD_HOURS} hours. Please verify the device power, connectivity and broker credentials.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #f1f1f1;border-radius:8px;overflow:hidden;">
              {rows}
            </table>
            <p style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;margin:18px 0 0;">
              Sent automatically by Envirolytics Monitor. Sign in to the dashboard for live status.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
    """


# --------------------------------------------------------------------------- send
async def _send(recipients: List[str], subject: str, html: str) -> dict:
    if not _resend_configured():
        return {"sent": False, "reason": "RESEND_API_KEY not configured"}
    if not recipients:
        return {"sent": False, "reason": "no recipients configured"}

    resend.api_key = os.environ["RESEND_API_KEY"]
    sender = os.environ.get("SENDER_EMAIL", "Envirolytics Monitor <onboarding@resend.dev>")
    params = {"from": sender, "to": recipients, "subject": subject, "html": html}
    try:
        resp = await asyncio.to_thread(resend.Emails.send, params)
        eid = resp.get("id") if isinstance(resp, dict) else None
        logger.info(f"[notify] Sent offline-alert email to {recipients} (id={eid})")
        return {"sent": True, "email_id": eid}
    except Exception as e:
        logger.error(f"[notify] Failed to send email: {e}")
        return {"sent": False, "reason": str(e)}


async def send_test_email(db) -> dict:
    recipients = await get_recipients(db)
    if not recipients:
        return {"sent": False, "reason": "no recipients configured"}
    dummy = [{"kind": "flowmeter", "instrument_type": "flowmeter", "hardware_id": "TEST_DEVICE"}]
    html = _build_email_html(dummy)
    return await _send(recipients, "Envirolytics — Test Alert", html)


# --------------------------------------------------------------------------- background scanner
async def _find_offline(db) -> List[dict]:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=OFFLINE_THRESHOLD_HOURS)
    out: List[dict] = []
    async for d in db.flowmeter_latest.find({}, {"_id": 0}):
        ls = _parse_iso(d.get("received_at")) or _parse_iso(d.get("timestamp"))
        if ls and ls < cutoff:
            out.append({"kind": "flowmeter", "instrument_type": "flowmeter",
                        "hardware_id": d.get("hardware_id"), "last_seen": ls})
    async for d in db.instrument_latest.find({}, {"_id": 0}):
        ls = _parse_iso(d.get("received_at")) or _parse_iso(d.get("timestamp"))
        if ls and ls < cutoff:
            out.append({"kind": "instrument", "instrument_type": d.get("instrument_type"),
                        "hardware_id": d.get("hardware_id"), "last_seen": ls})
    return out


async def _devices_needing_notification(db, offline: List[dict]) -> List[dict]:
    if not offline:
        return []
    cooldown_h = float(os.environ.get("OFFLINE_ALERT_COOLDOWN_HOURS", "6"))
    cooldown_cutoff = datetime.now(timezone.utc) - timedelta(hours=cooldown_h)
    needing = []
    for d in offline:
        key = _device_key(d)
        state = await db.notification_state.find_one({"device_key": key})
        last_notified = _parse_iso(state.get("last_notified_at")) if state else None
        # Notify if never notified OR cooldown elapsed
        if last_notified is None or last_notified < cooldown_cutoff:
            needing.append(d)
    return needing


async def _record_notified(db, devices: List[dict]):
    now_iso = datetime.now(timezone.utc).isoformat()
    for d in devices:
        await db.notification_state.update_one(
            {"device_key": _device_key(d)},
            {"$set": {"device_key": _device_key(d),
                      "hardware_id": d.get("hardware_id"),
                      "instrument_type": d.get("instrument_type"),
                      "last_notified_at": now_iso}},
            upsert=True,
        )


async def check_and_notify(db) -> dict:
    """Run one offline-detection + email pass. Safe to call manually."""
    recipients = await get_recipients(db)
    if not recipients:
        return {"checked": True, "skipped": "no recipients"}
    offline = await _find_offline(db)
    fresh = await _devices_needing_notification(db, offline)
    if not fresh:
        return {"checked": True, "offline_count": len(offline), "emailed": 0}
    html = _build_email_html(fresh)
    subject = f"Envirolytics Alert — {len(fresh)} device{'' if len(fresh)==1 else 's'} offline"
    result = await _send(recipients, subject, html)
    if result.get("sent"):
        await _record_notified(db, fresh)
    return {"checked": True, "offline_count": len(offline),
            "emailed": len(fresh) if result.get("sent") else 0,
            "result": result}


async def background_loop(db):
    """Endless loop — runs every OFFLINE_ALERT_INTERVAL_MIN minutes."""
    interval_min = float(os.environ.get("OFFLINE_ALERT_INTERVAL_MIN", "10"))
    sleep_s = max(60.0, interval_min * 60.0)
    logger.info(f"[notify] Background loop started (interval={interval_min} min)")
    while True:
        try:
            await asyncio.sleep(sleep_s)
            await check_and_notify(db)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error(f"[notify] background loop error: {e}")
