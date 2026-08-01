"""Instrument photograph gallery.

For every registered instrument (flowmeter / DWLR / OCEMS / DO / chlorine /
rainwater-harvesting structure), we let admins upload JPEG photos annotated
with location name, GPS coordinates and a landmark hint. Photos are shown on
the Certificate & Photos tab so a government inspector can quickly verify
that each declared instrument physically exists at the reported site.

Endpoints
---------
GET    /api/instrument-photos                       — list every photo visible to caller (admin: all)
GET    /api/instrument-photos/by-instrument/{hw_id} — list photos for one device
POST   /api/instrument-photos                       — admin only; upload JPEG + metadata
DELETE /api/instrument-photos/{photo_id}            — admin only; hard-delete photo + file
GET    /api/instrument-photos/file/{photo_id}       — authenticated fetch of the JPEG bytes
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse, Response

from auth import get_current_user, require_admin
from object_storage import put_object, get_object, make_path

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/instrument-photos", tags=["instrument-photos"])

db = None
PHOTO_DIR = os.path.join(os.path.dirname(__file__), "uploads", "instrument_photos")
os.makedirs(PHOTO_DIR, exist_ok=True)
MAX_BYTES = 8 * 1024 * 1024   # 8 MB per JPEG


def set_db(database):
    global db
    db = database


def _clean(doc: dict) -> dict:
    doc.pop("_id", None)
    doc.pop("file_path", None)  # never expose the on-disk path
    return doc


async def _get_photo_or_404(photo_id: str) -> dict:
    doc = await db.instrument_photos.find_one({"id": photo_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Photo not found")
    return doc


@router.get("")
async def list_photos(user: dict = Depends(get_current_user)):
    """Every photo the caller may see. Admins see all; clients see photos
    attached to their own instruments only."""
    q: dict = {}
    if user.get("role") != "admin":
        # Scope by ownership — look up the instruments this user owns first.
        owned = set()
        async for reg in db.instrument_registry.find(
            {"owner_user_id": user.get("id")},
            {"_id": 0, "hardware_id": 1},
        ):
            owned.add(reg["hardware_id"])
        q["hardware_id"] = {"$in": list(owned)} if owned else {"$in": ["__none__"]}
    rows = []
    async for p in db.instrument_photos.find(q).sort("created_at", -1):
        rows.append(_clean(p))
    return {"photos": rows, "count": len(rows)}


@router.get("/by-instrument/{hardware_id}")
async def list_by_instrument(hardware_id: str, user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        reg = await db.instrument_registry.find_one(
            {"hardware_id": hardware_id}, {"_id": 0, "owner_user_id": 1},
        )
        if not reg or reg.get("owner_user_id") != user.get("id"):
            raise HTTPException(status_code=403, detail="Not permitted to view photos for this instrument")
    rows = []
    async for p in db.instrument_photos.find({"hardware_id": hardware_id}).sort("created_at", -1):
        rows.append(_clean(p))
    return {"photos": rows, "count": len(rows)}


@router.post("")
async def upload_photo(
    file: UploadFile = File(...),
    hardware_id: str = Form(...),
    location_name: str = Form(""),
    latitude: Optional[float] = Form(None),
    longitude: Optional[float] = Form(None),
    landmark: str = Form(""),
    caption: str = Form(""),
    admin: dict = Depends(require_admin),
):
    """Admin uploads a JPEG snap of an installed instrument with GPS + landmark."""
    reg = await db.instrument_registry.find_one({"hardware_id": hardware_id}, {"_id": 0})
    if not reg:
        raise HTTPException(status_code=404, detail=f"Instrument '{hardware_id}' not found")

    ct = (file.content_type or "").lower()
    if ct not in ("image/jpeg", "image/jpg", "image/pjpeg"):
        raise HTTPException(status_code=400, detail="Only JPEG images are accepted")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(content) > MAX_BYTES:
        raise HTTPException(status_code=400, detail=f"Photo must be ≤ {MAX_BYTES // (1024 * 1024)} MB")

    photo_id = f"iph_{uuid.uuid4().hex[:12]}"
    safe_name = f"{photo_id}.jpg"

    # Persistent object storage — survives container redeploys. Fall back
    # to a local-disk write only if object storage is unreachable, so the
    # upload doesn't fail outright during a storage outage.
    storage_path: Optional[str] = None
    disk_path: Optional[str] = None
    try:
        obj_path = make_path("instrument_photos", safe_name)
        result = put_object(obj_path, content, "image/jpeg")
        storage_path = result.get("path") or obj_path
    except Exception as e:
        logger.error(f"[photo-upload] object storage failed: {e}; falling back to local disk")
        disk_path = os.path.join(PHOTO_DIR, safe_name)
        with open(disk_path, "wb") as f:
            f.write(content)

    doc = {
        "id": photo_id,
        "hardware_id": hardware_id,
        "instrument_type": reg.get("instrument_type"),
        "instrument_label": reg.get("label"),
        "owner_user_id": reg.get("owner_user_id"),
        "location_name": location_name.strip() or None,
        "latitude": float(latitude) if latitude is not None else None,
        "longitude": float(longitude) if longitude is not None else None,
        "landmark": landmark.strip() or None,
        "caption": caption.strip() or None,
        "file_name": safe_name,
        # `storage_path` is the source of truth for new uploads.
        # `file_path` is kept for legacy on-disk photos and only used
        # when object storage isn't available.
        "storage_path": storage_path,
        "file_path": disk_path,
        "size_bytes": len(content),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": admin.get("id"),
    }
    await db.instrument_photos.insert_one(doc)
    return _clean({**doc})


@router.delete("/{photo_id}")
async def delete_photo(photo_id: str, admin: dict = Depends(require_admin)):
    doc = await _get_photo_or_404(photo_id)
    file_path = doc.get("file_path")
    if file_path and os.path.exists(file_path):
        try:
            os.remove(file_path)
        except OSError:
            logger.warning("Could not remove photo file %s", file_path)
    await db.instrument_photos.delete_one({"id": photo_id})
    return {"success": True, "photo_id": photo_id}


@router.get("/file/{photo_id}")
async def serve_photo(photo_id: str, user: dict = Depends(get_current_user)):
    doc = await _get_photo_or_404(photo_id)
    if user.get("role") != "admin":
        if doc.get("owner_user_id") != user.get("id"):
            raise HTTPException(status_code=403, detail="Not permitted to view this photo")
    # Prefer persistent object storage.
    storage_path = doc.get("storage_path")
    if storage_path:
        try:
            data, ct = get_object(storage_path)
            return Response(content=data, media_type=ct or "image/jpeg")
        except Exception as e:
            logger.error(f"[photo-serve] object storage read failed for {photo_id}: {e}")
            # Fall through to disk (may still exist for very recent uploads)
    # Legacy fallback — photos uploaded before object storage was wired.
    file_path = doc.get("file_path")
    if file_path and os.path.exists(file_path):
        return FileResponse(file_path, media_type="image/jpeg", filename=doc.get("file_name") or "photo.jpg")
    raise HTTPException(status_code=404, detail="Photo file no longer available. Please re-upload.")
