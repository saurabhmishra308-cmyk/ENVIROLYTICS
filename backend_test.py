#!/usr/bin/env python3
"""
Backend API Test Suite for HTTPS Direct-Ingestion Endpoint
Tests the new device_key authentication and /api/devices/ingest endpoint
"""
import requests
import json
from datetime import datetime

# Backend URL from frontend/.env
BASE_URL = "https://carbon-track-24.preview.emergentagent.com/api"

# Test credentials from /app/memory/test_credentials.md
ADMIN_EMAIL = "admin@envirolytics.com"
ADMIN_PASSWORD = "Admin@Envirolytics2026"

# Test state
admin_token = None
client_token = None
test_user_id = None
test_user_email = "ingestion_test_client@example.com"
test_user_password = "TestPass123!"

# Device keys captured during test
fm_device_key = None
dwlr_device_key = None
new_fm_key = None


def log_test(test_num, description):
    """Print test header"""
    print(f"\n{'='*80}")
    print(f"TEST {test_num}: {description}")
    print('='*80)


def log_result(passed, status_code=None, detail=None):
    """Print test result"""
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status}", end="")
    if status_code is not None:
        print(f" | Status: {status_code}", end="")
    if detail:
        print(f" | {detail}", end="")
    print()


def test_1_admin_login():
    """Test 1: Login as admin → 200 + JWT"""
    global admin_token
    log_test(1, "Admin login")
    
    response = requests.post(
        f"{BASE_URL}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
    )
    
    if response.status_code == 200:
        data = response.json()
        if "access_token" in data:
            admin_token = data["access_token"]
            log_result(True, 200, f"JWT received (length: {len(admin_token)})")
            return True
        else:
            log_result(False, 200, "No access_token in response")
            return False
    else:
        log_result(False, response.status_code, response.text[:100])
        return False


def test_2_create_test_user():
    """Test 2: POST /api/admin/users/create → capture user_id"""
    global test_user_id
    log_test(2, "Create test user")
    
    response = requests.post(
        f"{BASE_URL}/admin/users/create",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "email": test_user_email,
            "password": test_user_password,
            "full_name": "Ingestion Test Client",
            "role": "client",
            "location_name": "Test Location",
            "latitude": 28.6139,
            "longitude": 77.2090
        }
    )
    
    if response.status_code == 200:
        data = response.json()
        if data.get("success") and "user" in data and "id" in data["user"]:
            test_user_id = data["user"]["id"]
            log_result(True, 200, f"User created with id: {test_user_id}")
            return True
        else:
            log_result(False, 200, f"Unexpected response structure: {data}")
            return False
    else:
        log_result(False, response.status_code, response.text[:200])
        return False


def test_3_register_flowmeter():
    """Test 3: POST /api/instrument-registry with flowmeter → capture device_key"""
    global fm_device_key
    log_test(3, "Register flowmeter ING_FM_T1 with device_key")
    
    response = requests.post(
        f"{BASE_URL}/instrument-registry",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "hardware_id": "ING_FM_T1",
            "instrument_type": "flowmeter",
            "category": "groundwater_abstraction",
            "owner_user_id": test_user_id,
            "label": "Ingestion Test Flowmeter",
            "location_name": "Test Site A"
        }
    )
    
    if response.status_code == 200:
        data = response.json()
        if data.get("success") and "instrument" in data:
            instrument = data["instrument"]
            if "device_key" in instrument and len(instrument["device_key"]) > 20:
                fm_device_key = instrument["device_key"]
                log_result(True, 200, f"Flowmeter registered, device_key length: {len(fm_device_key)}")
                return True
            else:
                log_result(False, 200, f"device_key missing or too short: {instrument.get('device_key')}")
                return False
        else:
            log_result(False, 200, f"Unexpected response: {data}")
            return False
    else:
        log_result(False, response.status_code, response.text[:200])
        return False


