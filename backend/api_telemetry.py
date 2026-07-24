"""Telemetry-source status endpoint used by the dashboard header badges.

Returns whether the current user should see the "MQTT LIVE / OFFLINE" and
"HTTP LIVE / OFFLINE" badges, plus the live-status of each transport.

- Admin ⇒ both `has_devices` flags are True (admins see every badge).
- Client ⇒ `has_devices` is True only for the transports the client actually
  owns at least one instrument on. Devices default to `source='mqtt'` unless
  the admin explicitly flips them to `'http'` on the registry.

- `mqtt.connected` mirrors `mqtt_service.connected`.
- `http.connected` is True when at least one `source='http'` device has a
  reading in the last HTTP_LIVE_WINDOW_MIN minutes.
"""
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends

from auth import get_current_user

router = APIRouter(prefix="/api/telemetry", tags=["telemetry"])

db = None
mqtt_service = None

# HTTP is considered "live" when we've seen any http-sourced device push
# telemetry in this window (in minutes).
HTTP_LIVE_WINDOW_MIN = 15


def set_db(database, mqtt_svc):
    global db, mqtt_service
    db = database
    mqtt_service = mqtt_svc


async def _http_live_now(hardware_ids):
    """Return True if any of the given hardware_ids has a reading in the
    last HTTP_LIVE_WINDOW_MIN minutes. Empty list ⇒ False."""
    if not hardware_ids:
        return False
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=HTTP_LIVE_WINDOW_MIN)).isoformat()
    # Check both flowmeter_latest and instrument_latest.
    q = {"hardware_id": {"$in": list(hardware_ids)}, "received_at": {"$gte": cutoff},
         "_dummy": {"$ne": True}}
    if await db.flowmeter_latest.find_one(q):
        return True
    if await db.instrument_latest.find_one(q):
        return True
    return False


@router.get("/sources")
async def telemetry_sources(user: dict = Depends(get_current_user)):
    is_admin = user.get("role") == "admin"
    query = {} if is_admin else {"owner_user_id": user.get("id")}

    # Pull only the two fields we need.
    cursor = db.instrument_registry.find(query, {"_id": 0, "source": 1, "hardware_id": 1})
    mqtt_hw = []
    http_hw = []
    async for it in cursor:
        src = (it.get("source") or "mqtt").lower()
        if src == "http":
            http_hw.append(it["hardware_id"])
        else:
            mqtt_hw.append(it["hardware_id"])

    mqtt_connected = bool(mqtt_service and mqtt_service.connected)
    http_connected = await _http_live_now(http_hw)

    return {
        "mqtt": {
            # Admin always sees this badge; client sees it only when they own
            # at least one MQTT-source device.
            "has_devices": is_admin or len(mqtt_hw) > 0,
            "connected": mqtt_connected,
            "device_count": len(mqtt_hw),
        },
        "http": {
            "has_devices": is_admin or len(http_hw) > 0,
            "connected": http_connected,
            "device_count": len(http_hw),
            "window_minutes": HTTP_LIVE_WINDOW_MIN,
        },
    }
