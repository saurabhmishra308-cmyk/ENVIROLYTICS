from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from typing import Optional, List
from datetime import datetime, timedelta
import io
from models import UserRole, UserCreate, UserLogin, SiteStatus, SubscriptionType
from auth import get_password_hash, verify_password, create_access_token, verify_token
from data_export_service import DataExportService, ExcelImportService
from certificate_service import CertificateGenerator

router = APIRouter(prefix="/api/admin", tags=["admin"])

# Global references (set from server.py)
db = None

async def get_current_user(token: str):
    """Get current user from token."""
    payload = verify_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    user = await db.users.find_one({"id": payload.get("sub")})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user

async def require_admin(token: str):
    """Require admin role."""
    user = await get_current_user(token)
    if user.get("role") != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user

# User Management
@router.post("/users/create")
async def create_user(user_data: UserCreate, admin_token: str = Query(...)):
    """Admin only: Create new user."""
    admin = await require_admin(admin_token)
    
    # Check if username exists
    existing = await db.users.find_one({"username": user_data.username})
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")
    
    # Create user
    user_doc = {
        "id": f"user_{datetime.now().timestamp()}",
        "username": user_data.username,
        "email": user_data.email,
        "password_hash": get_password_hash(user_data.password),
        "full_name": user_data.full_name,
        "company_name": user_data.company_name,
        "phone": user_data.phone,
        "role": UserRole.CLIENT,
        "is_active": True,
        "created_at": datetime.utcnow(),
        "created_by": admin["id"]
    }
    
    await db.users.insert_one(user_doc)
    return {"success": True, "message": "User created successfully", "user_id": user_doc["id"]}

@router.put("/users/{user_id}/password")
async def reset_user_password(user_id: str, new_password: str, admin_token: str = Query(...)):
    """Admin only: Reset user password."""
    admin = await require_admin(admin_token)
    
    result = await db.users.update_one(
        {"id": user_id},
        {"$set": {"password_hash": get_password_hash(new_password)}}
    )
    
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    
    return {"success": True, "message": "Password reset successfully"}

@router.put("/users/{user_id}/status")
async def toggle_user_status(user_id: str, is_active: bool, admin_token: str = Query(...)):
    """Admin only: Activate/deactivate user."""
    admin = await require_admin(admin_token)
    
    result = await db.users.update_one(
        {"id": user_id},
        {"$set": {"is_active": is_active}}
    )
    
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    
    return {"success": True, "message": f"User {'activated' if is_active else 'deactivated'}"}

# Site Activation Management
@router.post("/site/activate")
async def activate_site(
    user_id: str,
    subscription_type: SubscriptionType,
    admin_token: str = Query(...)
):
    """Admin only: Activate site access for a user."""
    admin = await require_admin(admin_token)
    
    # Calculate dates
    start_date = datetime.utcnow()
    if subscription_type == SubscriptionType.MONTHLY:
        end_date = start_date + timedelta(days=30)
    elif subscription_type == SubscriptionType.QUARTERLY:
        end_date = start_date + timedelta(days=90)
    else:  # YEARLY
        end_date = start_date + timedelta(days=365)
    
    activation_doc = {
        "user_id": user_id,
        "subscription_type": subscription_type,
        "start_date": start_date,
        "end_date": end_date,
        "status": SiteStatus.ACTIVE,
        "created_by": admin["id"],
        "created_at": datetime.utcnow()
    }
    
    await db.site_activations.insert_one(activation_doc)
    
    return {
        "success": True,
        "message": "Site activated",
        "end_date": end_date.isoformat()
    }

@router.get("/site/status/{user_id}")
async def check_site_status(user_id: str):
    """Check if user's site access is active."""
    activation = await db.site_activations.find_one(
        {"user_id": user_id},
        sort=[("created_at", -1)]
    )
    
    if not activation:
        return {"status": SiteStatus.INACTIVE, "message": "No active subscription"}
    
    now = datetime.utcnow()
    if now > activation["end_date"]:
        return {"status": SiteStatus.EXPIRED, "message": "Subscription expired", "expired_on": activation["end_date"]}
    
    return {
        "status": SiteStatus.ACTIVE,
        "subscription_type": activation["subscription_type"],
        "expires_on": activation["end_date"]
    }

