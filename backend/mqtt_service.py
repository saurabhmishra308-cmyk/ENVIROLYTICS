import json
import asyncio
import ssl
from datetime import datetime, timezone
from typing import Dict, List, Optional
import paho.mqtt.client as mqtt
from motor.motor_asyncio import AsyncIOMotorClient
import os
from mqtt_utils import (
    parse_timestamp,
    calculate_forward_totalizer,
    calculate_reverse_totalizer,
    get_unit_name,
    convert_flow_to_lpm,
)


class MQTTFlowmeterService:
    def __init__(self, mongo_client: AsyncIOMotorClient, db_name: str):
        self.db = mongo_client[db_name]
        # Use MQTT v5 / VERSION1 callbacks (paho 2.x default API is v2 but we set v1 for compatibility)
        try:
            self.client = mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION1)
        except AttributeError:
            self.client = mqtt.Client()
        self.connected = False
        self.subscribed_topics = set()
        self.loop = None  # asyncio loop reference for thread-safe scheduling

        # In-memory traffic log (last 50 messages) — for the Live MQTT Traffic panel
        from collections import deque
        self.recent_messages = deque(maxlen=50)
        self.total_received = 0
        self.dropped_unknown = 0

        # MQTT Configuration - load from environment
        self.broker_host = os.getenv("MQTT_BROKER_HOST", "localhost")
        self.broker_port = int(os.getenv("MQTT_BROKER_PORT", "1883"))
        self.username = os.getenv("MQTT_USERNAME", "")
        self.password = os.getenv("MQTT_PASSWORD", "")
        self.use_tls = os.getenv("MQTT_USE_TLS", "false").lower() == "true"

        # Setup callbacks
        self.client.on_connect = self.on_connect
        self.client.on_message = self.on_message
        self.client.on_disconnect = self.on_disconnect

    def set_event_loop(self, loop):
        """Store reference to the main asyncio loop for thread-safe scheduling from MQTT thread."""
        self.loop = loop

    def on_connect(self, client, userdata, flags, rc):
        if rc == 0:
            print(f"[mqtt] Connected to broker {self.broker_host}:{self.broker_port}")
            self.connected = True
            for topic in self.subscribed_topics:
                client.subscribe(topic)
                print(f"[mqtt] Resubscribed to topic: {topic}")
        else:
            print(f"[mqtt] Connection failed with code {rc}")
            self.connected = False

    def on_disconnect(self, client, userdata, rc):
        print(f"[mqtt] Disconnected (code: {rc})")
        self.connected = False

    def on_message(self, client, userdata, msg):
        try:
            topic = msg.topic
            payload = msg.payload.decode("utf-8")
            bytes_len = len(msg.payload) if msg.payload else 0
            print(f"[mqtt] Received on {topic}: {payload[:200]}")

            self.total_received += 1

            parts = topic.split("/")
            imei_or_id = parts[0] if parts else ""
            result = "ok"
            instrument_type_for_log = None

            # Generic instrument topic: {type}/{hardware_id}/data
            if len(parts) >= 3 and parts[0].lower() in {"dwlr", "ph", "tds", "conductivity"}:
                instrument_type = parts[0].lower()
                hardware_id = parts[1]
                imei_or_id = hardware_id
                instrument_type_for_log = instrument_type
                try:
                    data = json.loads(payload)
                    if self.loop and self.loop.is_running():
                        asyncio.run_coroutine_threadsafe(
                            self.process_instrument_data(instrument_type, hardware_id, data), self.loop
                        )
                except json.JSONDecodeError:
                    print(f"[mqtt] Invalid JSON for instrument {instrument_type}/{hardware_id}")
                    result = "invalid-json"
                self._log_traffic(topic, imei_or_id, instrument_type_for_log, result, bytes_len)
                return

            # Legacy flowmeter / gateway: {device_id}/0
            if "/" in topic:
                device_id = parts[0]
                imei_or_id = device_id
                instrument_type_for_log = "flowmeter"
                try:
                    data = json.loads(payload)
                    if self.loop and self.loop.is_running():
                        asyncio.run_coroutine_threadsafe(
                            self.process_flowmeter_data(device_id, data), self.loop
                        )
                except json.JSONDecodeError:
                    result = "gateway-status"
                    instrument_type_for_log = "gateway"
                    if self.loop and self.loop.is_running():
                        asyncio.run_coroutine_threadsafe(
                            self.process_gateway_status(device_id, payload), self.loop
                        )
                self._log_traffic(topic, imei_or_id, instrument_type_for_log, result, bytes_len)
                return

            # Unknown topic shape
            self.dropped_unknown += 1
            self._log_traffic(topic, imei_or_id, None, "dropped-unknown-topic", bytes_len)
        except Exception as e:
            print(f"[mqtt] Error processing message: {e}")

    def _log_traffic(self, topic: str, imei: str, device_type, result: str, bytes_len: int):
        try:
            self.recent_messages.appendleft({
                "time": datetime.now(timezone.utc).isoformat(),
                "topic": topic,
                "imei": imei,
                "device": device_type,
                "result": result,
                "bytes": bytes_len,
            })
        except Exception:
            pass

    async def process_instrument_data(self, instrument_type: str, hardware_id: str, data: Dict):
        """Generic instrument reading handler."""
        try:
            now_iso = datetime.now(timezone.utc).isoformat()
            doc = {
                "instrument_type": instrument_type,
                "hardware_id": hardware_id,
                "values": data,
                "timestamp": data.get("TIME") or now_iso,
                "received_at": now_iso,
            }
            await self.db.instrument_readings.insert_one(dict(doc))
            await self.db.instrument_latest.update_one(
                {"instrument_type": instrument_type, "hardware_id": hardware_id},
                {"$set": doc},
                upsert=True,
            )
            print(f"[mqtt] Stored {instrument_type} reading for {hardware_id}")
        except Exception as e:
            print(f"[mqtt] Error processing instrument data: {e}")

    async def process_flowmeter_data(self, hardware_id: str, data: Dict):
        try:
            flow_lph = float(data.get("FLOW", 0))
            flow_lpm = convert_flow_to_lpm(flow_lph)

            tot1 = float(data.get("TOT1", 0))
            tot2 = float(data.get("TOT2", 0))
            rtot1 = float(data.get("RTOT1", 0))
            rtot2 = float(data.get("RTOT2", 0))

            forward_totalizer = calculate_forward_totalizer(tot1, tot2)
            reverse_totalizer = calculate_reverse_totalizer(rtot1, rtot2)

            unit_code = int(data.get("UNT", 2))
            unit_name = get_unit_name(unit_code)

            timestamp = parse_timestamp(data.get("TIME", ""))
            # Ensure timestamp is ISO string for safe JSON
            if isinstance(timestamp, datetime):
                timestamp_iso = timestamp.isoformat()
            else:
                timestamp_iso = str(timestamp)

            reading = {
                "hardware_id": hardware_id,
                "imei": data.get("IMEI", ""),
                "imsi": data.get("IMSI", ""),
                "signal_strength": int(data.get("SIGNAL", 0)),
                "timestamp": timestamp_iso,
                "flow_rate_lph": flow_lph,
                "flow_rate_lpm": flow_lpm,
                "forward_totalizer": forward_totalizer,
                "reverse_totalizer": reverse_totalizer,
                "unit_code": unit_code,
                "unit_name": unit_name,
                "power_status": int(data.get("POW", 0)),
                "temperature": float(data.get("TEMPER", 0)),
                "firmware_version": data.get("VER", ""),
                "received_at": datetime.now(timezone.utc).isoformat(),
            }

            await self.db.flowmeter_readings.insert_one(dict(reading))
            await self.db.flowmeter_latest.update_one(
                {"hardware_id": hardware_id},
                {"$set": reading},
                upsert=True,
            )
            print(f"[mqtt] Stored reading for {hardware_id} ({flow_lph} L/h)")
        except Exception as e:
            print(f"[mqtt] Error processing flowmeter data: {e}")

    async def process_gateway_status(self, gateway_imei: str, payload: str):
        try:
            parts = payload.split(",")
            status = parts[1] if len(parts) > 1 else "UNKNOWN"
            doc = {
                "gateway_imei": gateway_imei,
                "status": status,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            await self.db.gateway_status.insert_one(dict(doc))
            await self.db.gateway_latest.update_one(
                {"gateway_imei": gateway_imei}, {"$set": doc}, upsert=True
            )
            print(f"[mqtt] Gateway {gateway_imei} status: {status}")
        except Exception as e:
            print(f"[mqtt] Error processing gateway status: {e}")

    def connect(self):
        try:
            if self.username and self.password:
                self.client.username_pw_set(self.username, self.password)
            if self.use_tls:
                self.client.tls_set(cert_reqs=ssl.CERT_REQUIRED, tls_version=ssl.PROTOCOL_TLSv1_2)
                self.client.tls_insecure_set(False)
                print(f"[mqtt] TLS enabled for {self.broker_host}:{self.broker_port}")
            self.client.connect_async(self.broker_host, self.broker_port, 60)
            self.client.loop_start()
            print(f"[mqtt] Client started, connecting to {self.broker_host}:{self.broker_port}")
        except Exception as e:
            print(f"[mqtt] Failed to connect: {e}")

    def disconnect(self):
        try:
            self.client.loop_stop()
            self.client.disconnect()
        except Exception:
            pass
        print("[mqtt] Disconnected")

    def subscribe_gateway(self, gateway_imei: str):
        topic = f"{gateway_imei}/0"
        self.client.subscribe(topic)
        self.subscribed_topics.add(topic)
        print(f"[mqtt] Subscribed to gateway: {topic}")

    def subscribe_flowmeter(self, hardware_id: str):
        topic = f"{hardware_id}/0"
        self.client.subscribe(topic)
        self.subscribed_topics.add(topic)
        print(f"[mqtt] Subscribed to flowmeter: {topic}")

    def subscribe_topic(self, topic: str, instrument_type: str = None):
        """Generic subscription helper for any topic."""
        self.client.subscribe(topic)
        self.subscribed_topics.add(topic)
        label = f" ({instrument_type})" if instrument_type else ""
        print(f"[mqtt] Subscribed to topic{label}: {topic}")

    def publish(self, topic: str, payload: str, qos: int = 0):
        """Publish a payload to a topic (used by the test/ingest endpoint)."""
        if not self.connected:
            raise RuntimeError("MQTT not connected")
        info = self.client.publish(topic, payload, qos=qos)
        return {"rc": info.rc, "mid": info.mid}

    async def get_latest_reading(self, hardware_id: str) -> Optional[Dict]:
        reading = await self.db.flowmeter_latest.find_one({"hardware_id": hardware_id})
        if reading:
            reading["_id"] = str(reading["_id"])
        return reading

    async def get_all_latest_readings(self) -> List[Dict]:
        cursor = self.db.flowmeter_latest.find({}).limit(100)
        readings = await cursor.to_list(length=100)
        for r in readings:
            r["_id"] = str(r["_id"])
        return readings

    async def get_readings_history(self, hardware_id: str, limit: int = 100) -> List[Dict]:
        cursor = self.db.flowmeter_readings.find({"hardware_id": hardware_id}).sort(
            "timestamp", -1
        ).limit(limit)
        readings = await cursor.to_list(length=limit)
        for r in readings:
            r["_id"] = str(r["_id"])
        return readings
