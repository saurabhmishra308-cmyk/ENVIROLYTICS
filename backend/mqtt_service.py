import json
import asyncio
from datetime import datetime
from typing import Dict, List, Optional
import paho.mqtt.client as mqtt
from motor.motor_asyncio import AsyncIOMotorClient
import os
from mqtt_utils import (
    parse_timestamp,
    calculate_forward_totalizer,
    calculate_reverse_totalizer,
    get_unit_name,
    convert_flow_to_lpm
)

class MQTTFlowmeterService:
    def __init__(self, mongo_client: AsyncIOMotorClient, db_name: str):
        self.db = mongo_client[db_name]
        self.client = mqtt.Client()
        self.connected = False
        self.subscribed_topics = set()
        
        # MQTT Configuration - load from environment
        self.broker_host = os.getenv('MQTT_BROKER_HOST', 'localhost')
        self.broker_port = int(os.getenv('MQTT_BROKER_PORT', '1883'))
        self.username = os.getenv('MQTT_USERNAME', '')
        self.password = os.getenv('MQTT_PASSWORD', '')
        
        # Setup callbacks
        self.client.on_connect = self.on_connect
        self.client.on_message = self.on_message
        self.client.on_disconnect = self.on_disconnect
        
    def on_connect(self, client, userdata, flags, rc):
        """Callback when connected to MQTT broker."""
        if rc == 0:
            print("✓ Connected to MQTT broker successfully")
            self.connected = True
            # Resubscribe to all topics on reconnect
            for topic in self.subscribed_topics:
                client.subscribe(topic)
                print(f"✓ Subscribed to topic: {topic}")
        else:
            print(f"✗ Connection failed with code {rc}")
            self.connected = False
    
    def on_disconnect(self, client, userdata, rc):
        """Callback when disconnected from MQTT broker."""
        print(f"⚠ Disconnected from MQTT broker (code: {rc})")
        self.connected = False
        if rc != 0:
            print("Unexpected disconnection. Attempting to reconnect...")
    
    def on_message(self, client, userdata, msg):
        """Callback when message received."""
        try:
            topic = msg.topic
            payload = msg.payload.decode('utf-8')
            
            print(f"📥 Received message on topic: {topic}")
            print(f"   Payload: {payload}")
            
            # Check if it's gateway status or flowmeter data
            if '/' in topic:
                topic_parts = topic.split('/')
                device_id = topic_parts[0]
                
                # Try to parse as JSON (flowmeter data)
                try:
                    data = json.loads(payload)
                    # Process flowmeter data
                    asyncio.create_task(self.process_flowmeter_data(device_id, data))
                except json.JSONDecodeError:
                    # Gateway status message (e.g., "0,ON")
                    asyncio.create_task(self.process_gateway_status(device_id, payload))
        except Exception as e:
            print(f"✗ Error processing message: {e}")
    
    async def process_flowmeter_data(self, hardware_id: str, data: Dict):
        """Process and store flowmeter data."""
        try:
            # Extract and parse data
            flow_lph = float(data.get('FLOW', 0))
            flow_lpm = convert_flow_to_lpm(flow_lph)
            
            tot1 = float(data.get('TOT1', 0))
            tot2 = float(data.get('TOT2', 0))
            rtot1 = float(data.get('RTOT1', 0))
            rtot2 = float(data.get('RTOT2', 0))
            
            forward_totalizer = calculate_forward_totalizer(tot1, tot2)
            reverse_totalizer = calculate_reverse_totalizer(rtot1, rtot2)
            
            unit_code = int(data.get('UNT', 2))
            unit_name = get_unit_name(unit_code)
            
            timestamp = parse_timestamp(data.get('TIME', ''))
            
            # Prepare document
            flowmeter_reading = {
                'hardware_id': hardware_id,
                'imei': data.get('IMEI', ''),
                'imsi': data.get('IMSI', ''),
                'signal_strength': int(data.get('SIGNAL', 0)),
                'timestamp': timestamp,
                'flow_rate_lph': flow_lph,
                'flow_rate_lpm': flow_lpm,
                'forward_totalizer': forward_totalizer,
                'reverse_totalizer': reverse_totalizer,
                'unit_code': unit_code,
                'unit_name': unit_name,
                'power_status': int(data.get('POW', 0)),
                'temperature': float(data.get('TEMPER', 0)),
                'firmware_version': data.get('VER', ''),
                'raw_data': data,
                'received_at': datetime.utcnow()
            }
            
            # Store in database
            result = await self.db.flowmeter_readings.insert_one(flowmeter_reading)
            print(f"✓ Stored flowmeter reading: {result.inserted_id}")
            
            # Update latest reading for quick access
            await self.db.flowmeter_latest.update_one(
                {'hardware_id': hardware_id},
                {'$set': flowmeter_reading},
                upsert=True
            )
            print(f"✓ Updated latest reading for {hardware_id}")
            
        except Exception as e:
            print(f"✗ Error processing flowmeter data: {e}")
    
    async def process_gateway_status(self, gateway_imei: str, payload: str):
        """Process gateway status message."""
        try:
            # Parse status (e.g., "0,ON")
            parts = payload.split(',')
            status = parts[1] if len(parts) > 1 else 'UNKNOWN'
            
            gateway_status = {
                'gateway_imei': gateway_imei,
                'status': status,
                'timestamp': datetime.utcnow()
            }
            
            await self.db.gateway_status.insert_one(gateway_status)
            
            # Update latest status
            await self.db.gateway_latest.update_one(
                {'gateway_imei': gateway_imei},
                {'$set': gateway_status},
                upsert=True
            )
            print(f"✓ Updated gateway status for {gateway_imei}: {status}")
            
        except Exception as e:
            print(f"✗ Error processing gateway status: {e}")
    
    def connect(self):
        """Connect to MQTT broker."""
        try:
            if self.username and self.password:
                self.client.username_pw_set(self.username, self.password)
            
            self.client.connect(self.broker_host, self.broker_port, 60)
            self.client.loop_start()
            print(f"✓ MQTT client started, connecting to {self.broker_host}:{self.broker_port}")
        except Exception as e:
            print(f"✗ Failed to connect to MQTT broker: {e}")
    
    def disconnect(self):
        """Disconnect from MQTT broker."""
        self.client.loop_stop()
        self.client.disconnect()
        print("✓ Disconnected from MQTT broker")
    
    def subscribe_gateway(self, gateway_imei: str):
        """Subscribe to gateway IMEI topic."""
        topic = f"{gateway_imei}/0"
        self.client.subscribe(topic)
        self.subscribed_topics.add(topic)
        print(f"✓ Subscribed to gateway: {topic}")
    
    def subscribe_flowmeter(self, hardware_id: str):
        """Subscribe to flowmeter hardware ID topic."""
        topic = f"{hardware_id}/0"
        self.client.subscribe(topic)
        self.subscribed_topics.add(topic)
        print(f"✓ Subscribed to flowmeter: {topic}")
    
    async def get_latest_reading(self, hardware_id: str) -> Optional[Dict]:
        """Get latest reading for a flowmeter."""
        reading = await self.db.flowmeter_latest.find_one({'hardware_id': hardware_id})
        if reading:
            reading['_id'] = str(reading['_id'])
        return reading
    
    async def get_all_latest_readings(self) -> List[Dict]:
        """Get latest readings for all flowmeters."""
        cursor = self.db.flowmeter_latest.find({})
        readings = await cursor.to_list(length=100)
        for reading in readings:
            reading['_id'] = str(reading['_id'])
        return readings
    
    async def get_readings_history(self, hardware_id: str, limit: int = 100) -> List[Dict]:
        """Get historical readings for a flowmeter."""
        cursor = self.db.flowmeter_readings.find(
            {'hardware_id': hardware_id}
        ).sort('timestamp', -1).limit(limit)
        
        readings = await cursor.to_list(length=limit)
        for reading in readings:
            reading['_id'] = str(reading['_id'])
        return readings
