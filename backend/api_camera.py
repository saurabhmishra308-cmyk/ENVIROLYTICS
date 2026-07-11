"""Live Camera Streams API.

Stores per-device video stream configuration used by the Water Quality
dashboard to render a live camera widget next to the DO meter (and any
other instrument in future). One stream document per `hardware_id`.

Supported `stream_type` values:
  * ``youtube`` — YouTube video / Shorts / Live URL; converted to embed URL.
  * ``mp4``     — Direct MP4 (or HLS .m3u8) URL playable by <video>.
  * ``upload``  — Admin-uploaded MP4/WebM stored on the pod, served under
                  ``/api/uploads/camera/…``. Presented to clients as if it
                  were a live feed (no "demo" markers).

The ``integration_config`` field on each camera record is a placeholder for
real-device wiring (API endpoint, port, protocol, credentials, model, etc.).
It is only visible/editable by admins; clients never see it.

Auth model:
  * Admins: full CRUD + upload.
  * Clients: read-only, scoped to devices they own. `integration_config` and
    upload metadata are stripped from client responses.
"""
from __future__ import annotations

import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List, Dict

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel, Field

import api_instrument_registry
from auth import get_current_user, require_admin

router = APIRouter(prefix="/api/camera-streams", tags=["camera-streams"])

db = None
UPLOAD_ROOT = Path(__file__).parent / "uploads" / "camera"
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
ALLOWED_VIDEO_EXTS = {".mp4", ".webm", ".mov", ".m4v"}
MAX_VIDEO_BYTES = 120 * 1024 * 1024   # 120 MB — cameras produce longer clips


def set_db(database):
    global db
    db = database


# ---------------------------------------------------------------- helpers

_YT_RE = re.compile(
    r"(?:youtube\.com/(?:shorts/|watch\?v=|embed/|live/|v/)|youtu\.be/)([A-Za-z0-9_-]{6,})",
    re.IGNORECASE,
)


def _detect_type(url: str) -> str:
    u = (url or "").strip()
    if not u:
        return "mp4"
    if _YT_RE.search(u) or "youtube.com" in u or "youtu.be" in u:
        return "youtube"
    return "mp4"


def _youtube_id(url: str) -> Optional[str]:
    m = _YT_RE.search(url or "")
    return m.group(1) if m else None


def _embed_url(url: str) -> str:
    """Convert a raw YouTube URL to an autoplay/muted/loop embed URL.

    For non-YouTube sources, returns the URL unchanged.
    """
    vid = _youtube_id(url or "")
    if vid:
        return (
            f"https://www.youtube.com/embed/{vid}"
            f"?autoplay=1&mute=1&loop=1&playlist={vid}&controls=1&modestbranding=1&rel=0"
        )
    return url


def _serialize(doc: dict, is_admin: bool = False) -> dict:
    if not doc:
        return doc
    doc = {k: v for k, v in doc.items() if k != "_id"}
    doc["embed_url"] = _embed_url(doc.get("stream_url") or "")
    # Strip admin-only fields (integration_config, uploaded_by, created_by)
    # from client responses so they never see who entered what.
    if not is_admin:
        for k in ("integration_config", "created_by", "updated_by",
                  "uploaded_by", "uploaded_at"):
            doc.pop(k, None)
    return doc


# ---------------------------------------------------------------- schemas

class CameraIntegrationConfig(BaseModel):
    """Real device wiring — admin-editable placeholder for future integration."""
    protocol: Optional[str] = Field(default=None, description="rtsp|hls|http|onvif|other")
    api_endpoint: Optional[str] = Field(default=None, description="Camera API / stream endpoint URL")
    port: Optional[int] = Field(default=None, ge=1, le=65535)
    device_model: Optional[str] = None
    camera_ip: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None   # NOTE: stored as-is; move to KMS if you go multi-tenant
    notes: Optional[str] = None


