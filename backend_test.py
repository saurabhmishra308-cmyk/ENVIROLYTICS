"""
Backend Test Suite for MQTT Broker Credential Fix Verification
================================================================

This test verifies that the app is now RECEIVING LIVE DATA from a real IoT device
after correcting the MQTT broker credentials.

Test Cases:
1. Broker connection status (GET /api/flowmeter/status)
2. Real device data ingestion (register DWLR with IMEI 860738070478155, wait for data)
3. Simulate ingestion with same topic/IMEI (POST /api/devices/mqtt-simulate)
4. Unknown IMEI drop (simulate with random IMEI)
5. Regression smoke tests (HTTPS ingestion, user creation, etc.)

Admin credentials: admin@envirolytics.com / admin123
"""

import requests
import time
import json
from datetime import datetime

# Backend URL from frontend/.env
BASE_URL = "https://envirolytics-hub.preview.emergentagent.com/api"

# Test credentials
ADMIN_EMAIL = "admin@envirolytics.com"
ADMIN_PASSWORD = "Admin@Envirolytics2026"

# Real device IMEI from field piezometer
REAL_DEVICE_IMEI = "860738070478155"
REAL_DEVICE_TOPIC = "P673/0"

# Test data
TEST_USER_EMAIL = f"mqtt_test_{int(time.time())}@example.com"
TEST_HARDWARE_ID = "LIVE_PIEZO_673"

class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    END = '\033[0m'

def log_test(test_name):
    print(f"\n{Colors.BLUE}{'='*80}{Colors.END}")
    print(f"{Colors.BLUE}TEST: {test_name}{Colors.END}")
    print(f"{Colors.BLUE}{'='*80}{Colors.END}")

def log_pass(message):
    print(f"{Colors.GREEN}✅ PASS: {message}{Colors.END}")

def log_fail(message):
    print(f"{Colors.RED}❌ FAIL: {message}{Colors.END}")

def log_info(message):
    print(f"{Colors.YELLOW}ℹ️  INFO: {message}{Colors.END}")

def log_observation(message):
    print(f"   📋 {message}")

# Global variables for test state
admin_token = None
test_user_id = None
test_user_token = None

def test_1_admin_login():
    """Test Case 0: Admin login to get JWT token"""
    log_test("Admin Login")
    
    response = requests.post(
        f"{BASE_URL}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
    )
    
    if response.status_code == 200:
        data = response.json()
        global admin_token
        admin_token = data.get("access_token")
        log_pass(f"Admin login successful")
        log_observation(f"JWT token obtained (length: {len(admin_token)})")
        return True
    else:
        log_fail(f"Admin login failed: {response.status_code} - {response.text}")
        return False

def test_2_broker_connection_status():
    """Test Case 1: Verify broker connection status"""
    log_test("Test Case 1: Broker Connection Status")
    
    response = requests.get(f"{BASE_URL}/flowmeter/status")
    
    if response.status_code == 200:
        data = response.json()
        log_observation(f"Response: {json.dumps(data, indent=2)}")
        
        # Check connected status
        if data.get("connected") == True:
            log_pass("Broker connected: True")
        else:
            log_fail(f"Broker connected: {data.get('connected')}")
            return False
        
        # Check broker address
        broker = data.get("broker")
        if "skyrise.online" in str(broker) and "1490" in str(broker):
            log_pass(f"Broker address correct: {broker}")
        else:
            log_fail(f"Broker address incorrect: {broker}")
            return False
        
        # Check subscribed topics
        subscribed_topics = data.get("subscribed_topics", [])
        if "+/0" in subscribed_topics:
            log_pass(f"Subscribed to wildcard topic: +/0")
        else:
            log_fail(f"Wildcard topic +/0 not in subscribed_topics: {subscribed_topics}")
            return False
        
        log_pass("Test Case 1: PASSED - Broker connection verified")
        return True
    else:
        log_fail(f"GET /api/flowmeter/status failed: {response.status_code} - {response.text}")
        return False

