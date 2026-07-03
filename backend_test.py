#!/usr/bin/env python3
"""
Test script for Live MQTT Traffic Monitor endpoint
GET /api/flowmeter/traffic?limit=50

Test cases:
1. Auth tests (no-auth, non-admin, admin)
2. Live traffic captured (wait for real MQTT message)
3. Simulate message shows up tagged as "simulate"
4. Dispatched (success) case after registering device
5. Buffer size cap (50 entries)
6. Limit parameter
7. Missing IMEI / non-JSON entries
8. Regression tests
"""

import requests
import time
import json
from datetime import datetime

# Backend URL
BASE_URL = "https://envirolytics-hub.preview.emergentagent.com/api"

# Test credentials
ADMIN_EMAIL = "admin@envirolytics.com"
ADMIN_PASSWORD = "Admin@Envirolytics2026"

# Test data
TEST_IMEI_REAL = "860738070478155"  # Real device IMEI from logs
TEST_IMEI_FAKE = "999999999999999"  # Fake IMEI for testing

class TestResults:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.tests = []
    
    def add(self, name, passed, details=""):
        self.tests.append({"name": name, "passed": passed, "details": details})
        if passed:
            self.passed += 1
            print(f"✅ {name}")
        else:
            self.failed += 1
            print(f"❌ {name}")
        if details:
            print(f"   {details}")
    
    def summary(self):
        total = self.passed + self.failed
        print(f"\n{'='*80}")
        print(f"TEST SUMMARY: {self.passed}/{total} passed")
        print(f"{'='*80}")
        for test in self.tests:
            status = "✅" if test["passed"] else "❌"
            print(f"{status} {test['name']}")
            if test["details"]:
                print(f"   {test['details']}")

results = TestResults()

def login(email, password):
    """Login and return JWT token"""
    response = requests.post(f"{BASE_URL}/auth/login", json={
        "email": email,
        "password": password
    })
    if response.status_code == 200:
        return response.json().get("access_token")
    return None

def create_test_user(admin_token):
    """Create a test client user"""
    response = requests.post(
        f"{BASE_URL}/admin/users/create",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "email": f"traffic_test_{int(time.time())}@example.com",
            "password": "TestPass123!",
            "full_name": "Traffic Test User",
            "role": "client",
            "location_name": "Test Location",
            "latitude": 26.8467,
            "longitude": 80.9462
        }
    )
    if response.status_code == 200:
        return response.json().get("user", {}).get("id")
    return None

def register_instrument(admin_token, hardware_id, imei, instrument_type, owner_user_id):
    """Register an instrument with IMEI"""
    response = requests.post(
        f"{BASE_URL}/instrument-registry",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "hardware_id": hardware_id,
            "imei": imei,
            "instrument_type": instrument_type,
            "label": f"Test {instrument_type} {hardware_id}",
            "owner_user_id": owner_user_id,
            "location_name": "Test Location",
            "latitude": 26.8467,
            "longitude": 80.9462
        }
    )
    return response.status_code == 200

def simulate_mqtt_message(admin_token, topic, payload):
    """Simulate an MQTT message"""
    response = requests.post(
        f"{BASE_URL}/devices/mqtt-simulate",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "topic": topic,
            "payload": payload
        }
    )
    return response

def get_traffic(token, limit=50):
    """Get MQTT traffic"""
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    response = requests.get(
        f"{BASE_URL}/flowmeter/traffic",
        headers=headers,
        params={"limit": limit}
    )
    return response

def cleanup_instrument(admin_token, hardware_id):
    """Delete test instrument"""
    requests.delete(
        f"{BASE_URL}/instrument-registry/{hardware_id}",
        headers={"Authorization": f"Bearer {admin_token}"}
    )

def cleanup_user(admin_token, user_id):
    """Delete test user"""
    requests.delete(
        f"{BASE_URL}/admin/users/{user_id}",
        headers={"Authorization": f"Bearer {admin_token}"}
    )

print("="*80)
print("LIVE MQTT TRAFFIC MONITOR ENDPOINT TEST")
print("="*80)

# ============================================================================
# TEST 1: AUTH - No Token
# ============================================================================
print("\n[TEST 1] Auth - No Token")
response = get_traffic(None)
results.add(
    "No-auth GET returns 401",
    response.status_code == 401,
    f"Status: {response.status_code}"
)

# ============================================================================
# SETUP: Login as admin
# ============================================================================
print("\n[SETUP] Login as admin")
admin_token = login(ADMIN_EMAIL, ADMIN_PASSWORD)
if not admin_token:
    print("❌ FATAL: Admin login failed")
    exit(1)
print(f"✅ Admin logged in")

