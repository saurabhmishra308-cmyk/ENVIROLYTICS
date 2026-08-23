"""Emergent Object Storage helper (optional).

On Emergent's managed hosting, container disks are ephemeral so uploaded
photos/videos are pushed to Emergent's object storage. On self-hosted
deployments (Azure VM, bare metal, etc.) the VM disk is persistent so
local-disk storage is safe and this module simply becomes a no-op —
callers automatically fall back to writing under /app/backend/uploads/.

Toggle: set EMERGENT_LLM_KEY in backend/.env to enable the Emergent
object store. Leave it unset (or blank) on Azure/self-hosted to keep
uploads purely on the local persistent disk.
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

# When True, uploads/downloads go through Emergent. When False, this
# module raises so callers fall back to local disk. Set on first
# successful init.
_enabled = bool(EMERGENT_KEY)
_storage_key: str | None = None
_log_disabled_once = False


class ObjectStorageDisabled(RuntimeError):
    """Raised when object storage isn't configured — callers should
    catch this and fall back to local disk quietly."""


def storage_ready() -> bool:
    """True when a storage key has been acquired at least once."""
    return _storage_key is not None


def _disabled_note():
    global _log_disabled_once
    if not _log_disabled_once:
        logger.info(
            "[object_storage] disabled — EMERGENT_LLM_KEY not set. "
            "Using local persistent disk for photo/video/cert uploads. "
            "This is the recommended setup for Azure VM / bare-metal hosts."
        )
        _log_disabled_once = True


def init_storage() -> str | None:
    """Acquire (or reuse) the session storage key. On Emergent this
    enables the persistent object store; anywhere else it's a no-op."""
    global _storage_key
    if not _enabled:
        _disabled_note()
        return None
    if _storage_key:
        return _storage_key
    try:
        resp = requests.post(
            f"{STORAGE_URL}/init",
            json={"emergent_key": EMERGENT_KEY},
            timeout=30,
        )
        resp.raise_for_status()
        _storage_key = resp.json().get("storage_key")
        if _storage_key:
            logger.info("[object_storage] initialized ok (Emergent object store)")
        return _storage_key
    except Exception as e:
        logger.warning(f"[object_storage] init failed: {e}. Falling back to local disk.")
        return None


def put_object(path: str, data: bytes, content_type: str) -> dict:
    """Upload bytes to `path`. On self-hosted deployments where the
    Emergent object store isn't configured, raises ObjectStorageDisabled
    so the caller cleanly falls back to local disk."""
    if not _enabled:
        raise ObjectStorageDisabled("Emergent object storage is disabled on this host")
    key = init_storage()
    if not key:
        raise ObjectStorageDisabled("Object storage init failed")
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=180,
    )
    if resp.status_code == 403:
        global _storage_key
        _storage_key = None
        key = init_storage()
        if not key:
            raise ObjectStorageDisabled("Object storage reinit failed")
        resp = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data,
            timeout=180,
        )
    resp.raise_for_status()
    return resp.json()


def get_object(path: str) -> Tuple[bytes, str]:
    """Download bytes from `path`. On self-hosted deployments raises
    ObjectStorageDisabled so the caller falls back to local disk."""
    if not _enabled:
        raise ObjectStorageDisabled("Emergent object storage is disabled on this host")
    key = init_storage()
    if not key:
        raise ObjectStorageDisabled("Object storage init failed")
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
            raise ObjectStorageDisabled("Object storage reinit failed")
        resp = requests.get(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key},
            timeout=120,
        )
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


def make_path(subdir: str, filename: str) -> str:
    """Build a canonical object-storage path. `subdir` groups files by
    domain (e.g. "instrument_photos", "certificates", "aeration_videos")."""
    subdir = subdir.strip("/")
    filename = filename.lstrip("/")
    return f"{APP_NAME}/{subdir}/{filename}"