class CameraStreamIn(BaseModel):
    hardware_id: str = Field(..., description="Instrument this camera is attached to")
    stream_url: str = ""
    stream_type: Optional[str] = Field(None, description="'youtube' | 'mp4' | 'upload' — auto-detected if empty")
    label: Optional[str] = None
    location: Optional[str] = None
    camera_status: str = Field("online", description="'online' | 'offline' | 'maintenance'")
    integration_config: Optional[CameraIntegrationConfig] = None


class CameraStreamPatch(BaseModel):
    stream_url: Optional[str] = None
    stream_type: Optional[str] = None
    label: Optional[str] = None
    location: Optional[str] = None
    camera_status: Optional[str] = None
    integration_config: Optional[CameraIntegrationConfig] = None


def _is_admin(user: dict) -> bool:
    return (user or {}).get("role") == "admin"


# ---------------------------------------------------------------- endpoints

@router.get("")
async def list_streams(user: dict = Depends(get_current_user)) -> List[Dict]:
    visible = await api_instrument_registry.visible_hardware_ids(user)
    query: Dict = {}
    if visible is not None:
        query["hardware_id"] = {"$in": list(visible)}
    admin = _is_admin(user)
    out: List[Dict] = []
    async for doc in db.camera_streams.find(query):
        out.append(_serialize(doc, admin))
    return out


@router.get("/by-device/{hardware_id}")
async def get_by_device(hardware_id: str, user: dict = Depends(get_current_user)):
    visible = await api_instrument_registry.visible_hardware_ids(user)
    if visible is not None and hardware_id not in visible:
        raise HTTPException(status_code=403, detail="Not authorised for this device")
    doc = await db.camera_streams.find_one({"hardware_id": hardware_id})
    if not doc:
        return None  # UI handles null → "no camera configured"
    return _serialize(doc, _is_admin(user))


@router.post("")
async def create_stream(payload: CameraStreamIn, admin: dict = Depends(require_admin)):
    # Ensure the target instrument exists.
    reg = await db.instrument_registry.find_one({"hardware_id": payload.hardware_id})
    if not reg:
        raise HTTPException(status_code=404, detail="Instrument not found in registry")

    stype = (payload.stream_type or _detect_type(payload.stream_url or "")).lower()
    if stype not in ("youtube", "mp4", "upload"):
        raise HTTPException(status_code=400, detail="stream_type must be 'youtube', 'mp4' or 'upload'")

    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "hardware_id": payload.hardware_id,
        "stream_url": (payload.stream_url or "").strip(),
        "stream_type": stype,
        "label": payload.label or reg.get("label") or payload.hardware_id,
        "location": payload.location or reg.get("location_name"),
        "camera_status": payload.camera_status or "online",
        "created_at": now,
        "updated_at": now,
        "created_by": admin.get("email"),
    }
    if payload.integration_config is not None:
        doc["integration_config"] = payload.integration_config.model_dump(exclude_none=True)
    # Upsert on hardware_id — one camera per device.
    await db.camera_streams.update_one(
        {"hardware_id": payload.hardware_id},
        {"$set": doc},
        upsert=True,
    )
    saved = await db.camera_streams.find_one({"hardware_id": payload.hardware_id})
    return _serialize(saved, True)