# ============================================================================
# TEST 2: AUTH - Non-Admin
# ============================================================================
print("\n[TEST 2] Auth - Non-Admin")
test_user_id = create_test_user(admin_token)
if test_user_id:
    print(f"✅ Created test user: {test_user_id}")
    # Login as client
    client_token = login(f"traffic_test_{int(time.time())}@example.com", "TestPass123!")
    if client_token:
        response = get_traffic(client_token)
        results.add(
            "Non-admin GET returns 403 with 'Admin only' message",
            response.status_code == 403 and "Admin only" in response.text,
            f"Status: {response.status_code}, Body: {response.text[:100]}"
        )
    else:
        results.add("Non-admin GET returns 403", False, "Failed to login as client")
else:
    results.add("Non-admin GET returns 403", False, "Failed to create test user")

# ============================================================================
# TEST 3: AUTH - Admin Success
# ============================================================================
print("\n[TEST 3] Auth - Admin Success")
response = get_traffic(admin_token)
results.add(
    "Admin GET returns 200 with correct schema",
    response.status_code == 200,
    f"Status: {response.status_code}"
)

if response.status_code == 200:
    data = response.json()
    required_fields = ["connected", "broker", "subscribed_topics", "total_received", 
                      "total_dropped_unknown", "unregistered_imeis", "recent"]
    has_all_fields = all(field in data for field in required_fields)
    results.add(
        "Response has all required fields",
        has_all_fields,
        f"Fields: {list(data.keys())}"
    )
    
    print(f"   Connected: {data.get('connected')}")
    print(f"   Broker: {data.get('broker')}")
    print(f"   Total received: {data.get('total_received')}")
    print(f"   Total dropped: {data.get('total_dropped_unknown')}")
    print(f"   Unregistered IMEIs: {len(data.get('unregistered_imeis', []))}")
    print(f"   Recent messages: {len(data.get('recent', []))}")

# ============================================================================
# TEST 4: Live Traffic Captured
# ============================================================================
print("\n[TEST 4] Live Traffic Captured")
print("Waiting 5 seconds for real MQTT message...")
time.sleep(5)

response = get_traffic(admin_token, limit=50)
if response.status_code == 200:
    data = response.json()
    total_received = data.get("total_received", 0)
    recent = data.get("recent", [])
    
    results.add(
        "total_received >= 1",
        total_received >= 1,
        f"Total received: {total_received}"
    )
    
    results.add(
        "recent[] is non-empty",
        len(recent) > 0,
        f"Recent messages: {len(recent)}"
    )
    
    # Check for real MQTT messages
    mqtt_messages = [m for m in recent if m.get("source") == "mqtt"]
    results.add(
        "At least one message with source='mqtt'",
        len(mqtt_messages) > 0,
        f"MQTT messages: {len(mqtt_messages)}"
    )
    
    # Check for expected IMEI
    imei_messages = [m for m in recent if m.get("imei") == TEST_IMEI_REAL]
    if len(imei_messages) > 0:
        msg = imei_messages[0]
        print(f"   Found message with IMEI {TEST_IMEI_REAL}:")
        print(f"   - Topic: {msg.get('topic')}")
        print(f"   - Dispatched: {msg.get('dispatched')}")
        print(f"   - Reason: {msg.get('reason')}")
        
        results.add(
            f"Message with IMEI {TEST_IMEI_REAL} has dispatched=false",
            msg.get("dispatched") == False,
            f"Dispatched: {msg.get('dispatched')}"
        )
        
        results.add(
            f"Reason starts with 'IMEI {TEST_IMEI_REAL} not registered'",
            msg.get("reason", "").startswith(f"IMEI {TEST_IMEI_REAL} not registered"),
            f"Reason: {msg.get('reason')}"
        )
    
    # Check unregistered_imeis
    unregistered = data.get("unregistered_imeis", [])
    imei_entry = next((e for e in unregistered if e.get("imei") == TEST_IMEI_REAL), None)
    if imei_entry:
        results.add(
            f"unregistered_imeis includes {TEST_IMEI_REAL}",
            True,
            f"Count: {imei_entry.get('count')}, Topic: {imei_entry.get('topic')}"
        )
    else:
        results.add(
            f"unregistered_imeis includes {TEST_IMEI_REAL}",
            False,
            f"Not found in unregistered list"
        )

# ============================================================================
# TEST 5: Simulate Message Shows Up Tagged as "simulate"
# ============================================================================
print("\n[TEST 5] Simulate Message Shows Up Tagged as 'simulate'")
simulate_payload = {
    "IMEI": TEST_IMEI_FAKE,
    "LVL": "10",
    "SIGNAL": 5
}
sim_response = simulate_mqtt_message(admin_token, "P999/0", simulate_payload)
print(f"   Simulate response: {sim_response.status_code}")