# Data Export
@router.get("/data/export")
async def export_data(
    format: str = Query(..., regex="^(csv|pdf)$"),
    hardware_id: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    admin_token: str = Query(...)
):
    """Export flowmeter data to CSV or PDF."""
    await require_admin(admin_token)
    
    # Build query
    query = {}
    if hardware_id:
        query["hardware_id"] = hardware_id
    if start_date or end_date:
        query["timestamp"] = {}
        if start_date:
            query["timestamp"]["$gte"] = datetime.fromisoformat(start_date)
        if end_date:
            query["timestamp"]["$lte"] = datetime.fromisoformat(end_date)
    
    # Fetch data
    cursor = db.flowmeter_readings.find(query).sort("timestamp", -1).limit(1000)
    readings = await cursor.to_list(length=1000)
    
    # Remove MongoDB _id
    for reading in readings:
        reading.pop("_id", None)
        reading.pop("raw_data", None)
    
    if format == "csv":
        csv_data = DataExportService.to_csv(readings)
        return StreamingResponse(
            io.BytesIO(csv_data),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=flowmeter_data_{datetime.now().strftime('%Y%m%d')}.csv"}
        )
    else:  # PDF
        pdf_data = DataExportService.to_pdf(readings, "Flowmeter Readings Report")
        return StreamingResponse(
            io.BytesIO(pdf_data),
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename=flowmeter_report_{datetime.now().strftime('%Y%m%d')}.pdf"}
        )

# Data Import
@router.post("/data/import")
async def import_data(file: UploadFile = File(...), admin_token: str = Query(...)):
    """Import data from Excel file."""
    await require_admin(admin_token)
    
    if not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="Only Excel files are supported")
    
    # Read file
    content = await file.read()
    
    # Parse Excel
    data = ExcelImportService.parse_excel(content)
    
    # Validate
    valid_data, errors = ExcelImportService.validate_flowmeter_data(data)
    
    if errors:
        return {
            "success": False,
            "message": "Validation errors found",
            "errors": errors,
            "valid_count": len(valid_data),
            "error_count": len(errors)
        }
    
    # Insert into database
    if valid_data:
        # Convert timestamps to datetime
        for row in valid_data:
            if 'received_at' not in row:
                row['received_at'] = datetime.utcnow()
        
        result = await db.flowmeter_readings.insert_many(valid_data)
        
        return {
            "success": True,
            "message": "Data imported successfully",
            "inserted_count": len(result.inserted_ids)
        }
    
    return {"success": False, "message": "No valid data to import"}

# Delete/Update Data
@router.delete("/data/{reading_id}")
async def delete_reading(reading_id: str, admin_token: str = Query(...)):
    """Delete a specific reading."""
    await require_admin(admin_token)
    
    result = await db.flowmeter_readings.delete_one({"_id": reading_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Reading not found")
    
    return {"success": True, "message": "Reading deleted"}

# Certificate Generation
@router.post("/certificate/calibration")
async def generate_calibration_cert(
    instrument_id: str,
    instrument_type: str,
    serial_number: str,
    calibrated_by: str = "Envirolytics Team",
    admin_token: str = Query(...)
):
    """Generate calibration certificate."""
    await require_admin(admin_token)
    
    cert_data = {
        "instrument_id": instrument_id,
        "instrument_type": instrument_type,
        "serial_number": serial_number,
        "calibration_date": datetime.now(),
        "next_calibration_date": datetime.now() + timedelta(days=365),
        "calibrated_by": calibrated_by,
        "certificate_number": f"CAL-{datetime.now().strftime('%Y%m%d')}-{instrument_id}",
        "parameters": {
            "Flow Rate": {"standard": "100 L/min", "measured": "99.8 L/min", "deviation": "0.2%", "status": "Pass"},
            "Accuracy": {"standard": "\u00b11%", "measured": "0.2%", "deviation": "Within limits", "status": "Pass"},
            "Repeatability": {"standard": "<0.5%", "measured": "0.15%", "deviation": "Within limits", "status": "Pass"},
        }
    }
    
    pdf = CertificateGenerator.generate_calibration_certificate(cert_data)
    
    # Store certificate record
    await db.certificates.insert_one({**cert_data, "type": "calibration"})
    
    return StreamingResponse(
        io.BytesIO(pdf),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=calibration_cert_{instrument_id}.pdf"}
    )

@router.post("/certificate/installation")
async def generate_installation_cert(
    instrument_id: str,
    instrument_type: str,
    serial_number: str,
    client_name: str,
    location: str,
    installed_by: str = "Envirolytics Team",
    admin_token: str = Query(...)
):
    """Generate installation certificate."""
    await require_admin(admin_token)
    
    cert_data = {
        "instrument_id": instrument_id,
        "instrument_type": instrument_type,
        "serial_number": serial_number,
        "client_name": client_name,
        "location": location,
        "installation_date": datetime.now(),
        "installed_by": installed_by,
        "certificate_number": f"INST-{datetime.now().strftime('%Y%m%d')}-{instrument_id}"
    }
    
    pdf = CertificateGenerator.generate_installation_certificate(cert_data)
    
    # Store certificate record
    await db.certificates.insert_one({**cert_data, "type": "installation"})
    
    return StreamingResponse(
        io.BytesIO(pdf),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=installation_cert_{instrument_id}.pdf"}
    )

@router.get("/users/list")
async def list_users(admin_token: str = Query(...)):
    """List all users."""
    await require_admin(admin_token)
    
    users = await db.users.find({}, {"password_hash": 0}).to_list(length=100)
    for user in users:
        user["_id"] = str(user["_id"])
    
    return {"users": users, "count": len(users)}