@router.put("/{hardware_id}")
async def update_stream(hardware_id: str, patch: CameraStreamPatch,
                        admin: dict = Depends(require_admin)):
    existing = await db.camera_streams.find_one({"hardware_id": hardware_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Camera stream not found")
    update: Dict = {"updated_at": datetime.now(timezone.utc).isoformat(), "updated_by": admin.get("email")}
    if patch.stream_url is not None:
        update["stream_url"] = patch.stream_url.strip()
        update["stream_type"] = (patch.stream_type or _detect_type(patch.stream_url)).lower()
    if patch.stream_type is not None and "stream_type" not in update:
        st = patch.stream_type.lower()
        if st not in ("youtube", "mp4", "upload"):
            raise HTTPException(status_code=400, detail="stream_type must be 'youtube', 'mp4' or 'upload'")
        update["stream_type"] = st
    if patch.label is not None:
        update["label"] = patch.label
    if patch.location is not None:
        update["location"] = patch.location
    if patch.camera_status is not None:
        update["camera_status"] = patch.camera_status
    if patch.integration_config is not None:
        update["integration_config"] = patch.integration_config.model_dump(exclude_none=True)

    await db.camera_streams.update_one({"hardware_id": hardware_id}, {"$set": update})
    saved = await db.camera_streams.find_one({"hardware_id": hardware_id})
    return _serialize(saved, True)


@router.delete("/{hardware_id}")
async def delete_stream(hardware_id: str, admin: dict = Depends(require_admin)):
    r = await db.camera_streams.delete_one({"hardware_id": hardware_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Camera stream not found")
    return {"success": True, "hardware_id": hardware_id}


# ─────────── File upload — admin uploads a pre-recorded MP4/WebM ───────────

@router.post("/{hardware_id}/upload")
async def upload_camera_video(hardware_id: str,
                               file: UploadFile = File(...),
                               admin: dict = Depends(require_admin)):
    """Admin-only: upload a recorded MP4/WebM that will play as the camera
    feed. The clip is treated as a live-looking source (no "demo" markers)
    so the customer sees a seamless experience until a real camera is wired.
    """
    reg = await db.instrument_registry.find_one({"hardware_id": hardware_id})
    if not reg:
        raise HTTPException(status_code=404, detail="Instrument not found")

    ext = os.path.splitext(file.filename or "")[1].lower() or ".mp4"
    if ext not in ALLOWED_VIDEO_EXTS:
        raise HTTPException(status_code=400, detail=f"Unsupported extension. Allowed: {sorted(ALLOWED_VIDEO_EXTS)}")

    safe_hw = hardware_id.replace("/", "_")
    fname = f"{safe_hw}_{uuid.uuid4().hex[:10]}{ext}"
    dest = UPLOAD_ROOT / fname
    total = 0
    try:
        with dest.open("wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)   # 1 MB
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_VIDEO_BYTES:
                    out.close()
                    dest.unlink(missing_ok=True)
                    raise HTTPException(status_code=413, detail=f"File exceeds {MAX_VIDEO_BYTES // (1024*1024)} MB")
                out.write(chunk)
    except HTTPException:
        raise
    except Exception as e:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")

    url = f"/api/uploads/camera/{fname}"
    now = datetime.now(timezone.utc).isoformat()

    # Purge previous uploaded file (if the current stream was an upload).
    prev = await db.camera_streams.find_one({"hardware_id": hardware_id})
    if prev and prev.get("stream_type") == "upload":
        old = (prev.get("stream_url") or "").rsplit("/", 1)[-1]
        if old and old != fname:
            (UPLOAD_ROOT / old).unlink(missing_ok=True)

    doc = {
        "id": prev.get("id") if prev else str(uuid.uuid4()),
        "hardware_id": hardware_id,
        "stream_url": url,
        "stream_type": "upload",
        "label": (prev or {}).get("label") or reg.get("label") or hardware_id,
        "location": (prev or {}).get("location") or reg.get("location_name"),
        "camera_status": "online",
        "updated_at": now,
        "uploaded_at": now,
        "uploaded_by": admin.get("email"),
    }
    if prev is None:
        doc["created_at"] = now
        doc["created_by"] = admin.get("email")
    if prev and prev.get("integration_config"):
        doc["integration_config"] = prev["integration_config"]

    await db.camera_streams.update_one(
        {"hardware_id": hardware_id},
        {"$set": doc},
        upsert=True,
    )
    saved = await db.camera_streams.find_one({"hardware_id": hardware_id})
    return {"success": True, "bytes": total, "url": url, "stream": _serialize(saved, True)}
