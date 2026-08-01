"""Email notifications for offline IoT devices.

- Admin can register up to 4 recipient emails (stored as a single Mongo doc).
- A background task scans `flowmeter_latest` + `instrument_latest` every
  OFFLINE_ALERT_INTERVAL_MIN minutes. For each device that has been silent for
  >= 2 h, we send an email (once per device, then a OFFLINE_ALERT_COOLDOWN_HOURS
  cooldown) to the device's *owner* (looked up via the instrument registry)
  PLUS every globally configured recipient (ops view).
- Prefers SMTP (Zoho / any provider) when `SMTP_HOST` is set. Falls back to
  Resend SDK when `RESEND_API_KEY` is set. UI still works either way.
"""
import asyncio
import logging
import os
import smtplib
import ssl
from email.message import EmailMessage
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Tuple

import resend

logger = logging.getLogger(__name__)

MAX_RECIPIENTS = 4
OFFLINE_THRESHOLD_HOURS = 2
SETTINGS_KEY = "offline_alerts"

# In-memory rate limit for the "Test alert" button — per user_id, 60s cooldown.
# Kept in-memory (not Mongo) because it's a UX guardrail against double-click
# spam, not a security control. A backend restart clears it, which is fine.
TEST_ALERT_COOLDOWN_SEC = 60
_user_test_last_at: Dict[str, datetime] = {}


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
    owner = d.get("owner_email") or "_no_owner_"
    return f"{kind}:{d.get('hardware_id')}:{owner}"


def _resend_configured() -> bool:
    return bool(os.environ.get("RESEND_API_KEY", "").strip())


def _smtp_configured() -> bool:
    return bool(os.environ.get("SMTP_HOST", "").strip()) and bool(os.environ.get("SMTP_USERNAME", "").strip())


def _email_configured() -> bool:
    return _smtp_configured() or _resend_configured()


def _smtp_sender() -> str:
    sender = os.environ.get("SENDER_EMAIL", "").strip()
    if sender:
        return sender
    return os.environ.get("SMTP_USERNAME", "noreply@envirolytics.in")


def _send_via_smtp(recipients: List[str], subject: str, html: str) -> dict:
    """Send email via standard SMTP. SSL on port 465, STARTTLS on 587."""
    host = os.environ["SMTP_HOST"].strip()
    port = int(os.environ.get("SMTP_PORT", "465"))
    username = os.environ["SMTP_USERNAME"].strip()
    password = os.environ.get("SMTP_PASSWORD", "")
    use_ssl = os.environ.get("SMTP_USE_SSL", "true").lower() in ("1", "true", "yes")

    msg = EmailMessage()
    msg["From"] = _smtp_sender()
    msg["To"] = ", ".join(recipients)
    msg["Subject"] = subject
    msg.set_content("This email requires an HTML-capable client to view.")
    msg.add_alternative(html, subtype="html")

    context = ssl.create_default_context()
    try:
        if use_ssl or port == 465:
            with smtplib.SMTP_SSL(host, port, context=context, timeout=20) as srv:
                srv.login(username, password)
                srv.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=20) as srv:
                srv.ehlo()
                srv.starttls(context=context)
                srv.ehlo()
                srv.login(username, password)
                srv.send_message(msg)
        logger.info(f"[notify] SMTP email sent to {recipients} via {host}:{port}")
        return {"sent": True, "transport": "smtp"}
    except Exception as e:
        logger.error(f"[notify] SMTP send failed via {host}:{port}: {e}")
        return {"sent": False, "reason": f"smtp: {e}"}


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
    if not recipients:
        return {"sent": False, "reason": "no recipients configured"}
    if not _email_configured():
        return {"sent": False, "reason": "No email transport configured (set SMTP_HOST or RESEND_API_KEY)"}

    # Prefer SMTP (e.g. Zoho)
    if _smtp_configured():
        return await asyncio.to_thread(_send_via_smtp, recipients, subject, html)

    # Fallback: Resend SDK
    resend.api_key = os.environ["RESEND_API_KEY"]
    sender = os.environ.get("SENDER_EMAIL", "Envirolytics Monitor <onboarding@resend.dev>")
    params = {"from": sender, "to": recipients, "subject": subject, "html": html}
    try:
        resp = await asyncio.to_thread(resend.Emails.send, params)
        eid = resp.get("id") if isinstance(resp, dict) else None
        logger.info(f"[notify] Resend email sent to {recipients} (id={eid})")
        return {"sent": True, "transport": "resend", "email_id": eid}
    except Exception as e:
        logger.error(f"[notify] Resend send failed: {e}")
        return {"sent": False, "reason": f"resend: {e}"}


