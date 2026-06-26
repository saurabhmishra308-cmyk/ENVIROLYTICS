"""HTTPS direct-ingestion endpoint — a bypass for MQTT.

Devices POST telemetry JSON to:
  POST /api/devices/ingest

Headers:
  X-Hardware-Id:  <the hardware_id registered in instrument_registry>
  X-Device-Key:   <the device_key emitted when the instrument was registered>
  Content-Type:   application/json

Body: same JSON payload the device would have published over MQTT.

The endpoint validates the (hardware_id, device_key) pair against the
instrument_registry, then routes the payload through the exact same async
handler used by the MQTT subscriber — so storage, downstream alerting,
limit-breach detection, etc. all behave identically whether the data comes
in via MQTT or HTTPS.

This endpoint works through the standard HTTPS ingress (port 443) so it is
NOT subject to the firewall problems that broke the MQTT connection. Any
device that can do `curl https://…` can publish telemetry here.
"""
import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Header, HTTPException, Request

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/devices", tags=["device-ingestion"])

# Wired up from server.py
db = None
mqtt_service = None


def set_db(database, mqtt_svc):
    global db, mqtt_service
    db = database
    mqtt_service = mqtt_svc


def _safe_get(d: Optional[Dict[str, Any]], key: str, default: Any = None) -> Any:
    if not isinstance(d, dict):
        return default
    return d.get(key, default)


@router.post("/ingest")
async def ingest(
    request: Request,
    x_hardware_id: Optional[str] = Header(None, convert_underscores=False, alias="X-Hardware-Id"),
    x_device_key: Optional[str] = Header(None, convert_underscores=False, alias="X-Device-Key"),
):
    """Single ingestion endpoint for all instrument types (auto-detected from
    the registry record).

    Accepts the same payload as the MQTT topic for that instrument type:

    Flowmeter:
        {"IMEI":"…","SIGNAL":24,"FLOW":1500.5,"TOT1":1234,"TOT2":56,
         "RTOT1":0,"RTOT2":0,"UNT":2,"POW":1,"TEMPER":28.5,
         "TIME":"2026-07-15T10:30:00Z","VER":"FW_v1.2.3"}

    DWLR:
        {"LEVEL":12.45,"TEMPER":24.8,"TIME":"2026-07-15T10:30:00Z"}

    pH / TDS / Conductivity:
        {"PH":7.42,"TEMPER":25.1,"TIME":"…"}   (or "TDS":510, "COND":980)

    Returns:
        200 {"success": true, "hardware_id": "...", "instrument_type": "..."}
        401 if device_key is wrong
        404 if the hardware_id is not registered
    """
    if not x_hardware_id or not x_device_key:
        raise HTTPException(
            status_code=401,
            detail="Both X-Hardware-Id and X-Device-Key headers are required.",
        )

    hardware_id = x_hardware_id.strip()
    reg = await db.instrument_registry.find_one({"hardware_id": hardware_id})
    if not reg:
        raise HTTPException(status_code=404, detail=f"Hardware id '{hardware_id}' is not registered.")

    expected_key = reg.get("device_key")
    if not expected_key or expected_key != x_device_key:
        logger.warning(f"[ingest] Bad device key for {hardware_id}")
        raise HTTPException(status_code=401, detail="Invalid device key for this hardware id.")

    # ---- parse body
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Request body must be valid JSON.")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Request body must be a JSON object.")

    itype = reg.get("instrument_type")
    if not itype:
        raise HTTPException(status_code=500, detail="Registry record missing instrument_type")

    # ---- route to the same handlers used by MQTT
    try:
        if itype == "flowmeter":
            await mqtt_service.process_flowmeter_data(hardware_id, payload)
        else:
            await mqtt_service.process_instrument_data(itype, hardware_id, payload)
    except Exception as e:  # noqa: BLE001
        logger.exception(f"[ingest] Processing failed for {hardware_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to process payload: {e}")

    return {"success": True, "hardware_id": hardware_id, "instrument_type": itype}


@router.get("/ingest/ping")
async def ingest_ping(
    x_hardware_id: Optional[str] = Header(None, convert_underscores=False, alias="X-Hardware-Id"),
    x_device_key: Optional[str] = Header(None, convert_underscores=False, alias="X-Device-Key"),
):
    """Lightweight health-check the device can hit to confirm credentials are
    correct WITHOUT publishing any data. Returns {ok, instrument_type, label}
    on success."""
    if not x_hardware_id or not x_device_key:
        raise HTTPException(status_code=401, detail="Missing headers")
    reg = await db.instrument_registry.find_one({"hardware_id": x_hardware_id.strip()})
    if not reg or reg.get("device_key") != x_device_key:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return {
        "ok": True,
        "hardware_id": reg["hardware_id"],
        "instrument_type": reg["instrument_type"],
        "label": reg.get("label"),
    }
