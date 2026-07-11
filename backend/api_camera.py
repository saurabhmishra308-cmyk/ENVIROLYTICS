"""Live Camera Streams API.

Stores per-device video stream configuration used by the Water Quality
dashboard to render a live camera widget next to the DO meter (and any
other instrument in future). One stream document per `hardware_id`.

Supported `stream_type` values:
  * ``youtube`` — YouTube video / Shorts / Live URL; converted to embed URL.
  * ``mp4``     — Direct MP4 (or HLS .m3u8) URL playable by <video>.

Auth model:
  * Admins: full CRUD.
  * Clients: read-only, scoped to devices they own.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Optional, List, Dict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import api_instrument_registry
from auth import get_current_user, require_admin

router = APIRouter(prefix="/api/camera-streams", tags=["camera-streams"])

db = None


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


def _serialize(doc: dict) -> dict:
    if not doc:
        return doc
    doc = {k: v for k, v in doc.items() if k != "_id"}
    doc["embed_url"] = _embed_url(doc.get("stream_url") or "")
    return doc


# ---------------------------------------------------------------- schemas

class CameraStreamIn(BaseModel):
    hardware_id: str = Field(..., description="Instrument this camera is attached to")
    stream_url: str
    stream_type: Optional[str] = Field(None, description="'youtube' | 'mp4' — auto-detected if empty")
    label: Optional[str] = None
    location: Optional[str] = None
    camera_status: str = Field("online", description="'online' | 'offline' | 'maintenance'")


class CameraStreamPatch(BaseModel):
    stream_url: Optional[str] = None
    stream_type: Optional[str] = None
    label: Optional[str] = None
    location: Optional[str] = None
    camera_status: Optional[str] = None


# ---------------------------------------------------------------- endpoints

@router.get("")
async def list_streams(user: dict = Depends(get_current_user)) -> List[Dict]:
    visible = await api_instrument_registry.visible_hardware_ids(user)
    query: Dict = {}
    if visible is not None:
        query["hardware_id"] = {"$in": list(visible)}
    out: List[Dict] = []
    async for doc in db.camera_streams.find(query):
        out.append(_serialize(doc))
    return out


@router.get("/by-device/{hardware_id}")
async def get_by_device(hardware_id: str, user: dict = Depends(get_current_user)):
    visible = await api_instrument_registry.visible_hardware_ids(user)
    if visible is not None and hardware_id not in visible:
        raise HTTPException(status_code=403, detail="Not authorised for this device")
    doc = await db.camera_streams.find_one({"hardware_id": hardware_id})
    if not doc:
        return None  # UI handles null → "no camera configured"
    return _serialize(doc)


@router.post("")
async def create_stream(payload: CameraStreamIn, admin: dict = Depends(require_admin)):
    # Ensure the target instrument exists.
    reg = await db.instrument_registry.find_one({"hardware_id": payload.hardware_id})
    if not reg:
        raise HTTPException(status_code=404, detail="Instrument not found in registry")

    stype = (payload.stream_type or _detect_type(payload.stream_url)).lower()
    if stype not in ("youtube", "mp4"):
        raise HTTPException(status_code=400, detail="stream_type must be 'youtube' or 'mp4'")

    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "hardware_id": payload.hardware_id,
        "stream_url": payload.stream_url.strip(),
        "stream_type": stype,
        "label": payload.label or reg.get("label") or payload.hardware_id,
        "location": payload.location or reg.get("location_name"),
        "camera_status": payload.camera_status or "online",
        "created_at": now,
        "updated_at": now,
        "created_by": admin.get("email"),
    }
    # Upsert on hardware_id — one camera per device.
    await db.camera_streams.update_one(
        {"hardware_id": payload.hardware_id},
        {"$set": doc},
        upsert=True,
    )
    saved = await db.camera_streams.find_one({"hardware_id": payload.hardware_id})
    return _serialize(saved)


@router.put("/{hardware_id}")
async def update_stream(hardware_id: str, patch: CameraStreamPatch,
                        admin: dict = Depends(require_admin)):
    existing = await db.camera_streams.find_one({"hardware_id": hardware_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Camera stream not found")
    update: Dict = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if patch.stream_url is not None:
        update["stream_url"] = patch.stream_url.strip()
        update["stream_type"] = (patch.stream_type or _detect_type(patch.stream_url)).lower()
    if patch.stream_type is not None and "stream_type" not in update:
        st = patch.stream_type.lower()
        if st not in ("youtube", "mp4"):
            raise HTTPException(status_code=400, detail="stream_type must be 'youtube' or 'mp4'")
        update["stream_type"] = st
    if patch.label is not None:
        update["label"] = patch.label
    if patch.location is not None:
        update["location"] = patch.location
    if patch.camera_status is not None:
        update["camera_status"] = patch.camera_status

    await db.camera_streams.update_one({"hardware_id": hardware_id}, {"$set": update})
    saved = await db.camera_streams.find_one({"hardware_id": hardware_id})
    return _serialize(saved)


@router.delete("/{hardware_id}")
async def delete_stream(hardware_id: str, admin: dict = Depends(require_admin)):
    r = await db.camera_streams.delete_one({"hardware_id": hardware_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Camera stream not found")
    return {"success": True, "hardware_id": hardware_id}
