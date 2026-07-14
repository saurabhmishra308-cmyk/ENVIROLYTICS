"""Admin API for offline-device email-alert recipients (max 4)."""
import os
from typing import List
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, EmailStr

from auth import require_admin, get_current_user
import notification_service as svc

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

# Set from server.py
db = None


def set_db(database):
    global db
    db = database


class RecipientsPayload(BaseModel):
    emails: List[EmailStr]


@router.get("/emails")
async def list_emails(admin: dict = Depends(require_admin)):
    emails = await svc.get_recipients(db)
    return {
        "emails": emails,
        "max": svc.MAX_RECIPIENTS,
        "provider_configured": svc._email_configured(),
    }


@router.put("/emails")
async def replace_emails(payload: RecipientsPayload, admin: dict = Depends(require_admin)):
    try:
        cleaned: List[str] = await svc.set_recipients(db, [str(e) for e in payload.emails])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"emails": cleaned, "max": svc.MAX_RECIPIENTS}


@router.post("/test")
async def send_test(admin: dict = Depends(require_admin)):
    """Always returns 200; sent:false + reason when the provider isn't configured
    or when the upstream send fails. Keeps the API contract consistent with
    /api/limits/check-now and /api/renewals/run-now."""
    return await svc.send_test_email(db)


@router.post("/run-now")
async def run_now(admin: dict = Depends(require_admin)):
    """Trigger an immediate offline-check + email pass (also called periodically in background)."""
    return await svc.check_and_notify(db)


@router.post("/test-user/{user_id}")
async def send_test_to_user(user_id: str, admin: dict = Depends(require_admin)):
    """Admin — send a one-liner test email to the target user's login email +
    their admin-configured `notification_emails`. Rate-limited per user."""
    result = await svc.send_test_email_to_user(db, user_id)
    return result


@router.post("/test-me")
async def send_test_to_me(user: dict = Depends(get_current_user)):
    """Any authenticated user — send a one-liner test email to their own
    login email + their admin-configured `notification_emails`. Rate-limited.
    Recipient list is stripped for non-admins so a client only sees the count."""
    result = await svc.send_test_email_to_user(db, user["id"])
    if user.get("role") != "admin":
        result.pop("recipients", None)
    return result
