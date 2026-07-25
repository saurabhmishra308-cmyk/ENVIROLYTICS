"""MQTT ingestion service for Envirolytics Monitor.

Broker: skyrise.online:1490 (plain TCP with auth).

Payload conventions from the field device:
  • Flowmeter topic:   `{id}/0`      → JSON with FLOW, TOT1/TOT2, RTOT1/RTOT2, IMEI, …
  • DWLR/Piezo topic:  `P{id}/0`     → JSON with LEVEL, IMEI, TIME, SIGNAL, UNT, …

The topic `id` is a device-side identifier that we don't need to know in
advance. **Devices are matched to their registry entry by the IMEI carried in
the JSON payload**, so admins register each physical instrument with its IMEI
via the Create-User wizard / Instruments page. Messages whose IMEI is not
registered are dropped with a log warning.

Reserved formulas (per hardware spec):
  Forward Totalizer = (TOT2 * 65535) + TOT1
  Reverse Totalizer = (RTOT2 * 65535) + RTOT1
"""
import json
import asyncio
import re
import ssl
from collections import deque
from datetime import datetime, timezone, timedelta
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
    # Size of the in-memory rolling buffer used to expose recent MQTT traffic
    # to the admin UI (via GET /api/flowmeter/traffic).
    RECENT_BUFFER_SIZE = 50

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

        # Rolling buffer of the last N messages seen by this backend — used by
        # the admin "Live MQTT Traffic" panel. Each entry is a small dict; no
        # payload body is stored (only metadata + a truncated preview) to keep
        # memory bounded even under high message rates.
        self.recent_messages: deque = deque(maxlen=self.RECENT_BUFFER_SIZE)
        self._recv_counter: int = 0
        self._dropped_unknown_counter: int = 0

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
            # Universal wildcard — matches both `{id}/0` (flowmeter) and `P{id}/0` (DWLR)
            # since MQTT `+` matches a single topic level regardless of the prefix chars.
            wildcard = "+/0"
            client.subscribe(wildcard)
            self.subscribed_topics.add(wildcard)
            print(f"[mqtt] Subscribed to wildcard: {wildcard} (matches flowmeter + DWLR topics)")
            # Re-subscribe to any per-device topics registered earlier
            for topic in self.subscribed_topics:
                if topic == wildcard:
                    continue
                client.subscribe(topic)
                print(f"[mqtt] Resubscribed to topic: {topic}")
        else:
            # rc reference: 1=bad proto, 2=bad client id, 3=server unavailable,
            #               4=bad user/pass, 5=not authorised
            reason = {
                1: "incorrect protocol version",
                2: "invalid client identifier",
                3: "server unavailable",
                4: "bad username or password",
                5: "not authorised",
            }.get(rc, "unknown")
            print(f"[mqtt] Connection failed (code={rc}, reason={reason})")
            self.connected = False

    def on_disconnect(self, client, userdata, rc):
        print(f"[mqtt] Disconnected (code: {rc})")
        self.connected = False

    @staticmethod
    def _extract_json(payload: str) -> Optional[Dict]:
        """Parse the payload robustly. Devices publish pure JSON, but defensively we
        also handle a leading timestamp/preamble line before the JSON object.
        Returns dict on success, None on failure."""
        payload = (payload or "").strip()
        if not payload:
            return None
        # Fast path: already a JSON object
        try:
            data = json.loads(payload)
            return data if isinstance(data, dict) else None
        except json.JSONDecodeError:
            pass
        # Try to locate the first '{' … '}' block
        m = re.search(r"\{.*\}", payload, flags=re.DOTALL)
        if not m:
            return None
        try:
            data = json.loads(m.group(0))
            return data if isinstance(data, dict) else None
        except json.JSONDecodeError:
            return None

    def on_message(self, client, userdata, msg):
        try:
            topic = msg.topic
            raw = msg.payload.decode("utf-8", errors="replace")
            print(f"[mqtt] Recv topic={topic} bytes={len(raw)}")
            self._on_message_sync(topic, raw)
        except Exception as e:  # noqa: BLE001
            print(f"[mqtt] Error processing message: {e}")

    def _record(self, topic: str, imei: Optional[str], raw_bytes: int,
                dispatched: bool, hardware_id: Optional[str] = None,
                instrument_type: Optional[str] = None, reason: Optional[str] = None,
                source: str = "mqtt", preview: Optional[str] = None):
        """Append an entry to the recent-traffic buffer. Called from both the
        live MQTT handler and the simulate endpoint."""
        self._recv_counter += 1
        if not dispatched:
            self._dropped_unknown_counter += 1
        entry = {
            "seq": self._recv_counter,
            "ts": datetime.now(timezone.utc).isoformat(),
            "source": source,               # "mqtt" | "simulate"
            "topic": topic,
            "bytes": raw_bytes,
            "imei": imei,
            "dispatched": dispatched,
            "hardware_id": hardware_id,
            "instrument_type": instrument_type,
            "reason": reason,
            "preview": (preview[:160] + "…") if preview and len(preview) > 160 else preview,
        }
        self.recent_messages.appendleft(entry)

    def _on_message_sync(self, topic: str, raw: str):
        """Route a raw (topic, payload) tuple through the async dispatcher.

        Kept separate from `on_message` so it can be called from the simulation
        endpoint. Uses the stored asyncio loop to schedule the coroutine.
        """
        data = self._extract_json(raw)
        if data is None:
            self._record(topic, None, len(raw or ""), False,
                         reason="payload is not valid JSON",
                         source="mqtt", preview=raw)
            print(f"[mqtt] Non-JSON payload dropped for topic {topic}: {raw[:120]!r}")
            return

        imei = str(data.get("IMEI") or data.get("imei") or "").strip()
        if not imei:
            self._record(topic, None, len(raw or ""), False,
                         reason="payload missing IMEI field",
                         source="mqtt", preview=raw)
            print(f"[mqtt] Payload missing IMEI, dropped. topic={topic} preview={raw[:120]!r}")
            return

        first_level = topic.split("/", 1)[0] if topic else ""
        is_dwlr = first_level.startswith(("P", "p"))
        instrument_type = "dwlr" if is_dwlr else "flowmeter"

        if not (self.loop and self.loop.is_running()):
            return

        asyncio.run_coroutine_threadsafe(
            self._dispatch_and_record(instrument_type, imei, topic, data, raw),
            self.loop,
        )

    async def _dispatch_and_record(self, instrument_type: str, imei: str,
                                    topic: str, data: Dict, raw: str):
        """Async wrapper that records the outcome after dispatch."""
        raw_len = len(raw or "")
        reg = await self.db.instrument_registry.find_one(
            {"imei": imei},
            {"_id": 0, "hardware_id": 1, "instrument_type": 1, "label": 1},
        )
        if not reg:
            self._record(topic, imei, raw_len, False,
                         reason=f"IMEI {imei} not registered — add it in the Instruments page",
                         source="mqtt", preview=raw)
            print(f"[mqtt] Unknown IMEI {imei} (topic={topic}) — drop. Register this device in the Instruments page.")
            return

        hardware_id = reg["hardware_id"]
        reg_type = (reg.get("instrument_type") or instrument_type).lower()

        try:
            if reg_type == "flowmeter":
                await self.process_flowmeter_data(hardware_id, data)
            elif reg_type == "dwlr":
                await self.process_instrument_data("dwlr", hardware_id, data)
            else:
                await self.process_instrument_data(reg_type, hardware_id, data)
            self._record(topic, imei, raw_len, True,
                         hardware_id=hardware_id, instrument_type=reg_type,
                         source="mqtt", preview=raw)
        except Exception as e:  # noqa: BLE001
            self._record(topic, imei, raw_len, False,
                         hardware_id=hardware_id, instrument_type=reg_type,
                         reason=f"storage error: {e}", source="mqtt", preview=raw)

    async def simulate_incoming(self, topic: str, payload: str) -> Dict:
        """Await-safe end-to-end simulation of an incoming MQTT publish.

        Runs identical parsing, IMEI-lookup and storage as the live pipeline and
        returns a detailed dispatch report. Used by the admin `mqtt-simulate`
        endpoint to prove the ingestion path works without needing a broker.
        Also appends to the recent-traffic buffer so simulated messages show
        up in the Live MQTT Traffic panel with `source: "simulate"`.
        """
        raw_len = len(payload or "")
        data = self._extract_json(payload)
        if data is None:
            self._record(topic, None, raw_len, False,
                         reason="payload is not valid JSON",
                         source="simulate", preview=payload)
            return {"dispatched": False, "reason": "payload is not valid JSON"}

        imei = str(data.get("IMEI") or data.get("imei") or "").strip()
        if not imei:
            self._record(topic, None, raw_len, False,
                         reason="payload missing IMEI field",
                         source="simulate", preview=payload)
            return {"dispatched": False, "reason": "payload missing IMEI field"}

        first_level = topic.split("/", 1)[0] if topic else ""
        is_dwlr = first_level.startswith(("P", "p"))
        topic_inferred_type = "dwlr" if is_dwlr else "flowmeter"

        reg = await self.db.instrument_registry.find_one(
            {"imei": imei},
            {"_id": 0, "hardware_id": 1, "instrument_type": 1, "owner_user_id": 1, "label": 1},
        )
        if not reg:
            self._record(topic, imei, raw_len, False,
                         reason=f"IMEI {imei} not registered — add it in the Instruments page",
                         source="simulate", preview=payload)
            return {
                "dispatched": False,
                "reason": f"IMEI '{imei}' is not registered — add it to an instrument in the registry",
                "topic": topic,
                "topic_inferred_type": topic_inferred_type,
            }

        hardware_id = reg["hardware_id"]
        reg_type = (reg.get("instrument_type") or topic_inferred_type).lower()

        try:
            if reg_type == "flowmeter":
                await self.process_flowmeter_data(hardware_id, data)
            elif reg_type == "dwlr":
                await self.process_instrument_data("dwlr", hardware_id, data)
            else:
                await self.process_instrument_data(reg_type, hardware_id, data)
            self._record(topic, imei, raw_len, True,
                         hardware_id=hardware_id, instrument_type=reg_type,
                         source="simulate", preview=payload)
        except Exception as e:  # noqa: BLE001
            self._record(topic, imei, raw_len, False,
                         hardware_id=hardware_id, instrument_type=reg_type,
                         reason=f"storage error: {e}", source="simulate", preview=payload)
            return {"dispatched": False, "reason": f"storage error: {e}"}

        return {
            "dispatched": True,
            "topic": topic,
            "topic_inferred_type": topic_inferred_type,
            "hardware_id": hardware_id,
            "instrument_type": reg_type,
            "owner_user_id": reg.get("owner_user_id"),
            "label": reg.get("label"),
            "imei": imei,
        }

    def get_traffic(self, limit: int = 50) -> Dict:
        """Return the recent-message buffer + a few live counters, for the
        admin 'Live MQTT Traffic' panel."""
        items = list(self.recent_messages)[: max(1, min(limit, self.RECENT_BUFFER_SIZE))]
        # Distinct unregistered IMEIs seen recently — makes it easy for the
        # admin to click "register this" from the UI.
        unknown = {}
        for e in items:
            if not e.get("dispatched") and e.get("imei") and e.get("reason", "").startswith("IMEI "):
                imei = e["imei"]
                if imei not in unknown:
                    unknown[imei] = {"imei": imei, "topic": e["topic"], "last_seen": e["ts"], "count": 1}
                else:
                    unknown[imei]["count"] += 1
        return {
            "recent": items,
            "total_received": self._recv_counter,
            "total_dropped_unknown": self._dropped_unknown_counter,
            "unregistered_imeis": list(unknown.values()),
            "connected": self.connected,
            "subscribed_topics": list(self.subscribed_topics),
            "broker": f"{self.broker_host}:{self.broker_port}",
        }

    async def _should_store_reading(self, kind: str, hardware_id: str) -> bool:
        """Return True when a new reading is due to be *persisted* for this
        device, according to the admin-configured
        `data_frequency_minutes` on the registry.

        The `_latest` collections are *always* updated regardless — the
        dashboard live tile has to reflect the current reading. This method
        only gates the append-only history collections so admins can
        down-sample noisy devices (e.g. keep one row per hour instead of
        one per 30 seconds).

        `kind` is either `"instrument"` or `"flowmeter"`.
        """
        reg = await self.db.instrument_registry.find_one(
            {"hardware_id": hardware_id}, {"data_frequency_minutes": 1}
        )
        freq = (reg or {}).get("data_frequency_minutes")
        if not freq:
            return True  # No throttling configured — store every reading.
        try:
            freq_minutes = int(freq)
        except (TypeError, ValueError):
            return True
        if freq_minutes <= 0:
            return True

        coll = self.db.flowmeter_readings if kind == "flowmeter" else self.db.instrument_readings
        last = await coll.find_one(
            {"hardware_id": hardware_id},
            {"received_at": 1, "timestamp": 1, "_id": 0},
            sort=[("received_at", -1)],
        )
        if not last:
            return True

        last_ts_str = last.get("received_at") or last.get("timestamp")
        if not last_ts_str:
            return True
        try:
            last_ts = datetime.fromisoformat(str(last_ts_str).replace("Z", "+00:00"))
        except ValueError:
            return True
        elapsed = datetime.now(timezone.utc) - last_ts
        return elapsed >= timedelta(minutes=freq_minutes)

    async def process_instrument_data(self, instrument_type: str, hardware_id: str, data: Dict):
        """Generic instrument reading handler.

        Water level can arrive as either `LEVEL` (older firmware, topic P<id>/0
        with 8-field payload) or `LVL` (newer firmware, topic P<id>/0 with
        expanded 19-field payload including WTEMP, ATEMP, BVOLT, etc.). Both
        formats are normalised in-place so downstream consumers just read
        `values.LEVEL`.

        Water temperature: newer firmware sends `WTEMP` (only meaningful when
        `WT_Enbl > 0`). When absent or zero, we fall back to the admin-set
        `manual_water_temp_c` on the instrument registry (handled by the API
        enrichment step, not here).
        """
        try:
            values = dict(data)

            # --- String → number coercion for known fields (device sends as strings)
            float_fields = (
                "LEVEL", "LVL", "RAW", "WTEMP", "ATEMP", "BVOLT",
                "D_SEN", "E_COM", "P_SEN", "APRES", "GINT", "SDINT",
                "HVER", "WT_Enbl", "UNT", "HID", "FLOW",
            )
            for f in float_fields:
                if f in values and values[f] is not None and values[f] != "":
                    try:
                        values[f] = float(values[f])
                    except (TypeError, ValueError):
                        pass
            # SIGNAL is always integer
            if "SIGNAL" in values and values["SIGNAL"] is not None:
                try:
                    values["SIGNAL"] = int(float(values["SIGNAL"]))
                except (TypeError, ValueError):
                    pass

            # --- Back-compat: unify LVL → LEVEL so every dashboard/query reads a
            # single canonical field. If both are present, LVL wins (it's the
            # newer firmware's authoritative field).
            if "LVL" in values and isinstance(values["LVL"], (int, float)):
                values["LEVEL"] = values["LVL"]
            elif "LEVEL" in values and isinstance(values["LEVEL"], (int, float)):
                # Also mirror the other way so both keys always resolve consistently.
                values["LVL"] = values["LEVEL"]

            now_iso = datetime.now(timezone.utc).isoformat()
            # Prefer the vendor's `TIME` field ("YYMMDDHHMMSS") so downstream
            # views (reports, live traffic, history) show *when the device
            # actually captured the reading* — not the ingestion time. Falls
            # back to `now_iso` when the field is missing or malformed.
            raw_time = str(data.get("TIME") or "").strip()
            if raw_time and len(raw_time) >= 12 and raw_time.isdigit():
                try:
                    ts_dt = parse_timestamp(raw_time).replace(tzinfo=timezone.utc)
                    ts_iso = ts_dt.isoformat()
                except Exception:  # noqa: BLE001
                    ts_iso = now_iso
            else:
                ts_iso = now_iso
            doc = {
                "instrument_type": instrument_type,
                "hardware_id": hardware_id,
                "imei": str(data.get("IMEI") or data.get("imei") or "").strip() or None,
                "values": values,
                "timestamp": ts_iso,
                "received_at": now_iso,
            }
            # Down-sample: only persist to history if enough time has elapsed
            # since the last stored reading, per registry.data_frequency_minutes.
            if await self._should_store_reading("instrument", hardware_id):
                await self.db.instrument_readings.insert_one(dict(doc))
            await self.db.instrument_latest.update_one(
                {"instrument_type": instrument_type, "hardware_id": hardware_id},
                {"$set": doc},
                upsert=True,
            )
            print(
                f"[mqtt] Stored {instrument_type} reading for {hardware_id} "
                f"(LEVEL={values.get('LEVEL')}, WTEMP={values.get('WTEMP')}, "
                f"BVOLT={values.get('BVOLT')})"
            )
        except Exception as e:  # noqa: BLE001
            print(f"[mqtt] Error processing instrument data: {e}")

    async def process_flowmeter_data(self, hardware_id: str, data: Dict):
        try:
            flow_lph = float(data.get("FLOW", 0) or 0)
            flow_lpm = convert_flow_to_lpm(flow_lph)

            tot1 = float(data.get("TOT1", 0) or 0)
            tot2 = float(data.get("TOT2", 0) or 0)
            rtot1 = float(data.get("RTOT1", 0) or 0)
            rtot2 = float(data.get("RTOT2", 0) or 0)

            forward_totalizer = calculate_forward_totalizer(tot1, tot2)
            reverse_totalizer = calculate_reverse_totalizer(rtot1, rtot2)

            # Device sends UNT (or older UNIT). Accept both. Coerce float→int.
            unit_raw = data.get("UNT", data.get("UNIT", 2))
            try:
                unit_code = int(float(unit_raw))
            except (TypeError, ValueError):
                unit_code = 2
            unit_name = get_unit_name(unit_code)

            timestamp = parse_timestamp(data.get("TIME", ""))
            if isinstance(timestamp, datetime) and timestamp.tzinfo is None:
                timestamp = timestamp.replace(tzinfo=timezone.utc)
            timestamp_iso = timestamp.isoformat() if isinstance(timestamp, datetime) else str(timestamp)

            reading = {
                "hardware_id": hardware_id,
                "imei": str(data.get("IMEI", "") or "").strip(),
                "imsi": str(data.get("IMSI", "") or "").strip(),
                "signal_strength": int(float(data.get("SIGNAL", 0) or 0)),
                "timestamp": timestamp_iso,
                "flow_rate_lph": flow_lph,
                "flow_rate_lpm": flow_lpm,
                "tot1": tot1,
                "tot2": tot2,
                "rtot1": rtot1,
                "rtot2": rtot2,
                "forward_totalizer": forward_totalizer,
                "reverse_totalizer": reverse_totalizer,
                "unit_code": unit_code,
                "unit_name": unit_name,
                "power_status": int(float(data.get("POW", 0) or 0)),
                "temperature": float(data.get("TEMPER", 0) or 0),
                "firmware_version": data.get("VER", ""),
                "received_at": datetime.now(timezone.utc).isoformat(),
            }

            if await self._should_store_reading("flowmeter", hardware_id):
                await self.db.flowmeter_readings.insert_one(dict(reading))
            await self.db.flowmeter_latest.update_one(
                {"hardware_id": hardware_id},
                {"$set": reading},
                upsert=True,
            )
            print(
                f"[mqtt] Stored flowmeter {hardware_id}: FLOW={flow_lph}L/H "
                f"FWD={forward_totalizer} REV={reverse_totalizer}"
            )
        except Exception as e:  # noqa: BLE001
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
        except Exception as e:  # noqa: BLE001
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
            print(f"[mqtt] Client started, connecting to {self.broker_host}:{self.broker_port} (user={self.username or 'anonymous'})")
        except Exception as e:  # noqa: BLE001
            print(f"[mqtt] Failed to connect: {e}")

    def disconnect(self):
        try:
            self.client.loop_stop()
            self.client.disconnect()
        except Exception:
            pass
        print("[mqtt] Disconnected")

    def subscribe_gateway(self, gateway_imei: str):
        # Kept for backward compatibility with legacy `/api/flowmeter/subscribe/gateway`.
        # The wildcard `+/0` already covers this.
        topic = f"{gateway_imei}/0"
        self.subscribed_topics.add(topic)
        if self.connected:
            self.client.subscribe(topic)
        print(f"[mqtt] (noop-under-wildcard) requested gateway subscription: {topic}")

    def subscribe_flowmeter(self, hardware_id: str):
        # Kept for backward compatibility with legacy /api/instrument-registry hooks.
        # The wildcard `+/0` catches every device automatically; per-device
        # subscribes now depend on the device-side ID (which we don't store).
        # Track locally so status endpoints report expected devices.
        topic = f"{hardware_id}/0"
        self.subscribed_topics.add(topic)
        if self.connected:
            self.client.subscribe(topic)
        print(f"[mqtt] (already covered by +/0 wildcard) noted flowmeter topic: {topic}")

    def subscribe_topic(self, topic: str, instrument_type: str = None):
        """Generic subscription helper. Safe to call — wildcard already covers `+/0`."""
        self.subscribed_topics.add(topic)
        if self.connected:
            self.client.subscribe(topic)
        label = f" ({instrument_type})" if instrument_type else ""
        print(f"[mqtt] Subscribed to topic{label}: {topic}")

    def publish(self, topic: str, payload: str, qos: int = 0):
        """Publish a payload to a topic (used by the test/ingest endpoint)."""
        if not self.connected:
            raise RuntimeError("MQTT not connected")
        info = self.client.publish(topic, payload, qos=qos)
        return {"rc": info.rc, "mid": info.mid}

    async def get_latest_reading(self, hardware_id: str) -> Optional[Dict]:
        reading = await self.db.flowmeter_latest.find_one(
            {"hardware_id": hardware_id, "_dummy": {"$ne": True}}
        )
        if reading:
            reading["_id"] = str(reading["_id"])
        return reading

    async def get_all_latest_readings(self) -> List[Dict]:
        cursor = self.db.flowmeter_latest.find({"_dummy": {"$ne": True}}).limit(100)
        readings = await cursor.to_list(length=100)
        for r in readings:
            r["_id"] = str(r["_id"])
        return readings

    async def get_readings_history(self, hardware_id: str, limit: int = 100) -> List[Dict]:
        cursor = self.db.flowmeter_readings.find(
            {"hardware_id": hardware_id, "_dummy": {"$ne": True}}
        ).sort(
            "received_at", -1
        ).limit(limit)
        readings = await cursor.to_list(length=limit)
        for r in readings:
            r["_id"] = str(r["_id"])
        return readings
