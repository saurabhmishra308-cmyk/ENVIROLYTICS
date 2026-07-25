"""Compliance reminder emails.

Runs periodically (roughly every 6 h) and, for every customer profile:
  * NOC expiry — 3 months before and 1 month before the `noc_expiry_date`.
  * NOC self-compliance — every 11 months from the `noc_issue_date`
    (India CGWA requires an annual self-compliance return; we prompt a
    month in advance so the customer has time to file).
  * CTO expiry — 2 months before the `cto_expiry_date`.

Every recipient (currently the profile's `representative_email`) receives
each reminder at most once per calendar window; sent state is persisted in
`compliance_reminder_state` so the loop is idempotent across restarts.
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone, timedelta
from typing import List, Optional

from notification_service import _send

logger = logging.getLogger(__name__)

# One tick every 6 h — reminders fire at most 4× per day in aggregate; each
# individual recipient/window pair is de-duplicated by the `_state_key`
# marker so restart-safe.
TICK_SECONDS = int(os.getenv("COMPLIANCE_TICK_SECONDS", str(6 * 60 * 60)))


def _parse_date(value) -> Optional[datetime]:
    if not value:
        return None
    try:
        # Accept both `2027-04-15` and full ISO datetimes.
        s = str(value)
        if len(s) == 10:
            return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def _fmt(d: datetime) -> str:
    return d.strftime("%d %b %Y")


def _wrap_html(title: str, body_html: str, cta_line: str) -> str:
    return f"""
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; max-width: 620px; margin: auto;">
      <h2 style="color: #0b3d91; margin-bottom: 4px;">{title}</h2>
      <p style="color: #555; margin-top: 0;">Envirolytics Compliance Assistant</p>
      <div style="border-top: 3px solid #0b3d91; margin: 12px 0 20px;"></div>
      {body_html}
      <p style="margin-top: 24px; color: #444;">{cta_line}</p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin-top: 32px;" />
      <p style="font-size: 11px; color: #9ca3af;">
        This is an automated compliance reminder from Envirolytics Monitor.
        If you have already renewed / filed, please update the Customer
        Profile page so future reminders reflect the correct dates.
      </p>
    </div>
    """


async def _already_sent(db, key: str) -> bool:
    doc = await db.compliance_reminder_state.find_one({"key": key})
    return bool(doc)


async def _mark_sent(db, key: str, meta: dict):
    await db.compliance_reminder_state.update_one(
        {"key": key},
        {"$set": {**meta, "key": key, "sent_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )


def _customer_label(profile: dict) -> str:
    return (
        profile.get("customer_name")
        or profile.get("full_name")
        or profile.get("email")
        or "Customer"
    )


def _window_key(user_id: str, kind: str, date_iso: str) -> str:
    """Idempotency key — one reminder per (user, kind, target-date, window)."""
    return f"{user_id}:{kind}:{date_iso}"


async def _tick(db) -> dict:
    """Single pass over every user with a profile. Returns a small summary."""
    now = datetime.now(timezone.utc)
    stats = {"noc_3m": 0, "noc_1m": 0, "cto_2m": 0, "self_compliance": 0, "skipped_no_rep": 0}

    async for u in db.users.find({}, {"_id": 0, "password_hash": 0}):
        rep = (u.get("representative_email") or "").strip()
        if not rep:
            stats["skipped_no_rep"] += 1
            continue
        uid = u.get("id")
        label = _customer_label(u)

        noc_exp = _parse_date(u.get("noc_expiry_date"))
        cto_exp = _parse_date(u.get("cto_expiry_date"))
        noc_issue = _parse_date(u.get("noc_issue_date"))

        # Build the list of NOC expiries to check. In `single` mode the
        # profile carries one top-level expiry; in `per_borewell` mode
        # each borewell has its own {borewell_name, noc_number, expiry_date}.
        noc_checks = []
        mode = (u.get("noc_mode") or "single").lower()
        if mode == "per_borewell" and isinstance(u.get("borewell_nocs"), list):
            for row in u["borewell_nocs"]:
                if not isinstance(row, dict):
                    continue
                exp = _parse_date(row.get("expiry_date"))
                if exp:
                    noc_checks.append({
                        "expiry": exp,
                        "noc_number": row.get("noc_number") or "—",
                        "borewell": row.get("borewell_name") or row.get("borewell_id") or "",
                        "issue": _parse_date(row.get("issue_date")),
                    })
        elif noc_exp:
            noc_checks.append({
                "expiry": noc_exp,
                "noc_number": u.get("noc_number") or "—",
                "borewell": "",
                "issue": noc_issue,
            })

        # ---- NOC 3-month + 1-month reminders (per-borewell aware) --------
        for chk in noc_checks:
            exp = chk["expiry"]
            noc_num = chk["noc_number"]
            bw_label = f" (Borewell: {chk['borewell']})" if chk["borewell"] else ""
            three_month = exp - timedelta(days=90)
            one_month   = exp - timedelta(days=30)
            key_suffix = chk["borewell"] or "single"

            if three_month <= now <= exp - timedelta(days=30):
                key = _window_key(uid, f"noc_3m:{key_suffix}", exp.date().isoformat())
                if not await _already_sent(db, key):
                    html = _wrap_html(
                        title="Groundwater NOC — expiring in ~3 months",
                        body_html=(
                            f"<p>Dear {u.get('representative_name') or 'Representative'},</p>"
                            f"<p><strong>{label}</strong>'s Groundwater NOC "
                            f"(No. <strong>{noc_num}</strong>){bw_label} expires on "
                            f"<strong>{_fmt(exp)}</strong>.</p>"
                            f"<p>Please initiate the renewal application with the local groundwater authority to avoid a lapse.</p>"
                        ),
                        cta_line="Reply to this email if you need any documents from us in support of the renewal.",
                    )
                    res = await _send([rep], f"[Envirolytics] NOC expiring in ~3 months — {label}{bw_label}", html)
                    if res.get("sent"):
                        await _mark_sent(db, key, {"user_id": uid, "recipient": rep, "kind": "noc_3m", "expiry": exp.isoformat(), "borewell": chk["borewell"]})
                        stats["noc_3m"] += 1

            if one_month <= now <= exp:
                key = _window_key(uid, f"noc_1m:{key_suffix}", exp.date().isoformat())
                if not await _already_sent(db, key):
                    html = _wrap_html(
                        title="Groundwater NOC — expiring in ~1 month",
                        body_html=(
                            f"<p>Dear {u.get('representative_name') or 'Representative'},</p>"
                            f"<p><strong>Urgent:</strong> {label}'s Groundwater NOC "
                            f"(No. <strong>{noc_num}</strong>){bw_label} expires on "
                            f"<strong>{_fmt(exp)}</strong> — less than 30 days away.</p>"
                            f"<p>If the renewal is not yet in progress, please initiate it immediately to avoid enforcement action.</p>"
                        ),
                        cta_line="If the renewal is already filed, please update the Customer Profile with the new expiry date.",
                    )
                    res = await _send([rep], f"[Envirolytics] URGENT: NOC expires in ~30 days — {label}{bw_label}", html)
                    if res.get("sent"):
                        await _mark_sent(db, key, {"user_id": uid, "recipient": rep, "kind": "noc_1m", "expiry": exp.isoformat(), "borewell": chk["borewell"]})
                        stats["noc_1m"] += 1


        # ---- CTO 2-month reminder ---------------------------------------
        if cto_exp:
            two_month = cto_exp - timedelta(days=60)
            if two_month <= now <= cto_exp:
                key = _window_key(uid, "cto_2m", cto_exp.date().isoformat())
                if not await _already_sent(db, key):
                    html = _wrap_html(
                        title="Consent to Operate (CTO) — expiring in ~2 months",
                        body_html=(
                            f"<p>Dear {u.get('representative_name') or 'Representative'},</p>"
                            f"<p><strong>{label}</strong>'s CTO "
                            f"(No. <strong>{u.get('cto_number') or '—'}</strong>) expires on "
                            f"<strong>{_fmt(cto_exp)}</strong>.</p>"
                            f"<p>Please initiate the CTO renewal with the State Pollution Control Board well in advance.</p>"
                        ),
                        cta_line="Update the Customer Profile once the new CTO is issued so we can track it.",
                    )
                    res = await _send([rep], f"[Envirolytics] CTO expiring in ~2 months — {label}", html)
                    if res.get("sent"):
                        await _mark_sent(db, key, {"user_id": uid, "recipient": rep, "kind": "cto_2m", "expiry": cto_exp.isoformat()})
                        stats["cto_2m"] += 1

        # ---- NOC self-compliance (every 11 months from NOC issue) -------
        if noc_issue:
            # Find the next 11-month anniversary that falls within the next
            # 30 days — that's our reminder window. We use ISO date-only
            # keys so we don't double-fire for the same year.
            months = 11
            next_target = noc_issue
            # Walk forward in 11-month blocks until we're within 30 days of
            # the current time.
            while next_target < now - timedelta(days=1):
                # rough month arithmetic — enough for reminders
                next_target = next_target + timedelta(days=30 * months)
            reminder_window_start = next_target - timedelta(days=30)
            if reminder_window_start <= now <= next_target:
                key = _window_key(uid, "self_compliance", next_target.date().isoformat())
                if not await _already_sent(db, key):
                    html = _wrap_html(
                        title="Self-compliance return due next month",
                        body_html=(
                            f"<p>Dear {u.get('representative_name') or 'Representative'},</p>"
                            f"<p>The annual self-compliance return for <strong>{label}</strong>'s "
                            f"Groundwater NOC (No. <strong>{u.get('noc_number') or '—'}</strong>) is due around "
                            f"<strong>{_fmt(next_target)}</strong> (11 months from the NOC validity start).</p>"
                            f"<p>Please prepare and submit the return to the concerned authority.</p>"
                        ),
                        cta_line="Reach out if you need consumption reports exported from Envirolytics to attach with the return.",
                    )
                    res = await _send([rep], f"[Envirolytics] Self-compliance return due — {label}", html)
                    if res.get("sent"):
                        await _mark_sent(db, key, {"user_id": uid, "recipient": rep, "kind": "self_compliance", "target": next_target.isoformat()})
                        stats["self_compliance"] += 1

    return stats


async def compliance_reminder_loop(db) -> None:
    """Long-running task — start once from server.py at boot."""
    logger.info("[compliance] reminder loop started, tick=%ss", TICK_SECONDS)
    while True:
        try:
            summary = await _tick(db)
            if any(v for k, v in summary.items() if k != "skipped_no_rep"):
                logger.info("[compliance] tick summary: %s", summary)
        except Exception as e:  # noqa: BLE001
            logger.exception("[compliance] tick failed: %s", e)
        await asyncio.sleep(TICK_SECONDS)


async def compliance_status(db) -> dict:
    """Small admin snapshot — used for a debug endpoint if we want one."""
    total = await db.users.count_documents({})
    sent = await db.compliance_reminder_state.count_documents({})
    return {"users": total, "reminders_sent_ever": sent, "tick_seconds": TICK_SECONDS}
