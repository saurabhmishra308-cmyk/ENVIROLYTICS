from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

from auth import get_current_user
import api_instrument_registry

router = APIRouter(prefix="/api/flowmeter", tags=["flowmeter"])

# Global MQTT service instance (will be set from server.py)
mqtt_service = None

class FlowmeterSubscription(BaseModel):
    hardware_id: str
    location: Optional[str] = None
    description: Optional[str] = None

class GatewaySubscription(BaseModel):
    gateway_imei: str
    name: Optional[str] = None

@router.post("/subscribe/flowmeter")
async def subscribe_to_flowmeter(subscription: FlowmeterSubscription):
    """Subscribe to a flowmeter's MQTT topic."""
    if not mqtt_service:
        raise HTTPException(status_code=503, detail="MQTT service not available")
    
    try:
        mqtt_service.subscribe_flowmeter(subscription.hardware_id)
        return {
            "success": True,
            "message": f"Subscribed to flowmeter {subscription.hardware_id}",
            "topic": f"{subscription.hardware_id}/0"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/subscribe/gateway")
async def subscribe_to_gateway(subscription: GatewaySubscription):
    """Subscribe to a gateway's MQTT topic."""
    if not mqtt_service:
        raise HTTPException(status_code=503, detail="MQTT service not available")
    
    try:
        mqtt_service.subscribe_gateway(subscription.gateway_imei)
        return {
            "success": True,
            "message": f"Subscribed to gateway {subscription.gateway_imei}",
            "topic": f"{subscription.gateway_imei}/0"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/latest/{hardware_id}")
async def get_latest_reading(hardware_id: str):
    """Get the latest reading for a specific flowmeter."""
    if not mqtt_service:
        raise HTTPException(status_code=503, detail="MQTT service not available")
    
    reading = await mqtt_service.get_latest_reading(hardware_id)
    if not reading:
        raise HTTPException(status_code=404, detail="No reading found for this flowmeter")
    
    return reading

@router.get("/latest")
async def get_all_latest_readings(user: dict = Depends(get_current_user)):
    """Get latest readings for all flowmeters (filtered by ownership for non-admin)."""
    if not mqtt_service:
        raise HTTPException(status_code=503, detail="MQTT service not available")

    readings = await mqtt_service.get_all_latest_readings()
    visible = await api_instrument_registry.visible_hardware_ids(user)
    if visible is not None:
        readings = [r for r in readings if r.get("hardware_id") in visible]
    return {"flowmeters": readings, "count": len(readings)}

@router.get("/history/{hardware_id}")
async def get_flowmeter_history(hardware_id: str, limit: int = 100):
    """Get historical readings for a flowmeter."""
    if not mqtt_service:
        raise HTTPException(status_code=503, detail="MQTT service not available")
    
    readings = await mqtt_service.get_readings_history(hardware_id, limit)
    return {"readings": readings, "count": len(readings)}

@router.get("/status")
async def get_mqtt_status():
    """Get MQTT service status."""
    if not mqtt_service:
        return {"connected": False, "message": "MQTT service not initialized"}
    
    return {
        "connected": mqtt_service.connected,
        "subscribed_topics": list(mqtt_service.subscribed_topics),
        "broker": f"{mqtt_service.broker_host}:{mqtt_service.broker_port}",
        "total_received": getattr(mqtt_service, "total_received", 0),
        "dropped_unknown": getattr(mqtt_service, "dropped_unknown", 0),
        "recent_messages": list(getattr(mqtt_service, "recent_messages", []) or [])[:50],
    }