# Immediately get traffic
time.sleep(1)
response = get_traffic(admin_token)
if response.status_code == 200:
    data = response.json()
    recent = data.get("recent", [])
    
    # Most recent should be the simulated message
    if len(recent) > 0:
        top_msg = recent[0]
        results.add(
            "Most recent message has source='simulate'",
            top_msg.get("source") == "simulate",
            f"Source: {top_msg.get('source')}, Topic: {top_msg.get('topic')}"
        )
        
        results.add(
            "Simulated message has topic='P999/0'",
            top_msg.get("topic") == "P999/0",
            f"Topic: {top_msg.get('topic')}"
        )
        
        results.add(
            f"Simulated message has imei='{TEST_IMEI_FAKE}'",
            top_msg.get("imei") == TEST_IMEI_FAKE,
            f"IMEI: {top_msg.get('imei')}"
        )
        
        results.add(
            "Simulated message has dispatched=false (unregistered)",
            top_msg.get("dispatched") == False,
            f"Dispatched: {top_msg.get('dispatched')}"
        )
    
    # Check unregistered_imeis now includes the fake IMEI
    unregistered = data.get("unregistered_imeis", [])
    fake_imei_entry = next((e for e in unregistered if e.get("imei") == TEST_IMEI_FAKE), None)
    results.add(
        f"unregistered_imeis includes {TEST_IMEI_FAKE}",
        fake_imei_entry is not None,
        f"Entry: {fake_imei_entry}"
    )

# ============================================================================
# TEST 6: Dispatched (Success) Case
# ============================================================================
print("\n[TEST 6] Dispatched (Success) Case")
# Register the fake IMEI
hw_id = f"TRAFFIC_TEST_{int(time.time())}"
registered = register_instrument(admin_token, hw_id, TEST_IMEI_FAKE, "dwlr", test_user_id)
if registered:
    print(f"✅ Registered DWLR {hw_id} with IMEI {TEST_IMEI_FAKE}")
    
    # Simulate again with the same IMEI
    time.sleep(1)
    sim_response = simulate_mqtt_message(admin_token, "P999/0", simulate_payload)
    
    # Get traffic
    time.sleep(1)
    response = get_traffic(admin_token)
    if response.status_code == 200:
        data = response.json()
        recent = data.get("recent", [])
        
        # Find the most recent message with our IMEI
        our_messages = [m for m in recent if m.get("imei") == TEST_IMEI_FAKE]
        if len(our_messages) > 0:
            latest = our_messages[0]
            results.add(
                "After registration, dispatched=true",
                latest.get("dispatched") == True,
                f"Dispatched: {latest.get('dispatched')}, Hardware ID: {latest.get('hardware_id')}"
            )
            
            results.add(
                "hardware_id is set",
                latest.get("hardware_id") == hw_id,
                f"Hardware ID: {latest.get('hardware_id')}"
            )
            
            results.add(
                "instrument_type='dwlr'",
                latest.get("instrument_type") == "dwlr",
                f"Type: {latest.get('instrument_type')}"
            )
            
            results.add(
                "reason is null",
                latest.get("reason") is None,
                f"Reason: {latest.get('reason')}"
            )
        
        # Check that the IMEI is NO LONGER in unregistered_imeis for NEW messages
        # (old dropped entries may still be in buffer)
        # Simulate twice more to verify
        for i in range(2):
            time.sleep(1)
            simulate_mqtt_message(admin_token, "P999/0", simulate_payload)
        
        time.sleep(1)
        response = get_traffic(admin_token)
        if response.status_code == 200:
            data = response.json()
            unregistered = data.get("unregistered_imeis", [])
            # The fake IMEI should NOT be in unregistered list anymore
            # (only counts entries where reason starts with "IMEI ")
            fake_in_unreg = any(e.get("imei") == TEST_IMEI_FAKE for e in unregistered)
            results.add(
                f"After registration, {TEST_IMEI_FAKE} NOT in unregistered_imeis",
                not fake_in_unreg,
                f"Unregistered IMEIs: {[e.get('imei') for e in unregistered]}"
            )
else:
    results.add("Dispatched (Success) Case", False, "Failed to register instrument")

# ============================================================================
# TEST 7: Buffer Size Cap
# ============================================================================
print("\n[TEST 7] Buffer Size Cap")
print("Simulating 55 messages rapidly...")
for i in range(55):
    simulate_mqtt_message(admin_token, "P999/0", {
        "IMEI": TEST_IMEI_FAKE,
        "LVL": str(10 + i),
        "SIGNAL": 5
    })