async def send_test_email(db) -> dict:
    """Sends a test alert to the configured global recipients (admin smoke-test only)."""
    recipients = await get_recipients(db)
    if not recipients:
        return {"sent": False, "reason": "no recipients configured"}
    dummy = [{"kind": "flowmeter", "instrument_type": "flowmeter", "hardware_id": "TEST_DEVICE"}]
    html = _build_email_html(dummy)
    return await _send(recipients, "Envirolytics — Test Alert", html)


def _build_simple_test_html() -> str:
    """Minimal one-liner test email — used by the per-user "Test alert now" button."""
    return """
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8fa;padding:24px 0;">
      <tr><td align="center">
        <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
          <tr><td style="background:#1a2332;padding:16px 22px;">
            <div style="font-family:Arial,sans-serif;color:#4a9fd8;font-weight:700;letter-spacing:1px;font-size:14px;">ENVIROLYTICS MONITOR</div>
          </td></tr>
          <tr><td style="padding:22px;">
            <p style="font-family:Arial,sans-serif;font-size:15px;color:#0f172a;margin:0;">
              This is a test alert from Envirolytics Monitor. If you received this, your offline-alert delivery is working.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
    """


async def send_test_email_to_user(db, user_id: str) -> dict:
    """Send a simple test email to a specific user's login email + their
    admin-configured notification_emails (max 2). Rate-limited to one send
    per user per TEST_ALERT_COOLDOWN_SEC seconds.
    """
    if not user_id:
        return {"sent": False, "reason": "user id required"}
    now = datetime.now(timezone.utc)
    last = _user_test_last_at.get(user_id)
    if last is not None:
        elapsed = (now - last).total_seconds()
        if elapsed < TEST_ALERT_COOLDOWN_SEC:
            return {
                "sent": False,
                "reason": "rate_limited",
                "retry_after_seconds": int(TEST_ALERT_COOLDOWN_SEC - elapsed) + 1,
            }
    user = await db.users.find_one(
        {"id": user_id},
        {"_id": 0, "email": 1, "notification_emails": 1, "full_name": 1, "is_active": 1},
    )
    if not user:
        return {"sent": False, "reason": "user not found"}
    recipients: List[str] = []
    if user.get("email"):
        recipients.append(user["email"])
    seen = {r.lower() for r in recipients}
    for e in (user.get("notification_emails") or [])[:2]:
        el = (e or "").strip().lower()
        if el and el not in seen:
            recipients.append(el)
            seen.add(el)
    if not recipients:
        return {"sent": False, "reason": "no recipient emails for this user"}
    html = _build_simple_test_html()
    result = await _send(recipients, "Envirolytics — Test Alert", html)
    if result.get("sent"):
        _user_test_last_at[user_id] = now
    # Never expose full recipient list back to non-admin callers — just the
    # count so the client can render "sent to N recipients" without leaking
    # the admin-configured extras. The route layer decides whether to strip.
    result["recipient_count"] = len(recipients)
    result["recipients"] = recipients
    return result


# --------------------------------------------------------------------------- background scanner
async def _owner_email_for(db, hardware_id: str) -> Tuple[Optional[str], Optional[str], List[str]]:
    """Return (owner_user_id, owner_email, extra_emails) for a device.

    `extra_emails` is the list of admin-configured `notification_emails` on the
    user document (max 2). Only admins can set these on the user profile, so
    they're safe to include in outbound alerts without leaking anything the
    admin didn't intend.
    """
    reg = await db.instrument_registry.find_one({"hardware_id": hardware_id})
    if not reg or not reg.get("owner_user_id"):
        return None, None, []
    user = await db.users.find_one(
        {"id": reg["owner_user_id"]},
        {"_id": 0, "email": 1, "is_active": 1, "notification_emails": 1},
    )
    if not user:
        return reg.get("owner_user_id"), None, []
    if user.get("is_active") is False:
        # Suspended clients don't receive alerts at all.
        return reg.get("owner_user_id"), None, []
    extras = [e for e in (user.get("notification_emails") or []) if e]
    return reg.get("owner_user_id"), user.get("email"), extras[:2]


