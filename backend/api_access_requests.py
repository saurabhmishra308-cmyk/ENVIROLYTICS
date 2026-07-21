"""Access-request endpoint.

Any authenticated client can POST /api/access-requests with the instrument
type they need. Backend sends an email to the configured admin recipient
(default: saurabh@envirolytics.in — override via env `ACCESS_REQUEST_ADMIN`).

Uses the same _send() transport as notification_service so it inherits SMTP /
Resend fallback logic.
"""
import os
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import get_current_user
import notification_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/access-requests", tags=["access-requests"])

ADMIN_EMAIL = os.getenv("ACCESS_REQUEST_ADMIN", "saurabh@envirolytics.in")

# Wired from server.py
db = None


def set_db(database):
    global db
    db = database


class AccessRequestPayload(BaseModel):
    instrument_type: str = Field(..., min_length=1, max_length=64)
    message: Optional[str] = Field(None, max_length=1000)
    hardware_id_hint: Optional[str] = Field(None, max_length=64)


@router.post("")
async def create_access_request(payload: AccessRequestPayload, user: dict = Depends(get_current_user)):
    """Client-side "Request access" — logs to DB + emails admin."""
    doc = {
        "requester_user_id": user.get("id"),
        "requester_email": user.get("email"),
        "requester_name": user.get("full_name"),
        "instrument_type": payload.instrument_type.strip().lower(),
        "message": (payload.message or "").strip() or None,
        "hardware_id_hint": (payload.hardware_id_hint or "").strip() or None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "status": "open",
    }
    await db.access_requests.insert_one(dict(doc))

    subject = f"Envirolytics — Access request for {doc['instrument_type']} from {doc['requester_email']}"
    html = f"""
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8fa;padding:24px 0;">
      <tr><td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
          <tr><td style="background:#1a2332;padding:18px 24px;">
            <div style="font-family:Arial,sans-serif;color:#4a9fd8;font-weight:700;letter-spacing:1px;font-size:16px;">ENVIROLYTICS MONITOR</div>
          </td></tr>
          <tr><td style="padding:24px;font-family:Arial,sans-serif;color:#0f172a;">
            <p style="font-size:11px;letter-spacing:2px;color:#4a9fd8;font-weight:700;margin:0 0 6px;">CLIENT ACCESS REQUEST</p>
            <h2 style="margin:0 0 10px;font-size:20px;">{doc['requester_name'] or doc['requester_email']} is requesting access</h2>
            <p style="font-size:14px;color:#475569;line-height:1.5;">
              They want to enable the <strong>{doc['instrument_type']}</strong> tile on their dashboard.
              Consider registering an instrument for them via User Management → Add Instrument.
            </p>
            <table cellpadding="6" cellspacing="0" style="font-size:13px;color:#334155;margin-top:12px;border-collapse:collapse;">
              <tr><td style="color:#64748b;">Requester</td><td>{doc['requester_email']}</td></tr>
              <tr><td style="color:#64748b;">Instrument type</td><td><strong>{doc['instrument_type']}</strong></td></tr>
              {"<tr><td style='color:#64748b;'>Preferred hardware id</td><td>" + doc['hardware_id_hint'] + "</td></tr>" if doc['hardware_id_hint'] else ""}
              {"<tr><td style='color:#64748b;'>Message</td><td>" + doc['message'] + "</td></tr>" if doc['message'] else ""}
              <tr><td style="color:#64748b;">Received</td><td>{doc['created_at']}</td></tr>
            </table>
          </td></tr>
        </table>
      </td></tr>
    </table>
    """
    try:
        result = await notification_service._send([ADMIN_EMAIL], subject, html)
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[access-request] Email failed (non-fatal): {e}")
        result = {"sent": False, "error": str(e)}
    return {"success": True, "logged": True, "email_result": result, "admin": ADMIN_EMAIL}


@router.get("")
async def list_access_requests(user: dict = Depends(get_current_user)):
    """Admin lists all requests. Client sees only their own."""
    query = {} if user.get("role") == "admin" else {"requester_user_id": user.get("id")}
    cursor = db.access_requests.find(query, {"_id": 0}).sort("created_at", -1).limit(500)
    items = await cursor.to_list(length=500)
    return {"count": len(items), "requests": items}