time.sleep(2)
response = get_traffic(admin_token)
if response.status_code == 200:
    data = response.json()
    recent = data.get("recent", [])
    total_received = data.get("total_received", 0)
    
    results.add(
        "recent[] capped at 50 entries",
        len(recent) <= 50,
        f"Recent messages: {len(recent)}"
    )
    
    results.add(
        "total_received reflects true count (>= 55)",
        total_received >= 55,
        f"Total received: {total_received}"
    )

# ============================================================================
# TEST 8: Limit Parameter
# ============================================================================
print("\n[TEST 8] Limit Parameter")
response = get_traffic(admin_token, limit=5)
if response.status_code == 200:
    data = response.json()
    recent = data.get("recent", [])
    results.add(
        "limit=5 returns at most 5 entries",
        len(recent) <= 5,
        f"Recent messages: {len(recent)}"
    )

response = get_traffic(admin_token, limit=200)
if response.status_code == 200:
    data = response.json()
    recent = data.get("recent", [])
    results.add(
        "limit=200 capped at 50 (buffer max)",
        len(recent) <= 50,
        f"Recent messages: {len(recent)}"
    )

# ============================================================================
# TEST 9: Missing IMEI / Non-JSON Entries
# ============================================================================
print("\n[TEST 9] Missing IMEI / Non-JSON Entries")

# Simulate payload with no IMEI
sim_response = simulate_mqtt_message(admin_token, "777/0", {"FLOW": "5"})
time.sleep(1)
response = get_traffic(admin_token)
if response.status_code == 200:
    data = response.json()
    recent = data.get("recent", [])
    if len(recent) > 0:
        top = recent[0]
        results.add(
            "Payload missing IMEI: imei=null",
            top.get("imei") is None,
            f"IMEI: {top.get('imei')}"
        )
        
        results.add(
            "Payload missing IMEI: reason='payload missing IMEI field'",
            top.get("reason") == "payload missing IMEI field",
            f"Reason: {top.get('reason')}"
        )

# Simulate with non-JSON payload
sim_response = simulate_mqtt_message(admin_token, "777/0", "not-json")
time.sleep(1)
response = get_traffic(admin_token)
if response.status_code == 200:
    data = response.json()
    recent = data.get("recent", [])
    if len(recent) > 0:
        top = recent[0]
        results.add(
            "Non-JSON payload: reason='payload is not valid JSON'",
            top.get("reason") == "payload is not valid JSON",
            f"Reason: {top.get('reason')}"
        )

# ============================================================================
# TEST 10: Regression - GET /api/flowmeter/status
# ============================================================================
print("\n[TEST 10] Regression - GET /api/flowmeter/status")
response = requests.get(f"{BASE_URL}/flowmeter/status")
if response.status_code == 200:
    data = response.json()
    results.add(
        "GET /api/flowmeter/status returns connected=true",
        data.get("connected") == True,
        f"Connected: {data.get('connected')}, Broker: {data.get('broker')}"
    )
else:
    results.add("GET /api/flowmeter/status", False, f"Status: {response.status_code}")

# ============================================================================
# TEST 11: Regression - POST /api/devices/mqtt-simulate
# ============================================================================
print("\n[TEST 11] Regression - POST /api/devices/mqtt-simulate")
sim_response = simulate_mqtt_message(admin_token, "P999/0", {
    "IMEI": TEST_IMEI_FAKE,
    "LVL": "12.34",
    "SIGNAL": 5
})
results.add(
    "POST /api/devices/mqtt-simulate still works",
    sim_response.status_code == 200,
    f"Status: {sim_response.status_code}"
)

# ============================================================================
# TEST 12: Regression - GET /api/instrument-registry
# ============================================================================
print("\n[TEST 12] Regression - GET /api/instrument-registry")
response = requests.get(
    f"{BASE_URL}/instrument-registry",
    headers={"Authorization": f"Bearer {admin_token}"}
)
results.add(
    "GET /api/instrument-registry still works",
    response.status_code == 200,
    f"Status: {response.status_code}"
)

# ============================================================================
# CLEANUP
# ============================================================================
print("\n[CLEANUP]")
if hw_id:
    cleanup_instrument(admin_token, hw_id)
    print(f"✅ Deleted instrument {hw_id}")

if test_user_id:
    cleanup_user(admin_token, test_user_id)
    print(f"✅ Deleted test user {test_user_id}")

# ============================================================================
# SUMMARY
# ============================================================================
results.summary()

print("\n" + "="*80)
print("TEST COMPLETE")
print("="*80)