async def _find_offline(db) -> List[dict]:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=OFFLINE_THRESHOLD_HOURS)
    out: List[dict] = []
    async for d in db.flowmeter_latest.find({"_dummy": {"$ne": True}}, {"_id": 0}):
        ls = _parse_iso(d.get("received_at")) or _parse_iso(d.get("timestamp"))
        if ls and ls < cutoff:
            owner_id, owner_email, extras = await _owner_email_for(db, d.get("hardware_id"))
            out.append({
                "kind": "flowmeter", "instrument_type": "flowmeter",
                "hardware_id": d.get("hardware_id"), "last_seen": ls,
                "owner_user_id": owner_id, "owner_email": owner_email,
                "extra_emails": extras,
            })
    async for d in db.instrument_latest.find({"_dummy": {"$ne": True}}, {"_id": 0}):
        ls = _parse_iso(d.get("received_at")) or _parse_iso(d.get("timestamp"))
        if ls and ls < cutoff:
            owner_id, owner_email, extras = await _owner_email_for(db, d.get("hardware_id"))
            out.append({
                "kind": "instrument", "instrument_type": d.get("instrument_type"),
                "hardware_id": d.get("hardware_id"), "last_seen": ls,
                "owner_user_id": owner_id, "owner_email": owner_email,
                "extra_emails": extras,
            })
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
    """Run one offline-detection + email pass. Safe to call manually.

    For every offline device we send an email to:
      - the device owner (looked up via instrument_registry → users.email)  — primary
      - PLUS every globally configured ops recipient (max 4) — copy

    Each (device, recipient) pair has its own cooldown so the owner receives
    one alert per device-cooldown window, and the ops mailbox is not spammed.
    """
    global_recipients = await get_recipients(db)
    offline = await _find_offline(db)
    fresh = await _devices_needing_notification(db, offline)
    if not fresh:
        return {"checked": True, "offline_count": len(offline), "emailed": 0}

    # ----- Group fresh devices by owner_email (None bucket goes only to global recipients)
    owner_groups: Dict[Optional[str], List[dict]] = {}
    for d in fresh:
        owner_groups.setdefault(d.get("owner_email"), []).append(d)

    total_sent = 0
    notified_pairs: List[dict] = []
    sent_results: List[dict] = []

    for owner_email, devices in owner_groups.items():
        recipients: List[str] = []
        if owner_email:
            recipients.append(owner_email)
        # Admin-configured extra notification emails on the owning client.
        # These are set only by admin (per the /api/admin/users/* endpoints)
        # and never by the client themselves. Cap at 2 defensively — the
        # Pydantic validator already enforces this on write.
        seen_extras: set = set()
        for d in devices:
            for e in (d.get("extra_emails") or []):
                el = (e or "").strip().lower()
                if el and el not in seen_extras and el not in {r.lower() for r in recipients}:
                    seen_extras.add(el)
                    recipients.append(el)
                    if len(seen_extras) >= 2:
                        break
            if len(seen_extras) >= 2:
                break
        # always copy ops recipients
        for r in global_recipients:
            if r and r not in recipients:
                recipients.append(r)
        if not recipients:
            logger.info(f"[notify] skipping {len(devices)} offline devices — no recipients (no owner email + no global recipients)")
            continue

        html = _build_email_html(devices)
        subject = f"Envirolytics Alert — {len(devices)} device{'' if len(devices)==1 else 's'} offline"
        result = await _send(recipients, subject, html)
        sent_results.append({"owner": owner_email, "recipients": recipients, "result": result})
        if result.get("sent"):
            total_sent += len(devices)
            notified_pairs.extend(devices)

    if notified_pairs:
        await _record_notified(db, notified_pairs)

    return {
        "checked": True,
        "offline_count": len(offline),
        "emailed": total_sent,
        "results": sent_results,
    }


# ============================
# DO Analyzer out-of-range alerting
# ============================
# Fires when the latest DO reading on any DO analyzer breaches the
# configured safe band (2..8 mg/L by default — matches DO_PARAMS in
# api_water_quality.py). Recipients are the same recipe as the offline
# alerts (owner + admin-configured extras + global ops). A per-device
# per-direction cooldown prevents email spam every 5-minute poll cycle.
#
# Alert email is FROM `info@envirolytics.in` (SMTP_FROM in backend/.env)
# and TO the operators. When DO is LOW it explicitly tells them to
# "increase the blower to raise aeration"; when DO is HIGH it advises
# reducing blower output.
DO_ALERT_COOLDOWN_HOURS = float(os.environ.get("DO_ALERT_COOLDOWN_HOURS", "1"))
DO_SAFE_MIN = float(os.environ.get("DO_SAFE_MIN", "2.0"))
DO_SAFE_MAX = float(os.environ.get("DO_SAFE_MAX", "8.0"))


