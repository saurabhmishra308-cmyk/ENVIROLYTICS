"""Certificate management API.

Handles four document types:
  - installation  : Installation certificate (PDF)
  - calibration   : Calibration certificate (PDF)
  - water_pre     : Pre-monsoon Water Quality Test Report (PDF/Image)
  - water_post    : Post-monsoon Water Quality Test Report (PDF/Image)

Files are stored on disk under /app/backend/certificate_files/{type}/{year}/{id}_{filename}
and a metadata document is kept in MongoDB collection `certificates`.
"""
import os
import uuid
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from auth import require_admin, get_current_user

router = APIRouter(prefix="/api/certificates", tags=["certificates"])

# Set from server.py
db = None

ALLOWED_TYPES = {"installation", "calibration", "water_pre", "water_post"}
ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB

STORAGE_ROOT = Path(os.environ.get("CERT_STORAGE_DIR", "/app/backend/certificate_files"))
STORAGE_ROOT.mkdir(parents=True, exist_ok=True)


def set_db(database):
    global db
    db = database


def _validate_type(cert_type: str) -> str:
    t = cert_type.lower()
    if t not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid cert_type '{cert_type}'. Allowed: {sorted(ALLOWED_TYPES)}",
        )
    return t


def _validate_extension(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"File extension '{ext}' not allowed. Use PDF/JPG/PNG.",
        )
    return ext


@router.get("/types")
async def list_types():
    return {
        "types": [
            {"key": "installation", "label": "Installation Certificate"},
            {"key": "calibration", "label": "Calibration Certificate"},
            {"key": "water_pre", "label": "Water Quality — Pre-Monsoon"},
            {"key": "water_post", "label": "Water Quality — Post-Monsoon"},
        ]
    }


@router.post("/upload")
async def upload_certificate(
    file: UploadFile = File(...),
    cert_type: str = Form(...),
    year: int = Form(...),
    instrument_id: Optional[str] = Form(None),
    instrument_type: Optional[str] = Form(None),
    client_id: Optional[str] = Form(None),
    notes: Optional[str] = Form(None),
    admin: dict = Depends(require_admin),
):
    """Upload any of the four certificate types. Admin-only."""
    t = _validate_type(cert_type)
    if year < 2000 or year > 2100:
        raise HTTPException(status_code=400, detail="Year out of range")
    ext = _validate_extension(file.filename or "upload.bin")

    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail=f"File too large (max {MAX_FILE_SIZE // 1024 // 1024} MB)")

    cert_id = f"cert_{uuid.uuid4().hex[:12]}"
    safe_name = f"{cert_id}_{Path(file.filename or 'upload').name}"
    target_dir = STORAGE_ROOT / t / str(year)
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / safe_name
    with target_path.open("wb") as f:
        f.write(contents)

    doc = {
        "id": cert_id,
        "cert_type": t,
        "year": year,
        "instrument_id": instrument_id,
        "instrument_type": instrument_type,
        "client_id": client_id,
        "notes": notes,
        "original_filename": file.filename,
        "stored_filename": safe_name,
        "stored_path": str(target_path),
        "size_bytes": len(contents),
        "content_type": file.content_type or "application/octet-stream",
        "uploaded_by": admin["id"],
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.certificates.insert_one(dict(doc))
    doc.pop("_id", None)
    return {"success": True, "certificate": doc}


@router.get("/list")
async def list_certificates(
    cert_type: Optional[str] = Query(None),
    year: Optional[int] = Query(None),
    instrument_id: Optional[str] = Query(None),
    client_id: Optional[str] = Query(None),
    user: dict = Depends(get_current_user),
):
    q = {}
    if cert_type:
        q["cert_type"] = _validate_type(cert_type)
    if year:
        q["year"] = year
    if instrument_id:
        q["instrument_id"] = instrument_id
    if client_id:
        q["client_id"] = client_id
    # Non-admin clients can only see their own certificates
    if user.get("role") != "admin":
        q["client_id"] = user["id"]
    cursor = db.certificates.find(q, {"_id": 0, "stored_path": 0}).sort("uploaded_at", -1)
    items = await cursor.to_list(length=500)
    return {"certificates": items, "count": len(items)}


@router.get("/download/{cert_id}")
async def download_certificate(cert_id: str, user: dict = Depends(get_current_user)):
    doc = await db.certificates.find_one({"id": cert_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Certificate not found")
    # Non-admins can only download their own
    if user.get("role") != "admin" and doc.get("client_id") and doc["client_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    path = Path(doc["stored_path"])
    if not path.exists():
        raise HTTPException(status_code=410, detail="File missing from storage")
    return FileResponse(
        path=str(path),
        media_type=doc.get("content_type", "application/octet-stream"),
        filename=doc.get("original_filename") or doc.get("stored_filename"),
    )


@router.delete("/{cert_id}")
async def delete_certificate(cert_id: str, admin: dict = Depends(require_admin)):
    doc = await db.certificates.find_one({"id": cert_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Certificate not found")
    path = Path(doc.get("stored_path", ""))
    if path.exists():
        try:
            path.unlink()
        except Exception:
            pass
    await db.certificates.delete_one({"id": cert_id})
    return {"success": True}


@router.get("/years")
async def list_years(cert_type: Optional[str] = Query(None), user: dict = Depends(get_current_user)):
    q = {}
    if cert_type:
        q["cert_type"] = _validate_type(cert_type)
    if user.get("role") != "admin":
        q["client_id"] = user["id"]
    years = await db.certificates.distinct("year", q)
    return {"years": sorted([y for y in years if y is not None], reverse=True)}
