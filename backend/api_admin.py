"""Admin API endpoints: user management, site activation, data export, certificates."""
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime, timezone, timedelta
import io
import uuid

from models import UserRole, SiteStatus, SubscriptionType
from auth import hash_password, require_admin, get_current_user
from data_export_service import DataExportService, ExcelImportService
from certificate_service import CertificateGenerator

router = APIRouter(prefix="/api/admin", tags=["admin"])

# Global db (set from server.py)
db = None


# ============================
# Models
# ============================
class AdminCreateUserRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    role: str = "client"
    company_name: Optional[str] = None
    phone: Optional[str] = None
    location_name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class AdminUpdateUserRequest(BaseModel):
    full_name: Optional[str] = None
    company_name: Optional[str] = None
    phone: Optional[str] = None
    location_name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    role: Optional[str] = None


class ActivateSiteRequest(BaseModel):
    user_id: str
    subscription_type: SubscriptionType


# ============================
# User Management
# ============================
@router.post("/users/create")
async def create_user(req: AdminCreateUserRequest, admin: dict = Depends(require_admin)):
    email = req.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already exists")
    if len(req.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    user_doc = {
        "id": f"user_{uuid.uuid4().hex[:12]}",
        "email": email,
        "username": email.split("@")[0],
        "password_hash": hash_password(req.password),
        "full_name": req.full_name,
        "company_name": req.company_name,
        "phone": req.phone,
        "role": req.role if req.role in ("admin", "client") else "client",
        "is_active": True,
        "location_name": req.location_name,
        "latitude": req.latitude,
        "longitude": req.longitude,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": admin["id"],
    }
    await db.users.insert_one(user_doc)
    user_doc.pop("password_hash", None)
    user_doc.pop("_id", None)
    return {"success": True, "user": user_doc}


@router.get("/users/list")
async def list_users(admin: dict = Depends(require_admin)):
    cursor = db.users.find({}, {"password_hash": 0, "_id": 0})
    users = await cursor.to_list(length=500)
    return {"users": users, "count": len(users)}


@router.get("/users/locations")
async def list_locations(user: dict = Depends(get_current_user)):
    """Any authenticated user can see the location map (lat/long + name only)."""
    cursor = db.users.find(
        {"latitude": {"$ne": None}, "longitude": {"$ne": None}},
        {"_id": 0, "id": 1, "full_name": 1, "company_name": 1, "location_name": 1,
         "latitude": 1, "longitude": 1, "role": 1, "is_active": 1},
    )
    items = await cursor.to_list(length=500)
    return {"locations": items, "count": len(items)}


@router.put("/users/{user_id}/status")
async def toggle_user_status(user_id: str, is_active: bool, admin: dict = Depends(require_admin)):
    result = await db.users.update_one({"id": user_id}, {"$set": {"is_active": is_active}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"success": True, "is_active": is_active}


@router.put("/users/{user_id}")
async def update_user(user_id: str, req: AdminUpdateUserRequest, admin: dict = Depends(require_admin)):
    """Admin — update user profile (location, contact info, role)."""
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    if "role" in updates and updates["role"] not in ("admin", "client"):
        raise HTTPException(status_code=400, detail="Invalid role")
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    result = await db.users.update_one({"id": user_id}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"success": True, "updated_fields": list(updates.keys())}


@router.delete("/users/{user_id}")
async def delete_user(user_id: str, admin: dict = Depends(require_admin)):
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete self")
    result = await db.users.delete_one({"id": user_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"success": True}


# ============================
# Site Activation
# ============================
@router.post("/site/activate")
async def activate_site(req: ActivateSiteRequest, admin: dict = Depends(require_admin)):
    start = datetime.now(timezone.utc)
    days = {"monthly": 30, "quarterly": 90, "yearly": 365}[req.subscription_type.value]
    end = start + timedelta(days=days)

    doc = {
        "id": f"sub_{uuid.uuid4().hex[:12]}",
        "user_id": req.user_id,
        "subscription_type": req.subscription_type.value,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "status": SiteStatus.ACTIVE.value,
        "created_by": admin["id"],
        "created_at": start.isoformat(),
    }
    await db.site_activations.insert_one(doc)
    doc.pop("_id", None)
    return {"success": True, "activation": doc}


@router.get("/site/status/{user_id}")
async def check_site_status(user_id: str):
    activation = await db.site_activations.find_one(
        {"user_id": user_id}, sort=[("created_at", -1)]
    )
    if not activation:
        return {"status": SiteStatus.INACTIVE.value, "message": "No active subscription"}

    end_date = activation["end_date"]
    if isinstance(end_date, str):
        end_date = datetime.fromisoformat(end_date)
    now = datetime.now(timezone.utc)
    if end_date.tzinfo is None:
        end_date = end_date.replace(tzinfo=timezone.utc)

    if now > end_date:
        return {
            "status": SiteStatus.EXPIRED.value,
            "expired_on": end_date.isoformat(),
        }
    return {
        "status": SiteStatus.ACTIVE.value,
        "subscription_type": activation["subscription_type"],
        "expires_on": end_date.isoformat(),
    }


@router.get("/site/activations")
async def list_activations(admin: dict = Depends(require_admin)):
    cursor = db.site_activations.find({}, {"_id": 0}).sort("created_at", -1)
    items = await cursor.to_list(length=500)
    return {"activations": items, "count": len(items)}


# ============================
# Data Export
# ============================
@router.get("/data/export")
async def export_data(
    format: str = Query(..., regex="^(csv|pdf)$"),
    hardware_id: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    admin: dict = Depends(require_admin),
):
    query = {}
    if hardware_id:
        query["hardware_id"] = hardware_id
    if start_date or end_date:
        query["timestamp"] = {}
        if start_date:
            query["timestamp"]["$gte"] = start_date
        if end_date:
            query["timestamp"]["$lte"] = end_date

    cursor = db.flowmeter_readings.find(query).sort("timestamp", -1).limit(1000)
    readings = await cursor.to_list(length=1000)

    for r in readings:
        r.pop("_id", None)
        r.pop("raw_data", None)

    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    if format == "csv":
        csv_data = DataExportService.to_csv(readings)
        return StreamingResponse(
            io.BytesIO(csv_data),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=flowmeter_data_{today}.csv"},
        )
    else:
        pdf_data = DataExportService.to_pdf(readings, "Flowmeter Readings Report")
        return StreamingResponse(
            io.BytesIO(pdf_data),
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename=flowmeter_report_{today}.pdf"},
        )


# ============================
# Excel Import (Edit Historical Data)
# ============================
@router.post("/data/import")
async def import_data(file: UploadFile = File(...), admin: dict = Depends(require_admin)):
    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Only Excel files are supported")

    content = await file.read()
    data = ExcelImportService.parse_excel(content)
    valid_data, errors = ExcelImportService.validate_flowmeter_data(data)

    if errors and not valid_data:
        return {
            "success": False,
            "message": "Validation errors",
            "errors": errors,
            "error_count": len(errors),
        }

    if valid_data:
        now_iso = datetime.now(timezone.utc).isoformat()
        for row in valid_data:
            row.setdefault("received_at", now_iso)
            if isinstance(row.get("timestamp"), datetime):
                row["timestamp"] = row["timestamp"].isoformat()
        await db.flowmeter_readings.insert_many(valid_data)

    return {
        "success": True,
        "inserted_count": len(valid_data),
        "error_count": len(errors),
        "errors": errors[:10],
    }


# ============================
# Certificates
# ============================
@router.post("/certificate/calibration")
async def generate_calibration_cert(
    instrument_id: str,
    instrument_type: str,
    serial_number: str,
    calibrated_by: str = "Envirolytics Team",
    admin: dict = Depends(require_admin),
):
    now = datetime.now(timezone.utc)
    cert_data = {
        "instrument_id": instrument_id,
        "instrument_type": instrument_type,
        "serial_number": serial_number,
        "calibration_date": now,
        "next_calibration_date": now + timedelta(days=365),
        "calibrated_by": calibrated_by,
        "certificate_number": f"CAL-{now.strftime('%Y%m%d')}-{instrument_id}",
        "parameters": {
            "Flow Rate": {"standard": "100 L/min", "measured": "99.8 L/min", "deviation": "0.2%", "status": "Pass"},
            "Accuracy": {"standard": "+/-1%", "measured": "0.2%", "deviation": "Within limits", "status": "Pass"},
            "Repeatability": {"standard": "<0.5%", "measured": "0.15%", "deviation": "Within limits", "status": "Pass"},
        },
    }
    pdf = CertificateGenerator.generate_calibration_certificate(cert_data)
    rec = dict(cert_data)
    rec["calibration_date"] = cert_data["calibration_date"].isoformat()
    rec["next_calibration_date"] = cert_data["next_calibration_date"].isoformat()
    rec["type"] = "calibration"
    await db.certificates.insert_one(rec)
    return StreamingResponse(
        io.BytesIO(pdf),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=calibration_cert_{instrument_id}.pdf"},
    )


@router.post("/certificate/installation")
async def generate_installation_cert(
    instrument_id: str,
    instrument_type: str,
    serial_number: str,
    client_name: str,
    location: str,
    installed_by: str = "Envirolytics Team",
    admin: dict = Depends(require_admin),
):
    now = datetime.now(timezone.utc)
    cert_data = {
        "instrument_id": instrument_id,
        "instrument_type": instrument_type,
        "serial_number": serial_number,
        "client_name": client_name,
        "location": location,
        "installation_date": now,
        "installed_by": installed_by,
        "certificate_number": f"INST-{now.strftime('%Y%m%d')}-{instrument_id}",
    }
    pdf = CertificateGenerator.generate_installation_certificate(cert_data)
    rec = dict(cert_data)
    rec["installation_date"] = cert_data["installation_date"].isoformat()
    rec["type"] = "installation"
    await db.certificates.insert_one(rec)
    return StreamingResponse(
        io.BytesIO(pdf),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=installation_cert_{instrument_id}.pdf"},
    )