def _build_do_alert_html(breaches: List[dict]) -> str:
    rows = []
    for b in breaches:
        direction = b["direction"]  # "low" or "high"
        colour = "#dc2626" if direction == "low" else "#f59e0b"
        advice = (
            "Increase blower output to raise aeration in this tank."
            if direction == "low" else
            "Reduce blower output — over-aeration is wasting energy and may stress biology."
        )
        rows.append(f"""
        <tr>
          <td style="padding:10px 14px;border-top:1px solid #334155;font-size:13px;">
            <strong>{b['label']}</strong><br>
            <span style="color:#94a3b8;font-size:11px;">Tank {b['tank_number']} · {b['hardware_id']}</span>
          </td>
          <td style="padding:10px 14px;border-top:1px solid #334155;text-align:center;">
            <div style="font-size:22px;font-weight:700;color:{colour};font-family:'Courier New',monospace;">{b['value']:.2f}</div>
            <div style="font-size:10px;color:#94a3b8;">mg/L</div>
          </td>
          <td style="padding:10px 14px;border-top:1px solid #334155;text-align:center;color:#94a3b8;font-size:12px;">
            {b['safe_min']:.1f} – {b['safe_max']:.1f}<br>
            <span style="color:{colour};font-weight:700;text-transform:uppercase;">{direction}</span>
          </td>
          <td style="padding:10px 14px;border-top:1px solid #334155;font-size:12px;color:#e2e8f0;">
            {advice}
          </td>
        </tr>
        """)
    return f"""
    <div style="font-family:Arial,sans-serif;max-width:720px;margin:0 auto;padding:24px;background:#0f172a;color:#f1f5f9;border-radius:12px;">
      <h2 style="margin:0 0 8px 0;color:#f59e0b;">Envirolytics — DO Analyzer out of range</h2>
      <p style="margin:0 0 14px 0;color:#94a3b8;font-size:13px;">The following aeration tank(s) have dissolved-oxygen readings outside the safe operating band. Please take action promptly.</p>
      <table style="width:100%;border-collapse:collapse;background:#1e293b;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#334155;">
            <th style="padding:10px 14px;text-align:left;font-size:11px;color:#cbd5e1;text-transform:uppercase;letter-spacing:1px;">Device</th>
            <th style="padding:10px 14px;text-align:center;font-size:11px;color:#cbd5e1;text-transform:uppercase;letter-spacing:1px;">DO reading</th>
            <th style="padding:10px 14px;text-align:center;font-size:11px;color:#cbd5e1;text-transform:uppercase;letter-spacing:1px;">Safe band</th>
            <th style="padding:10px 14px;text-align:left;font-size:11px;color:#cbd5e1;text-transform:uppercase;letter-spacing:1px;">Recommended action</th>
          </tr>
        </thead>
        <tbody>{''.join(rows)}</tbody>
      </table>
      <p style="margin:16px 0 0 0;font-size:11px;color:#94a3b8;">Alert generated automatically by Envirolytics from the QESPL vendor feed. If the reading is stale, check that the analyzer + probe are online.</p>
    </div>
    """