def test_4_register_dwlr():
    """Test 4: POST /api/instrument-registry with DWLR → capture device_key"""
    global dwlr_device_key
    log_test(4, "Register DWLR ING_DWLR_T1 with device_key")
    
    response = requests.post(
        f"{BASE_URL}/instrument-registry",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "hardware_id": "ING_DWLR_T1",
            "instrument_type": "dwlr",
            "owner_user_id": test_user_id,
            "label": "Ingestion Test DWLR",
            "location_name": "Test Site B"
        }
    )
    
    if response.status_code == 200:
        data = response.json()
        if data.get("success") and "instrument" in data:
            instrument = data["instrument"]
            if "device_key" in instrument and len(instrument["device_key"]) > 20:
                dwlr_device_key = instrument["device_key"]
                log_result(True, 200, f"DWLR registered, device_key length: {len(dwlr_device_key)}")
                return True
            else:
                log_result(False, 200, f"device_key missing or too short: {instrument.get('device_key')}")
                return False
        else:
            log_result(False, 200, f"Unexpected response: {data}")
            return False
    else:
        log_result(False, response.status_code, response.text[:200])
        return False


def test_5_ping_flowmeter():
    """Test 5: GET /api/devices/ingest/ping with correct FM credentials → 200"""
    log_test(5, "Ping endpoint with correct flowmeter credentials")
    
    response = requests.get(
        f"{BASE_URL}/devices/ingest/ping",
        headers={
            "X-Hardware-Id": "ING_FM_T1",
            "X-Device-Key": fm_device_key
        }
    )
    
    if response.status_code == 200:
        data = response.json()
        if (data.get("ok") is True and 
            data.get("hardware_id") == "ING_FM_T1" and 
            data.get("instrument_type") == "flowmeter"):
            log_result(True, 200, f"Ping successful: {data}")
            return True
        else:
            log_result(False, 200, f"Unexpected response: {data}")
            return False
    else:
        log_result(False, response.status_code, response.text[:200])
        return False


def test_6_ingest_flowmeter_data():
    """Test 6: POST /api/devices/ingest with FM data → 200"""
    log_test(6, "Ingest flowmeter data via HTTPS")
    
    payload = {
        "IMEI": "123456789012345",
        "SIGNAL": 24,
        "FLOW": 1500.5,
        "TOT1": 1234,
        "TOT2": 56,
        "RTOT1": 0,
        "RTOT2": 0,
        "UNT": 2,
        "POW": 1,
        "TEMPER": 28.5,
        "TIME": "2026-07-15T10:30:00Z",
        "VER": "FW_v1"
    }
    
    response = requests.post(
        f"{BASE_URL}/devices/ingest",
        headers={
            "X-Hardware-Id": "ING_FM_T1",
            "X-Device-Key": fm_device_key,
            "Content-Type": "application/json"
        },
        json=payload
    )
    
    if response.status_code == 200:
        data = response.json()
        if (data.get("success") is True and 
            data.get("hardware_id") == "ING_FM_T1" and 
            data.get("instrument_type") == "flowmeter"):
            log_result(True, 200, f"Data ingested: {data}")
            return True
        else:
            log_result(False, 200, f"Unexpected response: {data}")
            return False
    else:
        log_result(False, response.status_code, response.text[:200])
        return False