def test_3_register_real_device():
    """Test Case 2a: Register DWLR instrument with real device IMEI"""
    log_test("Test Case 2a: Register Real Device (IMEI 860738070478155)")
    
    # First, create a test user to own the device
    log_info("Creating test user to own the device...")
    response = requests.post(
        f"{BASE_URL}/admin/users/create",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "email": TEST_USER_EMAIL,
            "password": "TestPass123!",
            "full_name": "MQTT Test User",
            "role": "client",
            "location_name": "Test Location",
            "latitude": 26.8467,
            "longitude": 80.9462
        }
    )
    
    if response.status_code != 200:
        log_fail(f"Failed to create test user: {response.status_code} - {response.text}")
        return False
    
    global test_user_id
    test_user_id = response.json().get("user", {}).get("id")
    log_pass(f"Test user created: {TEST_USER_EMAIL} (ID: {test_user_id})")
    
    # Now register the DWLR instrument with the real IMEI
    log_info(f"Registering DWLR instrument with IMEI {REAL_DEVICE_IMEI}...")
    response = requests.post(
        f"{BASE_URL}/instrument-registry",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "hardware_id": TEST_HARDWARE_ID,
            "instrument_type": "dwlr",
            "owner_user_id": test_user_id,
            "label": "Live Piezometer 673",
            "imei": REAL_DEVICE_IMEI,
            "manual_water_temp_c": 25.0,
            "location_name": "Field Site P673",
            "latitude": 26.8467,
            "longitude": 80.9462
        }
    )
    
    if response.status_code == 200:
        data = response.json()
        log_pass(f"DWLR instrument registered: {TEST_HARDWARE_ID}")
        log_observation(f"IMEI: {REAL_DEVICE_IMEI}")
        log_observation(f"Manual water temp: 25.0°C")
        log_observation(f"Owner: {test_user_id}")
        return True
    else:
        log_fail(f"Failed to register instrument: {response.status_code} - {response.text}")
        return False