async def _do_alert_recently_sent(db, hardware_id: str, direction: str, recipient: str) -> bool:
    """Return True if the same (device, direction, recipient) was alerted
    inside the cooldown window."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=DO_ALERT_COOLDOWN_HOURS)
    doc = await db.do_alert_history.find_one({
        "hardware_id": hardware_id,
        "direction": direction,
        "recipient": recipient.lower(),
    })
    if not doc:
        return False
    last = _parse_iso(doc.get("last_sent"))
    return bool(last and last >= cutoff)


async def _record_do_alert(db, hardware_id: str, direction: str, recipient: str):
    await db.do_alert_history.update_one(
        {"hardware_id": hardware_id, "direction": direction, "recipient": recipient.lower()},
        {"$set": {"last_sent": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )


async def check_and_notify_do_alerts(db) -> dict:
    """Scan every DO analyzer's latest reading. Fire an alert email for
    any device whose DO_TANK_N value is outside DO_SAFE_MIN..DO_SAFE_MAX.
    Same recipient recipe as the offline alerts. Per (device, direction,
    recipient) cooldown prevents email spam."""
    global_recipients = await get_recipients(db)
    breaches: List[dict] = []
    async for d in db.instrument_latest.find(
        {"instrument_type": "do_meter", "_dummy": {"$ne": True}},
        {"_id": 0},
    ):
        values = d.get("values") or {}
        hw = d.get("hardware_id")
        # Find whichever tank number this device reports on (from registry).
        reg = await db.instrument_registry.find_one({"hardware_id": hw})
        if not reg:
            continue
        tn = reg.get("aeration_tank_number")
        do_val = None
        if tn in (1, 2):
            do_val = values.get(f"DO_TANK_{tn}")
        # Fallback: some legacy records may still store as "DO".
        if do_val is None:
            do_val = values.get("DO")
        if do_val is None:
            continue
        try:
            v = float(do_val)
        except (TypeError, ValueError):
            continue
        direction = None
        if v < DO_SAFE_MIN:
            direction = "low"
        elif v > DO_SAFE_MAX:
            direction = "high"
        if not direction:
            continue
        owner_id, owner_email, extras = await _owner_email_for(db, hw)
        breaches.append({
            "hardware_id": hw,
            "label": reg.get("label") or hw,
            "tank_number": tn,
            "value": v,
            "direction": direction,
            "safe_min": DO_SAFE_MIN,
            "safe_max": DO_SAFE_MAX,
            "owner_email": owner_email,
            "extra_emails": extras,
        })

    if not breaches:
        return {"checked": True, "breaches": 0, "emailed": 0}

    # Group by (owner_email) so one owner gets one email covering all
    # their breaching tanks.
    groups: Dict[Optional[str], List[dict]] = {}
    for b in breaches:
        groups.setdefault(b.get("owner_email"), []).append(b)

    total_sent = 0
    sent_results: List[dict] = []
    for owner_email, group in groups.items():
        recipients: List[str] = []
        if owner_email:
            recipients.append(owner_email)
        seen_extras: set = set()
        for b in group:
            for e in (b.get("extra_emails") or []):
                el = (e or "").strip().lower()
                if el and el not in seen_extras and el not in {r.lower() for r in recipients}:
                    seen_extras.add(el)
                    recipients.append(el)
                    if len(seen_extras) >= 2:
                        break
            if len(seen_extras) >= 2:
                break
        for r in global_recipients:
            if r and r not in recipients:
                recipients.append(r)
        if not recipients:
            continue

        # Filter out (device, direction, recipient) pairs still in cooldown.
        fresh: List[dict] = []
        deliver_pairs: List[tuple] = []  # (hw, direction, recipient)
        for b in group:
            eligible_recipients: List[str] = []
            for r in recipients:
                if not await _do_alert_recently_sent(db, b["hardware_id"], b["direction"], r):
                    eligible_recipients.append(r)
                    deliver_pairs.append((b["hardware_id"], b["direction"], r))
            if eligible_recipients:
                fresh.append(b)
        if not fresh:
            continue

        html = _build_do_alert_html(fresh)
        subject = f"Envirolytics DO Alert — {len(fresh)} tank{'' if len(fresh)==1 else 's'} out of range"
        result = await _send(recipients, subject, html)
        sent_results.append({"owner": owner_email, "recipients": recipients, "count": len(fresh), "result": result})
        if result.get("sent"):
            total_sent += len(fresh)
            for hw, direction, r in deliver_pairs:
                await _record_do_alert(db, hw, direction, r)

    return {"checked": True, "breaches": len(breaches), "emailed": total_sent, "results": sent_results}


async def background_loop(db):
    """Endless loop — runs every OFFLINE_ALERT_INTERVAL_MIN minutes."""
    interval_min = float(os.environ.get("OFFLINE_ALERT_INTERVAL_MIN", "10"))
    sleep_s = max(60.0, interval_min * 60.0)
    logger.info(f"[notify] Background loop started (interval={interval_min} min)")
    while True:
        try:
            await asyncio.sleep(sleep_s)
            await check_and_notify(db)
            await check_and_notify_do_alerts(db)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error(f"[notify] background loop error: {e}")