def test_7_verify_flowmeter_data():
    """Test 7: GET /api/flowmeter/latest → verify ING_FM_T1 with flow_rate_lph=1500.5"""
    log_test(7, "Verify flowmeter data landed in MongoDB")
    
    # Wait a moment for async processing
    import time
    time.sleep(1)
    
    response = requests.get(
        f"{BASE_URL}/flowmeter/latest",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    if response.status_code == 200:
        data = response.json()
        flowmeters = data.get("flowmeters", [])
        
        # Find ING_FM_T1
        ing_fm = None
        for device in flowmeters:
            if device.get("hardware_id") == "ING_FM_T1":
                ing_fm = device
                break
        
        if ing_fm:
            flow_rate = ing_fm.get("flow_rate_lph")
            if flow_rate == 1500.5:
                log_result(True, 200, f"Data verified: flow_rate_lph={flow_rate}")
                return True
            else:
                log_result(False, 200, f"flow_rate_lph mismatch: expected 1500.5, got {flow_rate}")
                return False
        else:
            log_result(False, 200, f"ING_FM_T1 not found in latest data. Flowmeters: {[d.get('hardware_id') for d in flowmeters]}")
            return False
    else:
        log_result(False, response.status_code, response.text[:200])
        return False


def test_8_ingest_dwlr_data():
    """Test 8: POST /api/devices/ingest with DWLR data → 200"""
    log_test(8, "Ingest DWLR data via HTTPS")
    
    payload = {
        "LEVEL": 12.45,
        "TEMPER": 24.8,
        "TIME": "2026-07-15T10:30:00Z"
    }
    
    response = requests.post(
        f"{BASE_URL}/devices/ingest",
        headers={
            "X-Hardware-Id": "ING_DWLR_T1",
            "X-Device-Key": dwlr_device_key,
            "Content-Type": "application/json"
        },
        json=payload
    )
    
    if response.status_code == 200:
        data = response.json()
        if (data.get("success") is True and 
            data.get("hardware_id") == "ING_DWLR_T1" and 
            data.get("instrument_type") == "dwlr"):
            log_result(True, 200, f"DWLR data ingested: {data}")
            return True
        else:
            log_result(False, 200, f"Unexpected response: {data}")
            return False
    else:
        log_result(False, response.status_code, response.text[:200])
        return False


def test_9_verify_dwlr_data():
    """Test 9: GET /api/instruments/dwlr/latest → verify ING_DWLR_T1 with LEVEL=12.45"""
    log_test(9, "Verify DWLR data landed in MongoDB")
    
    # Wait a moment for async processing
    import time
    time.sleep(1)
    
    response = requests.get(
        f"{BASE_URL}/instruments/dwlr/latest",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    if response.status_code == 200:
        data = response.json()
        readings = data.get("readings", [])
        
        # Find ING_DWLR_T1
        ing_dwlr = None
        for reading in readings:
            if reading.get("hardware_id") == "ING_DWLR_T1":
                ing_dwlr = reading
                break
        
        if ing_dwlr:
            # DWLR data is stored in the 'values' field
            values = ing_dwlr.get("values", {})
            level = values.get("LEVEL")
            if level == 12.45:
                log_result(True, 200, f"DWLR data verified: LEVEL={level}")
                return True
            else:
                log_result(False, 200, f"LEVEL mismatch: expected 12.45, got {level}")
                return False
        else:
            log_result(False, 200, f"ING_DWLR_T1 not found in latest data. Readings: {[r.get('hardware_id') for r in readings]}")
            return False
    else:
        log_result(False, response.status_code, response.text[:200])
        return False


def test_10_ingest_no_headers():
    """Test 10: POST /api/devices/ingest with NO headers → 401"""
    log_test(10, "Ingest with NO headers (expect 401)")
    
    response = requests.post(
        f"{BASE_URL}/devices/ingest",
        json={"FLOW": 100}
    )
    
    if response.status_code == 401:
        log_result(True, 401, "Correctly rejected")
        return True
    else:
        log_result(False, response.status_code, f"Expected 401, got {response.status_code}")
        return False


def test_11_ingest_wrong_key():
    """Test 11: POST /api/devices/ingest with WRONG key → 401"""
    log_test(11, "Ingest with WRONG device key (expect 401)")
    
    response = requests.post(
        f"{BASE_URL}/devices/ingest",
        headers={
            "X-Hardware-Id": "ING_FM_T1",
            "X-Device-Key": "WRONG_KEY_12345678901234567890"
        },
        json={"FLOW": 100}
    )
    
    if response.status_code == 401:
        detail = response.json().get("detail", "")
        if "Invalid device key" in detail:
            log_result(True, 401, f"Correctly rejected: {detail}")
            return True
        else:
            log_result(True, 401, f"Rejected but unexpected message: {detail}")
            return True
    else:
        log_result(False, response.status_code, f"Expected 401, got {response.status_code}")
        return False


def test_12_ingest_nonexistent_hardware():
    """Test 12: POST /api/devices/ingest with nonexistent hardware_id → 404"""
    log_test(12, "Ingest with nonexistent hardware_id (expect 404)")
    
    response = requests.post(
        f"{BASE_URL}/devices/ingest",
        headers={
            "X-Hardware-Id": "DOES_NOT_EXIST",
            "X-Device-Key": "any_key_here"
        },
        json={"FLOW": 100}
    )
    
    if response.status_code == 404:
        log_result(True, 404, "Correctly rejected")
        return True
    else:
        log_result(False, response.status_code, f"Expected 404, got {response.status_code}")
        return False


def test_13_ingest_invalid_json():
    """Test 13: POST /api/devices/ingest with invalid JSON → 400"""
    log_test(13, "Ingest with invalid JSON body (expect 400)")
    
    response = requests.post(
        f"{BASE_URL}/devices/ingest",
        headers={
            "X-Hardware-Id": "ING_FM_T1",
            "X-Device-Key": fm_device_key,
            "Content-Type": "application/json"
        },
        data="not valid json"
    )
    
    if response.status_code == 400:
        log_result(True, 400, "Correctly rejected invalid JSON")
        return True
    else:
        log_result(False, response.status_code, f"Expected 400, got {response.status_code}")
        return False


def test_14_ingest_array_body():
    """Test 14: POST /api/devices/ingest with array body → 400"""
    log_test(14, "Ingest with array body instead of object (expect 400)")
    
    response = requests.post(
        f"{BASE_URL}/devices/ingest",
        headers={
            "X-Hardware-Id": "ING_FM_T1",
            "X-Device-Key": fm_device_key,
            "Content-Type": "application/json"
        },
        json=[]
    )
    
    if response.status_code == 400:
        detail = response.json().get("detail", "")
        if "JSON object" in detail:
            log_result(True, 400, f"Correctly rejected: {detail}")
            return True
        else:
            log_result(True, 400, f"Rejected but unexpected message: {detail}")
            return True
    else:
        log_result(False, response.status_code, f"Expected 400, got {response.status_code}")
        return False


def test_15_rotate_key():
    """Test 15: POST /api/instrument-registry/ING_FM_T1/rotate-key → 200 with new key"""
    global new_fm_key
    log_test(15, "Rotate device key for ING_FM_T1")
    
    response = requests.post(
        f"{BASE_URL}/instrument-registry/ING_FM_T1/rotate-key",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    if response.status_code == 200:
        data = response.json()
        if data.get("success") and "device_key" in data:
            new_fm_key = data["device_key"]
            if new_fm_key != fm_device_key:
                log_result(True, 200, f"Key rotated successfully, new key length: {len(new_fm_key)}")
                return True
            else:
                log_result(False, 200, "New key is same as old key")
                return False
        else:
            log_result(False, 200, f"Unexpected response: {data}")
            return False
    else:
        log_result(False, response.status_code, response.text[:200])
        return False


def test_16_ingest_with_old_key():
    """Test 16: POST /api/devices/ingest with OLD key after rotation → 401"""
    log_test(16, "Ingest with OLD key after rotation (expect 401)")
    
    response = requests.post(
        f"{BASE_URL}/devices/ingest",
        headers={
            "X-Hardware-Id": "ING_FM_T1",
            "X-Device-Key": fm_device_key  # OLD key
        },
        json={"FLOW": 200}
    )
    
    if response.status_code == 401:
        log_result(True, 401, "Old key correctly invalidated")
        return True
    else:
        log_result(False, response.status_code, f"Expected 401, got {response.status_code}")
        return False


def test_17_ingest_with_new_key():
    """Test 17: POST /api/devices/ingest with NEW key → 200"""
    log_test(17, "Ingest with NEW key after rotation (expect 200)")
    
    payload = {
        "IMEI": "123456789012345",
        "SIGNAL": 25,
        "FLOW": 2000.0,
        "TOT1": 2000,
        "TOT2": 100,
        "RTOT1": 0,
        "RTOT2": 0,
        "UNT": 2,
        "POW": 1,
        "TEMPER": 29.0,
        "TIME": "2026-07-15T11:00:00Z",
        "VER": "FW_v1"
    }
    
    response = requests.post(
        f"{BASE_URL}/devices/ingest",
        headers={
            "X-Hardware-Id": "ING_FM_T1",
            "X-Device-Key": new_fm_key  # NEW key
        },
        json=payload
    )
    
    if response.status_code == 200:
        data = response.json()
        if data.get("success") is True:
            log_result(True, 200, "New key works correctly")
            return True
        else:
            log_result(False, 200, f"Unexpected response: {data}")
            return False
    else:
        log_result(False, response.status_code, response.text[:200])
        return False


def test_18_rotate_unknown_hardware():
    """Test 18: POST /api/instrument-registry/UNKNOWN_HW/rotate-key → 404"""
    log_test(18, "Rotate key for nonexistent hardware (expect 404)")
    
    response = requests.post(
        f"{BASE_URL}/instrument-registry/UNKNOWN_HW/rotate-key",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    if response.status_code == 404:
        log_result(True, 404, "Correctly rejected")
        return True
    else:
        log_result(False, response.status_code, f"Expected 404, got {response.status_code}")
        return False


def test_19_rotate_key_as_client():
    """Test 19: POST /api/instrument-registry/ING_FM_T1/rotate-key as client → 403"""
    global client_token
    log_test(19, "Rotate key as non-admin client (expect 403)")
    
    # First login as client
    login_response = requests.post(
        f"{BASE_URL}/auth/login",
        json={"email": test_user_email, "password": test_user_password}
    )
    
    if login_response.status_code != 200:
        log_result(False, login_response.status_code, "Failed to login as client")
        return False
    
    client_token = login_response.json().get("access_token")
    
    # Try to rotate key
    response = requests.post(
        f"{BASE_URL}/instrument-registry/ING_FM_T1/rotate-key",
        headers={"Authorization": f"Bearer {client_token}"}
    )
    
    if response.status_code == 403:
        log_result(True, 403, "Correctly rejected non-admin")
        return True
    else:
        log_result(False, response.status_code, f"Expected 403, got {response.status_code}")
        return False


def test_20_backfill_keys():
    """Test 20: POST /api/instrument-registry/backfill-keys → 200"""
    log_test(20, "Backfill device keys for legacy instruments")
    
    response = requests.post(
        f"{BASE_URL}/instrument-registry/backfill-keys",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    if response.status_code == 200:
        data = response.json()
        if data.get("success") is not None:
            updated = data.get("updated", 0)
            log_result(True, 200, f"Backfill completed, updated: {updated}")
            return True
        else:
            log_result(False, 200, f"Unexpected response: {data}")
            return False
    else:
        log_result(False, response.status_code, response.text[:200])
        return False


def test_21_client_sees_device_keys():
    """Test 21: Login as client, GET /api/instrument-registry → device_key visible"""
    log_test(21, "Client can see their own device keys")
    
    response = requests.get(
        f"{BASE_URL}/instrument-registry",
        headers={"Authorization": f"Bearer {client_token}"}
    )
    
    if response.status_code == 200:
        data = response.json()
        instruments = data.get("instruments", [])
        count = data.get("count", 0)
        
        if count == 2:
            # Check both instruments have device_key
            keys_present = all("device_key" in inst for inst in instruments)
            if keys_present:
                log_result(True, 200, f"Client sees {count} instruments, all with device_key")
                return True
            else:
                log_result(False, 200, "Some instruments missing device_key")
                return False
        else:
            log_result(False, 200, f"Expected 2 instruments, got {count}")
            return False
    else:
        log_result(False, response.status_code, response.text[:200])
        return False


def test_22_admin_sees_device_keys():
    """Test 22: Login as admin, GET /api/instrument-registry → device_keys visible"""
    log_test(22, "Admin can see device keys for all instruments")
    
    response = requests.get(
        f"{BASE_URL}/instrument-registry",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    if response.status_code == 200:
        data = response.json()
        instruments = data.get("instruments", [])
        
        # Find our test instruments
        test_instruments = [i for i in instruments if i.get("hardware_id") in ["ING_FM_T1", "ING_DWLR_T1"]]
        
        if len(test_instruments) == 2:
            keys_present = all("device_key" in inst for inst in test_instruments)
            if keys_present:
                log_result(True, 200, f"Admin sees test instruments with device_keys")
                return True
            else:
                log_result(False, 200, "Some test instruments missing device_key")
                return False
        else:
            log_result(False, 200, f"Expected 2 test instruments, found {len(test_instruments)}")
            return False
    else:
        log_result(False, response.status_code, response.text[:200])
        return False


def cleanup():
    """Cleanup: Delete test instruments and user"""
    log_test("CLEANUP", "Deleting test data")
    
    results = []
    
    # Delete instruments
    for hw_id in ["ING_FM_T1", "ING_DWLR_T1"]:
        response = requests.delete(
            f"{BASE_URL}/instrument-registry/{hw_id}",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        results.append(f"DELETE {hw_id}: {response.status_code}")
    
    # Delete user
    if test_user_id:
        response = requests.delete(
            f"{BASE_URL}/admin/users/{test_user_id}",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        results.append(f"DELETE user {test_user_id}: {response.status_code}")
    
    print("\n".join(results))


def check_backend_logs():
    """Check backend logs for errors"""
    log_test("LOGS", "Checking backend logs for errors")
    import subprocess
    
    try:
        result = subprocess.run(
            ["tail", "-n", "100", "/var/log/supervisor/backend.err.log"],
            capture_output=True,
            text=True,
            timeout=5
        )
        
        if result.returncode == 0:
            logs = result.stdout
            if logs.strip():
                print(f"Backend error logs (last 100 lines):\n{logs}")
            else:
                print("✅ No errors in backend logs")
        else:
            print(f"Failed to read logs: {result.stderr}")
    except Exception as e:
        print(f"Error reading logs: {e}")


def main():
    """Run all tests"""
    print("\n" + "="*80)
    print("HTTPS DIRECT-INGESTION ENDPOINT TEST SUITE")
    print("Testing device_key authentication and /api/devices/ingest")
    print("="*80)
    
    results = []
    
    # Setup tests (1-4)
    results.append(("Test 1: Admin login", test_1_admin_login()))
    if not results[-1][1]:
        print("\n❌ CRITICAL: Admin login failed. Aborting tests.")
        return
    
    results.append(("Test 2: Create test user", test_2_create_test_user()))
    if not results[-1][1]:
        print("\n❌ CRITICAL: User creation failed. Aborting tests.")
        return
    
    results.append(("Test 3: Register flowmeter", test_3_register_flowmeter()))
    results.append(("Test 4: Register DWLR", test_4_register_dwlr()))
    
    # Ingest happy paths (5-9)
    results.append(("Test 5: Ping flowmeter", test_5_ping_flowmeter()))
    results.append(("Test 6: Ingest flowmeter data", test_6_ingest_flowmeter_data()))
    results.append(("Test 7: Verify flowmeter data", test_7_verify_flowmeter_data()))
    results.append(("Test 8: Ingest DWLR data", test_8_ingest_dwlr_data()))
    results.append(("Test 9: Verify DWLR data", test_9_verify_dwlr_data()))
    
    # Auth failures (10-14)
    results.append(("Test 10: Ingest no headers", test_10_ingest_no_headers()))
    results.append(("Test 11: Ingest wrong key", test_11_ingest_wrong_key()))
    results.append(("Test 12: Ingest nonexistent hardware", test_12_ingest_nonexistent_hardware()))
    results.append(("Test 13: Ingest invalid JSON", test_13_ingest_invalid_json()))
    results.append(("Test 14: Ingest array body", test_14_ingest_array_body()))
    
    # Key rotation (15-19)
    results.append(("Test 15: Rotate key", test_15_rotate_key()))
    results.append(("Test 16: Ingest with old key", test_16_ingest_with_old_key()))
    results.append(("Test 17: Ingest with new key", test_17_ingest_with_new_key()))
    results.append(("Test 18: Rotate unknown hardware", test_18_rotate_unknown_hardware()))
    results.append(("Test 19: Rotate key as client", test_19_rotate_key_as_client()))
    
    # Backfill & visibility (20-22)
    results.append(("Test 20: Backfill keys", test_20_backfill_keys()))
    results.append(("Test 21: Client sees device keys", test_21_client_sees_device_keys()))
    results.append(("Test 22: Admin sees device keys", test_22_admin_sees_device_keys()))
    
    # Cleanup
    cleanup()
    
    # Check logs
    check_backend_logs()
    
    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    print(f"\nTotal: {passed}/{total} tests passed\n")
    
    for test_name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status} | {test_name}")
    
    if passed == total:
        print("\n🎉 ALL TESTS PASSED!")
    else:
        print(f"\n⚠️  {total - passed} test(s) failed")
    
    return passed == total


if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)