def test_4_wait_for_real_data():
    """Test Case 2b: Wait for real device data to arrive and verify ingestion"""
    log_test("Test Case 2b: Wait for Real Device Data (40 seconds)")
    
    log_info("Waiting 40 seconds for at least one MQTT message from the real device...")
    log_info("The real piezometer publishes on topic P673/0 every ~30 seconds")
    
    # Wait 40 seconds
    for i in range(40, 0, -5):
        print(f"   ⏳ {i} seconds remaining...", end='\r')
        time.sleep(5)
    print()
    
    log_info("Checking if data was ingested...")
    
    # Check GET /api/instruments/dwlr/latest
    response = requests.get(
        f"{BASE_URL}/instruments/dwlr/latest",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    if response.status_code != 200:
        log_fail(f"GET /api/instruments/dwlr/latest failed: {response.status_code} - {response.text}")
        return False
    
    data = response.json()
    readings = data.get("readings", [])
    
    log_observation(f"Total DWLR readings: {len(readings)}")
    
    # Find our device
    our_reading = None
    for reading in readings:
        if reading.get("hardware_id") == TEST_HARDWARE_ID:
            our_reading = reading
            break
    
    if our_reading:
        log_pass(f"Real device data found for {TEST_HARDWARE_ID}")
        log_observation(f"LEVEL: {our_reading.get('values', {}).get('LEVEL')} mWC")
        log_observation(f"Manual water temp: {our_reading.get('manual_water_temp_c')}°C")
        log_observation(f"Timestamp: {our_reading.get('timestamp')}")
        log_observation(f"Received at: {our_reading.get('received_at')}")
        
        # Verify LEVEL is around 40.97 (based on observed traffic)
        level = our_reading.get('values', {}).get('LEVEL')
        if level and 35.0 <= level <= 50.0:
            log_pass(f"LEVEL value is realistic: {level} mWC (expected ~40.97)")
        else:
            log_info(f"LEVEL value: {level} mWC (may vary from observed 40.97)")
        
        # Verify manual_water_temp_c is enriched
        if our_reading.get('manual_water_temp_c') == 25.0:
            log_pass("manual_water_temp_c enriched correctly: 25.0°C")
        else:
            log_fail(f"manual_water_temp_c not enriched: {our_reading.get('manual_water_temp_c')}")
            return False
        
        log_pass("Test Case 2: PASSED - Real device data ingestion verified")
        return True
    else:
        log_fail(f"No data found for {TEST_HARDWARE_ID}")
        log_info("This could mean:")
        log_info("  1. The real device hasn't published in the last 40 seconds")
        log_info("  2. The broker stopped delivering messages")
        log_info("  3. The code isn't storing correctly")
        log_info("\nChecking backend logs for clues...")
        return False

def test_5_simulate_ingestion_same_imei():
    """Test Case 3: Simulate ingestion with same topic/IMEI"""
    log_test("Test Case 3: Simulate Ingestion (Same IMEI)")
    
    payload = {
        "topic": REAL_DEVICE_TOPIC,
        "payload": {
            "IMEI": REAL_DEVICE_IMEI,
            "LEVEL": "42.50",
            "UNT": 1.0,
            "SIGNAL": 15,
            "TIME": datetime.utcnow().strftime("%y%m%d%H%M%S")
        }
    }
    
    response = requests.post(
        f"{BASE_URL}/devices/mqtt-simulate",
        headers={"Authorization": f"Bearer {admin_token}"},
        json=payload
    )
    
    if response.status_code == 200:
        data = response.json()
        log_observation(f"Response: {json.dumps(data, indent=2)}")
        
        if data.get("dispatched") == True:
            log_pass("Message dispatched successfully")
        else:
            log_fail(f"Message not dispatched: {data}")
            return False
        
        if data.get("hardware_id") == TEST_HARDWARE_ID:
            log_pass(f"Correct hardware_id: {TEST_HARDWARE_ID}")
        else:
            log_fail(f"Wrong hardware_id: {data.get('hardware_id')}")
            return False
        
        if data.get("instrument_type") == "dwlr":
            log_pass("Correct instrument_type: dwlr")
        else:
            log_fail(f"Wrong instrument_type: {data.get('instrument_type')}")
            return False
        
        log_pass("Test Case 3: PASSED - Simulate ingestion working")
        return True
    else:
        log_fail(f"POST /api/devices/mqtt-simulate failed: {response.status_code} - {response.text}")
        return False

def test_6_simulate_unknown_imei():
    """Test Case 4: Simulate with unknown IMEI"""
    log_test("Test Case 4: Simulate with Unknown IMEI")
    
    payload = {
        "topic": "P999/0",
        "payload": {
            "IMEI": "999999999999999",
            "LEVEL": "10.00",
            "UNT": 1.0,
            "SIGNAL": 10,
            "TIME": datetime.utcnow().strftime("%y%m%d%H%M%S")
        }
    }
    
    response = requests.post(
        f"{BASE_URL}/devices/mqtt-simulate",
        headers={"Authorization": f"Bearer {admin_token}"},
        json=payload
    )
    
    if response.status_code == 200:
        data = response.json()
        log_observation(f"Response: {json.dumps(data, indent=2)}")
        
        if data.get("dispatched") == False:
            log_pass("Message correctly not dispatched")
        else:
            log_fail(f"Message should not be dispatched: {data}")
            return False
        
        reason = data.get("reason", "")
        if "999999999999999" in reason and "not registered" in reason.lower():
            log_pass(f"Correct reason: {reason}")
        else:
            log_fail(f"Wrong reason: {reason}")
            return False
        
        log_pass("Test Case 4: PASSED - Unknown IMEI correctly dropped")
        return True
    else:
        log_fail(f"POST /api/devices/mqtt-simulate failed: {response.status_code} - {response.text}")
        return False

def test_7_https_ingestion_regression():
    """Test Case 5a: Regression - HTTPS ingestion endpoint still works"""
    log_test("Test Case 5a: Regression - HTTPS Ingestion")
    
    # Get the device_key for the registered instrument
    response = requests.get(
        f"{BASE_URL}/instrument-registry",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    if response.status_code != 200:
        log_fail(f"Failed to get instrument registry: {response.status_code}")
        return False
    
    instruments = response.json().get("instruments", [])
    our_instrument = None
    for inst in instruments:
        if inst.get("hardware_id") == TEST_HARDWARE_ID:
            our_instrument = inst
            break
    
    if not our_instrument:
        log_fail(f"Instrument {TEST_HARDWARE_ID} not found in registry")
        return False
    
    device_key = our_instrument.get("device_key")
    if not device_key:
        log_fail("device_key not found in instrument")
        return False
    
    log_info(f"Using device_key: {device_key[:8]}...")
    
    # Test HTTPS ingestion
    payload = {
        "LEVEL": "43.25",
        "SIGNAL": 18,
        "TIME": datetime.utcnow().isoformat()
    }
    
    response = requests.post(
        f"{BASE_URL}/devices/ingest",
        headers={
            "X-Hardware-Id": TEST_HARDWARE_ID,
            "X-Device-Key": device_key,
            "Content-Type": "application/json"
        },
        json=payload
    )
    
    if response.status_code == 200:
        data = response.json()
        log_observation(f"Response: {json.dumps(data, indent=2)}")
        
        if data.get("success") == True:
            log_pass("HTTPS ingestion successful")
        else:
            log_fail(f"HTTPS ingestion not successful: {data}")
            return False
        
        if data.get("hardware_id") == TEST_HARDWARE_ID:
            log_pass(f"Correct hardware_id: {TEST_HARDWARE_ID}")
        else:
            log_fail(f"Wrong hardware_id: {data.get('hardware_id')}")
            return False
        
        log_pass("Test Case 5a: PASSED - HTTPS ingestion working")
        return True
    else:
        log_fail(f"POST /api/devices/ingest failed: {response.status_code} - {response.text}")
        return False

def test_8_smoke_tests():
    """Test Case 5b: Regression smoke tests"""
    log_test("Test Case 5b: Regression Smoke Tests")
    
    all_passed = True
    
    # Test 1: GET /api/instrument-registry
    response = requests.get(
        f"{BASE_URL}/instrument-registry",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    if response.status_code == 200:
        log_pass("GET /api/instrument-registry: 200")
    else:
        log_fail(f"GET /api/instrument-registry: {response.status_code}")
        all_passed = False
    
    # Test 2: GET /api/instruments/all/latest
    response = requests.get(
        f"{BASE_URL}/instruments/all/latest",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    if response.status_code == 200:
        log_pass("GET /api/instruments/all/latest: 200")
    else:
        log_fail(f"GET /api/instruments/all/latest: {response.status_code}")
        all_passed = False
    
    # Test 3: GET /api/auth/me
    response = requests.get(
        f"{BASE_URL}/auth/me",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    if response.status_code == 200:
        log_pass("GET /api/auth/me: 200")
    else:
        log_fail(f"GET /api/auth/me: {response.status_code}")
        all_passed = False
    
    if all_passed:
        log_pass("Test Case 5b: PASSED - Smoke tests passed")
    else:
        log_fail("Test Case 5b: FAILED - Some smoke tests failed")
    
    return all_passed

def test_9_cleanup():
    """Cleanup: Delete test instrument and user"""
    log_test("Cleanup: Delete Test Data")
    
    # Delete instrument
    response = requests.delete(
        f"{BASE_URL}/instrument-registry/{TEST_HARDWARE_ID}",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    if response.status_code == 200:
        log_pass(f"Deleted instrument: {TEST_HARDWARE_ID}")
    else:
        log_fail(f"Failed to delete instrument: {response.status_code} - {response.text}")
    
    # Delete user
    if test_user_id:
        response = requests.delete(
            f"{BASE_URL}/admin/users/{test_user_id}",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        
        if response.status_code == 200:
            log_pass(f"Deleted test user: {TEST_USER_EMAIL}")
        else:
            log_fail(f"Failed to delete user: {response.status_code} - {response.text}")
    
    log_info("Cleanup complete - real device data will now drop back to 'Unknown IMEI'")
    return True

def main():
    print(f"\n{Colors.BLUE}{'='*80}{Colors.END}")
    print(f"{Colors.BLUE}MQTT BROKER CREDENTIAL FIX VERIFICATION TEST SUITE{Colors.END}")
    print(f"{Colors.BLUE}{'='*80}{Colors.END}")
    print(f"Backend URL: {BASE_URL}")
    print(f"Admin: {ADMIN_EMAIL}")
    print(f"Real Device IMEI: {REAL_DEVICE_IMEI}")
    print(f"Real Device Topic: {REAL_DEVICE_TOPIC}")
    print(f"{Colors.BLUE}{'='*80}{Colors.END}\n")
    
    results = {}
    
    # Run tests
    results["Admin Login"] = test_1_admin_login()
    if not results["Admin Login"]:
        log_fail("Cannot proceed without admin token")
        return
    
    results["Test Case 1: Broker Connection"] = test_2_broker_connection_status()
    results["Test Case 2a: Register Device"] = test_3_register_real_device()
    results["Test Case 2b: Real Data Ingestion"] = test_4_wait_for_real_data()
    results["Test Case 3: Simulate Same IMEI"] = test_5_simulate_ingestion_same_imei()
    results["Test Case 4: Unknown IMEI"] = test_6_simulate_unknown_imei()
    results["Test Case 5a: HTTPS Ingestion"] = test_7_https_ingestion_regression()
    results["Test Case 5b: Smoke Tests"] = test_8_smoke_tests()
    results["Cleanup"] = test_9_cleanup()
    
    # Summary
    print(f"\n{Colors.BLUE}{'='*80}{Colors.END}")
    print(f"{Colors.BLUE}TEST SUMMARY{Colors.END}")
    print(f"{Colors.BLUE}{'='*80}{Colors.END}")
    
    passed = sum(1 for v in results.values() if v)
    total = len(results)
    
    for test_name, result in results.items():
        status = f"{Colors.GREEN}✅ PASS{Colors.END}" if result else f"{Colors.RED}❌ FAIL{Colors.END}"
        print(f"{status}: {test_name}")
    
    print(f"\n{Colors.BLUE}{'='*80}{Colors.END}")
    if passed == total:
        print(f"{Colors.GREEN}ALL TESTS PASSED: {passed}/{total}{Colors.END}")
    else:
        print(f"{Colors.RED}SOME TESTS FAILED: {passed}/{total} passed{Colors.END}")
    print(f"{Colors.BLUE}{'='*80}{Colors.END}\n")

if __name__ == "__main__":
    main()
