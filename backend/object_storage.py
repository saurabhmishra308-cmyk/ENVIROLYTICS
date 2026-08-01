"""Emergent Object Storage helper.

Fixes the "photos disappear after redeploy" bug — Kubernetes container
disks are ephemeral, so anything written to /app/backend/uploads/ is lost
on every redeploy. All uploads now go through the Emergent object store
which persists across deployments and is shared between preview and
production environments.

Usage pattern (single init at startup, reused per request):

    from object_storage import put_object, get_object, storage_ready

    @app.on_event("startup")
    async def _startup():
        init_storage()   # non-fatal on failure

    # Upload
    result = put_object(f"envirolytics/photos/{user_id}/{uuid.uuid4()}.jpg",
                        raw_bytes, "image/jpeg")
    storage_path = result["path"]

    # Download
    data, content_type = get_object(storage_path)
"""

from __future__ import annotations

import os
import logging
import requests
from typing import Tuple

logger = logging.getLogger(__name__)

STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY", "").strip()
APP_NAME = "envirolytics"

# Session-scoped storage key — set once by init_storage(), reused on
# every request. Re-init on 403 (expired key).
_storage_key: str | None = None


def storage_ready() -> bool:
    """True when a storage key has been acquired at least once."""
    return _storage_key is not None


def init_storage() -> str | None:
    """Acquire (or reuse) the session storage key. Safe to call at
    startup; failures are logged and swallowed so the app can still boot
    if object storage is unavailable (uploads will 503 in that case)."""
    global _storage_key
    if _storage_key:
        return _storage_key
    if not EMERGENT_KEY:
        logger.error("[object_storage] EMERGENT_LLM_KEY missing from env")
        return None
    try:
        resp = requests.post(
            f"{STORAGE_URL}/init",
            json={"emergent_key": EMERGENT_KEY},
            timeout=30,
        )
        resp.raise_for_status()
        _storage_key = resp.json().get("storage_key")
        if _storage_key:
            logger.info("[object_storage] initialized ok")
        return _storage_key
    except Exception as e:
        logger.error(f"[object_storage] init failed: {e}")
        return None


def _headers() -> dict:
    key = init_storage()
    if not key:
        raise RuntimeError("Object storage is not initialized")
    return {"X-Storage-Key": key}


def put_object(path: str, data: bytes, content_type: str) -> dict:
    """Upload bytes to `path`. Returns the storage server's response
    (contains the canonical `path`, `size`, `etag`)."""
    key = init_storage()
    if not key:
        raise RuntimeError("Object storage is not initialized")
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=180,
    )
    if resp.status_code == 403:
        # Storage key expired — re-init once and retry.
        global _storage_key
        _storage_key = None
        key = init_storage()
        if not key:
            raise RuntimeError("Object storage reinit failed")
        resp = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data,
            timeout=180,
        )
    resp.raise_for_status()
    return resp.json()


def get_object(path: str) -> Tuple[bytes, str]:
    """Download bytes from `path`. Returns (data, content_type)."""
    key = init_storage()
    if not key:
        raise RuntimeError("Object storage is not initialized")
    resp = requests.get(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key},
        timeout=120,
    )
    if resp.status_code == 403:
        global _storage_key
        _storage_key = None
        key = init_storage()
        if not key:
            raise RuntimeError("Object storage reinit failed")
        resp = requests.get(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key},
            timeout=120,
        )
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


def make_path(subdir: str, filename: str) -> str:
    """Build a canonical object-storage path. `subdir` groups files by
    domain (e.g. "instrument_photos", "certificates", "aeration_videos").
    Filenames should be UUID-based to avoid collisions."""
    subdir = subdir.strip("/")
    filename = filename.lstrip("/")
    return f"{APP_NAME}/{subdir}/{filename}"
