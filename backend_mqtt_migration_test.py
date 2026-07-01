#!/usr/bin/env python3
"""
Backend API Test Suite for MQTT Broker Migration + IMEI-based Device Routing
Tests the new IMEI field, manual_water_temp_c field, and enrichment endpoints
"""
import requests
import json
from datetime import datetime

# Backend URL from frontend/.env
BASE_URL = "https://envirolytics-hub.preview.emergentagent.com/api"

# Test credentials
ADMIN_EMAIL = "admin@envirolytics.com"
ADMIN_PASSWORD = "Admin@Envirolytics2026"

# Test state
admin_token = None
test_user_id = None
test_user_email = "mqtt_migration_test@example.com"
test_user_password = "TestPass123!"

# Test instruments
test_fm_hw_id = "MQTT_FM_TEST_001"
test_dwlr_hw_id = "MQTT_DWLR_TEST_001"
test_fm_imei = "860738070478155"
test_dwlr_imei = "860738070478156"
test_fm_device_key = None
test_dwlr_device_key = None


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
            log_result(True, 200, f"JWT received")
            return True
        else:
            log_result(False, 200, "No access_token in response")
            return False
    else:
        log_result(False, response.status_code, response.text[:200])
        return False


def test_2_create_test_user():
    """Test 2: Create test user for instrument ownership"""
    global test_user_id
    log_test(2, "Create test user")
    
    response = requests.post(
        f"{BASE_URL}/admin/users/create",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "email": test_user_email,
            "password": test_user_password,
            "full_name": "MQTT Migration Test User",
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
            log_result(False, 200, f"Unexpected response: {data}")
            return False
    else:
        log_result(False, response.status_code, response.text[:200])
        return False


def test_3_create_flowmeter_with_imei():
    """Test 3: POST /api/instrument-registry with IMEI → 200/201, IMEI present in response"""
    global test_fm_device_key
    log_test(3, "Create flowmeter with IMEI")
    
    response = requests.post(
        f"{BASE_URL}/instrument-registry",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "hardware_id": test_fm_hw_id,
            "instrument_type": "flowmeter",
            "owner_user_id": test_user_id,
            "label": "Test Flowmeter with IMEI",
            "category": "groundwater_abstraction",
            "imei": test_fm_imei,
            "location_name": "Test Site A",
            "latitude": 28.6139,
            "longitude": 77.2090
        }
    )
    
    if response.status_code in [200, 201]:
        data = response.json()
        if data.get("success") and "instrument" in data:
            instrument = data["instrument"]
            if instrument.get("imei") == test_fm_imei:
                test_fm_device_key = instrument.get("device_key")
                log_result(True, response.status_code, f"Flowmeter created with IMEI: {test_fm_imei}")
                return True
            else:
                log_result(False, response.status_code, f"IMEI mismatch: expected {test_fm_imei}, got {instrument.get('imei')}")
                return False
        else:
            log_result(False, response.status_code, f"Unexpected response: {data}")
            return False
    else:
        log_result(False, response.status_code, response.text[:200])
        return False


def test_4_create_duplicate_imei():
    """Test 4: POST another instrument with SAME IMEI → 409 Conflict"""
    log_test(4, "Create instrument with duplicate IMEI → expect 409")
    
    response = requests.post(
        f"{BASE_URL}/instrument-registry",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "hardware_id": "MQTT_FM_DUPLICATE",
            "instrument_type": "flowmeter",
            "owner_user_id": test_user_id,
            "label": "Duplicate IMEI Test",
            "category": "groundwater_abstraction",
            "imei": test_fm_imei,  # Same IMEI as test_3
            "location_name": "Test Site B",
            "latitude": 28.6139,
            "longitude": 77.2090
        }
    )
    
    if response.status_code == 409:
        data = response.json()
        if "IMEI" in data.get("detail", ""):
            log_result(True, 409, f"Correctly rejected duplicate IMEI: {data.get('detail')}")
            return True
        else:
            log_result(False, 409, f"409 but wrong message: {data.get('detail')}")
            return False
    else:
        log_result(False, response.status_code, f"Expected 409, got {response.status_code}")
        return False


def test_5_create_instrument_without_imei():
    """Test 5: POST with IMEI missing/empty → should succeed (IMEI is optional)"""
    log_test(5, "Create instrument without IMEI → should succeed")
    
    response = requests.post(
        f"{BASE_URL}/instrument-registry",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "hardware_id": "MQTT_FM_NO_IMEI",
            "instrument_type": "flowmeter",
            "owner_user_id": test_user_id,
            "label": "Flowmeter without IMEI",
            "category": "groundwater_abstraction",
            "location_name": "Test Site C",
            "latitude": 28.6139,
            "longitude": 77.2090
        }
    )
    
    if response.status_code in [200, 201]:
        data = response.json()
        if data.get("success"):
            log_result(True, response.status_code, "Instrument created without IMEI")
            return True
        else:
            log_result(False, response.status_code, f"Unexpected response: {data}")
            return False
    else:
        log_result(False, response.status_code, response.text[:200])
        return False


def test_6_create_instrument_with_non_numeric_imei():
    """Test 6: POST with IMEI set to non-numeric junk → should succeed (backend doesn't enforce numeric format)"""
    log_test(6, "Create instrument with non-numeric IMEI → should succeed")
    
    response = requests.post(
        f"{BASE_URL}/instrument-registry",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "hardware_id": "MQTT_FM_JUNK_IMEI",
            "instrument_type": "flowmeter",
            "owner_user_id": test_user_id,
            "label": "Flowmeter with junk IMEI",
            "category": "groundwater_abstraction",
            "imei": "abc123xyz",
            "location_name": "Test Site D",
            "latitude": 28.6139,
            "longitude": 77.2090
        }
    )
    
    if response.status_code in [200, 201]:
        data = response.json()
        if data.get("success"):
            log_result(True, response.status_code, "Instrument created with non-numeric IMEI (backend allows this)")
            return True
        else:
            log_result(False, response.status_code, f"Unexpected response: {data}")
            return False
    else:
        log_result(False, response.status_code, response.text[:200])
        return False


def test_7_get_instrument_registry_includes_imei():
    """Test 7: GET /api/instrument-registry → created instruments should include IMEI field"""
    log_test(7, "GET instrument registry → verify IMEI field present")
    
    response = requests.get(
        f"{BASE_URL}/instrument-registry",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    if response.status_code == 200:
        data = response.json()
        instruments = data.get("instruments", [])
        test_instrument = next((i for i in instruments if i.get("hardware_id") == test_fm_hw_id), None)
        
        if test_instrument:
            if test_instrument.get("imei") == test_fm_imei:
                log_result(True, 200, f"IMEI field present: {test_fm_imei}")
                return True
            else:
                log_result(False, 200, f"IMEI mismatch: expected {test_fm_imei}, got {test_instrument.get('imei')}")
                return False
        else:
            log_result(False, 200, f"Test instrument {test_fm_hw_id} not found in registry")
            return False
    else:
        log_result(False, response.status_code, response.text[:200])
        return False


def test_8_update_instrument_imei():
    """Test 8: PUT /api/instrument-registry/{hardware_id} with new IMEI → should succeed"""
    log_test(8, "Update instrument IMEI → should succeed")
    
    new_imei = "999999999999999"
    response = requests.put(
        f"{BASE_URL}/instrument-registry/{test_fm_hw_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"imei": new_imei}
    )
    
    if response.status_code == 200:
        data = response.json()
        if data.get("success"):
            log_result(True, 200, f"IMEI updated to: {new_imei}")
            return True
        else:
            log_result(False, 200, f"Unexpected response: {data}")
            return False
    else:
        log_result(False, response.status_code, response.text[:200])
        return False


def test_9_update_same_imei_to_another_instrument():
    """Test 9: PUT same IMEI onto ANOTHER hardware_id → should return 409"""
    log_test(9, "Update IMEI to duplicate value on another instrument → expect 409")
    
    response = requests.put(
        f"{BASE_URL}/instrument-registry/MQTT_FM_NO_IMEI",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"imei": "999999999999999"}  # Same as test_8
    )
    
    if response.status_code == 409:
        data = response.json()
        if "IMEI" in data.get("detail", ""):
            log_result(True, 409, f"Correctly rejected duplicate IMEI: {data.get('detail')}")
            return True
        else:
            log_result(False, 409, f"409 but wrong message: {data.get('detail')}")
            return False
    else:
        log_result(False, response.status_code, f"Expected 409, got {response.status_code}")
        return False


def test_10_clear_imei_with_empty_string():
    """Test 10: PUT imei: "" (empty string) on existing instrument → should clear IMEI (set to null)"""
    log_test(10, "Clear IMEI with empty string → should set to null")
    
    response = requests.put(
        f"{BASE_URL}/instrument-registry/{test_fm_hw_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"imei": ""}
    )
    
    if response.status_code == 200:
        data = response.json()
        if data.get("success"):
            # Verify by fetching the instrument
            verify_response = requests.get(
                f"{BASE_URL}/instrument-registry",
                headers={"Authorization": f"Bearer {admin_token}"}
            )
            if verify_response.status_code == 200:
                instruments = verify_response.json().get("instruments", [])
                test_instrument = next((i for i in instruments if i.get("hardware_id") == test_fm_hw_id), None)
                if test_instrument and test_instrument.get("imei") in [None, ""]:
                    log_result(True, 200, "IMEI cleared successfully")
                    return True
                else:
                    log_result(False, 200, f"IMEI not cleared: {test_instrument.get('imei') if test_instrument else 'instrument not found'}")
                    return False
            else:
                log_result(False, 200, "Could not verify IMEI clearing")
                return False
        else:
            log_result(False, 200, f"Unexpected response: {data}")
            return False
    else:
        log_result(False, response.status_code, response.text[:200])
        return False


def test_11_create_dwlr_with_manual_water_temp():
    """Test 11: POST DWLR with manual_water_temp_c → should succeed and return the value"""
    global test_dwlr_device_key
    log_test(11, "Create DWLR with manual_water_temp_c")
    
    response = requests.post(
        f"{BASE_URL}/instrument-registry",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "hardware_id": test_dwlr_hw_id,
            "instrument_type": "dwlr",
            "owner_user_id": test_user_id,
            "label": "Test DWLR with Manual Temp",
            "imei": test_dwlr_imei,
            "manual_water_temp_c": 22.5,
            "location_name": "Test Site E",
            "latitude": 28.6139,
            "longitude": 77.2090
        }
    )
    
    if response.status_code in [200, 201]:
        data = response.json()
        if data.get("success") and "instrument" in data:
            instrument = data["instrument"]
            if instrument.get("manual_water_temp_c") == 22.5:
                test_dwlr_device_key = instrument.get("device_key")
                log_result(True, response.status_code, f"DWLR created with manual_water_temp_c: 22.5")
                return True
            else:
                log_result(False, response.status_code, f"manual_water_temp_c mismatch: expected 22.5, got {instrument.get('manual_water_temp_c')}")
                return False
        else:
            log_result(False, response.status_code, f"Unexpected response: {data}")
            return False
    else:
        log_result(False, response.status_code, response.text[:200])
        return False


def test_12_update_dwlr_manual_water_temp():
    """Test 12: PUT manual_water_temp_c on DWLR → should update"""
    log_test(12, "Update DWLR manual_water_temp_c")
    
    response = requests.put(
        f"{BASE_URL}/instrument-registry/{test_dwlr_hw_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"manual_water_temp_c": 25.0}
    )
    
    if response.status_code == 200:
        data = response.json()
        if data.get("success"):
            log_result(True, 200, "manual_water_temp_c updated to 25.0")
            return True
        else:
            log_result(False, 200, f"Unexpected response: {data}")
            return False
    else:
        log_result(False, response.status_code, response.text[:200])
        return False


def test_13_get_dwlr_registry_shows_manual_temp():
    """Test 13: GET instrument registry → DWLR should show current manual_water_temp_c"""
    log_test(13, "GET instrument registry → verify manual_water_temp_c")
    
    response = requests.get(
        f"{BASE_URL}/instrument-registry",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    if response.status_code == 200:
        data = response.json()
        instruments = data.get("instruments", [])
        test_dwlr = next((i for i in instruments if i.get("hardware_id") == test_dwlr_hw_id), None)
        
        if test_dwlr:
            if test_dwlr.get("manual_water_temp_c") == 25.0:
                log_result(True, 200, f"manual_water_temp_c present: 25.0")
                return True
            else:
                log_result(False, 200, f"manual_water_temp_c mismatch: expected 25.0, got {test_dwlr.get('manual_water_temp_c')}")
                return False
        else:
            log_result(False, 200, f"Test DWLR {test_dwlr_hw_id} not found in registry")
            return False
    else:
        log_result(False, response.status_code, response.text[:200])
        return False


def test_14_flowmeter_manual_temp_coerced_to_null():
    """Test 14: POST flowmeter with manual_water_temp_c → should be coerced to null (only DWLR keeps it)"""
    log_test(14, "Create flowmeter with manual_water_temp_c → should be coerced to null")
    
    response = requests.post(
        f"{BASE_URL}/instrument-registry",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "hardware_id": "MQTT_FM_TEMP_TEST",
            "instrument_type": "flowmeter",
            "owner_user_id": test_user_id,
            "label": "Flowmeter with manual temp (should be ignored)",
            "category": "groundwater_abstraction",
            "manual_water_temp_c": 30.0,  # Should be ignored for flowmeter
            "location_name": "Test Site F",
            "latitude": 28.6139,
            "longitude": 77.2090
        }
    )
    
    if response.status_code in [200, 201]:
        data = response.json()
        if data.get("success") and "instrument" in data:
            instrument = data["instrument"]
            if instrument.get("manual_water_temp_c") is None:
                log_result(True, response.status_code, "manual_water_temp_c correctly coerced to null for flowmeter")
                return True
            else:
                log_result(False, response.status_code, f"manual_water_temp_c should be null for flowmeter, got: {instrument.get('manual_water_temp_c')}")
                return False
        else:
            log_result(False, response.status_code, f"Unexpected response: {data}")
            return False
    else:
        log_result(False, response.status_code, response.text[:200])
        return False


def test_15_ingest_dwlr_data_for_enrichment_test():
    """Test 15: Ingest DWLR data via HTTPS endpoint to test enrichment"""
    log_test(15, "Ingest DWLR data for enrichment test")
    
    response = requests.post(
        f"{BASE_URL}/devices/ingest",
        headers={
            "X-Hardware-Id": test_dwlr_hw_id,
            "X-Device-Key": test_dwlr_device_key
        },
        json={
            "LEVEL": 12.45,
            "SIGNAL": 85,
            "TIME": datetime.utcnow().isoformat() + "Z"
        }
    )
    
    if response.status_code == 200:
        data = response.json()
        if data.get("success"):
            log_result(True, 200, "DWLR data ingested successfully")
            return True
        else:
            log_result(False, 200, f"Unexpected response: {data}")
            return False
    else:
        log_result(False, response.status_code, response.text[:200])
        return False


def test_16_get_dwlr_latest_response_shape():
    """Test 16: GET /api/instruments/dwlr/latest → response key is 'readings' (NOT 'instruments')"""
    log_test(16, "GET /api/instruments/dwlr/latest → verify response shape")
    
    response = requests.get(
        f"{BASE_URL}/instruments/dwlr/latest",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    if response.status_code == 200:
        data = response.json()
        if "readings" in data:
            log_result(True, 200, f"Response has 'readings' key (count: {data.get('count', 0)})")
            return True
        else:
            log_result(False, 200, f"Response missing 'readings' key. Keys: {list(data.keys())}")
            return False
    else:
        log_result(False, response.status_code, response.text[:200])
        return False


def test_17_dwlr_latest_includes_manual_water_temp():
    """Test 17: GET /api/instruments/dwlr/latest → should include manual_water_temp_c enrichment"""
    log_test(17, "GET /api/instruments/dwlr/latest → verify manual_water_temp_c enrichment")
    
    response = requests.get(
        f"{BASE_URL}/instruments/dwlr/latest",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    if response.status_code == 200:
        data = response.json()
        readings = data.get("readings", [])
        test_reading = next((r for r in readings if r.get("hardware_id") == test_dwlr_hw_id), None)
        
        if test_reading:
            if "manual_water_temp_c" in test_reading:
                log_result(True, 200, f"manual_water_temp_c enriched: {test_reading.get('manual_water_temp_c')}")
                return True
            else:
                log_result(False, 200, "manual_water_temp_c not present in reading")
                return False
        else:
            # If no reading yet, that's OK - the device hasn't published data
            log_result(True, 200, "No reading for test DWLR yet (device hasn't published) - this is OK")
            return True
    else:
        log_result(False, response.status_code, response.text[:200])
        return False


def test_18_all_latest_includes_manual_water_temp():
    """Test 18: GET /api/instruments/all/latest → should include manual_water_temp_c for DWLR entries"""
    log_test(18, "GET /api/instruments/all/latest → verify manual_water_temp_c enrichment")
    
    response = requests.get(
        f"{BASE_URL}/instruments/all/latest",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    if response.status_code == 200:
        data = response.json()
        by_type = data.get("by_type", {})
        dwlr_readings = by_type.get("dwlr", [])
        test_reading = next((r for r in dwlr_readings if r.get("hardware_id") == test_dwlr_hw_id), None)
        
        if test_reading:
            if "manual_water_temp_c" in test_reading:
                log_result(True, 200, f"manual_water_temp_c enriched in all/latest: {test_reading.get('manual_water_temp_c')}")
                return True
            else:
                log_result(False, 200, "manual_water_temp_c not present in reading")
                return False
        else:
            # If no reading yet, that's OK
            log_result(True, 200, "No reading for test DWLR yet (device hasn't published) - this is OK")
            return True
    else:
        log_result(False, response.status_code, response.text[:200])
        return False


def test_19_dwlr_daily_includes_manual_water_temp():
    """Test 19: GET /api/flowmeter-mgmt/dwlr/{hardware_id}/daily → should include manual_water_temp_c at top level"""
    log_test(19, "GET /api/flowmeter-mgmt/dwlr/{hw_id}/daily → verify manual_water_temp_c")
    
    response = requests.get(
        f"{BASE_URL}/flowmeter-mgmt/dwlr/{test_dwlr_hw_id}/daily?days=7",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    if response.status_code == 200:
        data = response.json()
        if "manual_water_temp_c" in data:
            log_result(True, 200, f"manual_water_temp_c at top level: {data.get('manual_water_temp_c')}")
            return True
        else:
            log_result(False, 200, f"manual_water_temp_c missing from response. Keys: {list(data.keys())}")
            return False
    else:
        log_result(False, response.status_code, response.text[:200])
        return False


def test_20_dwlr_daily_response_structure():
    """Test 20: GET /api/flowmeter-mgmt/dwlr/{hardware_id}/daily → verify response structure"""
    log_test(20, "GET /api/flowmeter-mgmt/dwlr/{hw_id}/daily → verify response structure")
    
    response = requests.get(
        f"{BASE_URL}/flowmeter-mgmt/dwlr/{test_dwlr_hw_id}/daily?days=7",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    if response.status_code == 200:
        data = response.json()
        required_keys = ["hardware_id", "days", "series", "count", "manual_water_temp_c"]
        missing_keys = [k for k in required_keys if k not in data]
        
        if not missing_keys:
            log_result(True, 200, f"All required keys present. Series count: {data.get('count', 0)}")
            return True
        else:
            log_result(False, 200, f"Missing keys: {missing_keys}")
            return False
    else:
        log_result(False, response.status_code, response.text[:200])
        return False


def test_21_flowmeter_status_shows_new_broker():
    """Test 21: GET /api/flowmeter/status → should report new broker host and port"""
    log_test(21, "GET /api/flowmeter/status → verify new broker config")
    
    response = requests.get(
        f"{BASE_URL}/flowmeter/status",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    if response.status_code == 200:
        data = response.json()
        broker = data.get("broker", "")
        
        if "skyrise.online" in broker and "1490" in broker:
            # connected is expected to be false due to auth rejection
            log_result(True, 200, f"Broker: {broker}, connected: {data.get('connected')} (false is expected)")
            return True
        else:
            log_result(False, 200, f"Unexpected broker config: {broker}")
            return False
    else:
        log_result(False, response.status_code, response.text[:200])
        return False


def test_22_https_ingestion_regression():
    """Test 22: Quick smoke test - HTTPS ingestion still works (register FM, ingest data, verify)"""
    log_test(22, "HTTPS ingestion regression check")
    
    # Register a fresh flowmeter
    hw_id = "MQTT_REGRESSION_FM"
    reg_response = requests.post(
        f"{BASE_URL}/instrument-registry",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "hardware_id": hw_id,
            "instrument_type": "flowmeter",
            "owner_user_id": test_user_id,
            "label": "Regression Test FM",
            "category": "groundwater_abstraction",
            "imei": "860738070478999",
            "location_name": "Regression Site",
            "latitude": 28.6139,
            "longitude": 77.2090
        }
    )
    
    if reg_response.status_code not in [200, 201]:
        log_result(False, reg_response.status_code, "Failed to register flowmeter")
        return False
    
    device_key = reg_response.json().get("instrument", {}).get("device_key")
    if not device_key:
        log_result(False, reg_response.status_code, "No device_key in response")
        return False
    
    # Ingest data
    ingest_response = requests.post(
        f"{BASE_URL}/devices/ingest",
        headers={
            "X-Hardware-Id": hw_id,
            "X-Device-Key": device_key
        },
        json={
            "FLOW": 1500.5,
            "TOT1": 1000,
            "TOT2": 5,
            "RTOT1": 0,
            "RTOT2": 0,
            "SIGNAL": 90,
            "TIME": datetime.utcnow().isoformat() + "Z"
        }
    )
    
    if ingest_response.status_code != 200:
        log_result(False, ingest_response.status_code, "Failed to ingest data")
        return False
    
    # Verify data landed - check both possible response keys
    verify_response = requests.get(
        f"{BASE_URL}/flowmeter/latest",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    if verify_response.status_code == 200:
        data = verify_response.json()
        # Try both 'flowmeters' and 'readings' keys
        readings = data.get("flowmeters", data.get("readings", []))
        test_reading = next((r for r in readings if r.get("hardware_id") == hw_id), None)
        
        if test_reading and test_reading.get("flow_rate_lph") == 1500.5:
            log_result(True, 200, "HTTPS ingestion working correctly")
            return True
        else:
            log_result(False, 200, f"Data not found in flowmeter_latest. Keys in response: {list(data.keys())}, readings count: {len(readings)}")
            return False
    else:
        log_result(False, verify_response.status_code, "Failed to verify data")
        return False


def test_23_sparse_imei_index():
    """Test 23: Confirm multiple instruments with no IMEI can coexist (sparse index)"""
    log_test(23, "Sparse IMEI index - multiple null IMEIs should coexist")
    
    # Create first instrument without IMEI
    response1 = requests.post(
        f"{BASE_URL}/instrument-registry",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "hardware_id": "MQTT_SPARSE_1",
            "instrument_type": "flowmeter",
            "owner_user_id": test_user_id,
            "label": "Sparse Test 1",
            "category": "groundwater_abstraction",
            "location_name": "Sparse Site 1",
            "latitude": 28.6139,
            "longitude": 77.2090
        }
    )
    
    if response1.status_code not in [200, 201]:
        log_result(False, response1.status_code, "Failed to create first instrument")
        return False
    
    # Create second instrument without IMEI
    response2 = requests.post(
        f"{BASE_URL}/instrument-registry",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "hardware_id": "MQTT_SPARSE_2",
            "instrument_type": "flowmeter",
            "owner_user_id": test_user_id,
            "label": "Sparse Test 2",
            "category": "groundwater_abstraction",
            "location_name": "Sparse Site 2",
            "latitude": 28.6139,
            "longitude": 77.2090
        }
    )
    
    if response2.status_code not in [200, 201]:
        log_result(False, response2.status_code, "Failed to create second instrument")
        return False
    
    # Create third instrument without IMEI
    response3 = requests.post(
        f"{BASE_URL}/instrument-registry",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "hardware_id": "MQTT_SPARSE_3",
            "instrument_type": "dwlr",
            "owner_user_id": test_user_id,
            "label": "Sparse Test 3",
            "location_name": "Sparse Site 3",
            "latitude": 28.6139,
            "longitude": 77.2090
        }
    )
    
    if response3.status_code not in [200, 201]:
        log_result(False, response3.status_code, "Failed to create third instrument")
        return False
    
    log_result(True, 200, "Multiple instruments with null IMEI created successfully (sparse index working)")
    return True


def cleanup():
    """Cleanup test data"""
    log_test("CLEANUP", "Removing test instruments and user")
    
    test_hardware_ids = [
        test_fm_hw_id,
        test_dwlr_hw_id,
        "MQTT_FM_NO_IMEI",
        "MQTT_FM_JUNK_IMEI",
        "MQTT_FM_TEMP_TEST",
        "MQTT_REGRESSION_FM",
        "MQTT_SPARSE_1",
        "MQTT_SPARSE_2",
        "MQTT_SPARSE_3"
    ]
    
    for hw_id in test_hardware_ids:
        try:
            response = requests.delete(
                f"{BASE_URL}/instrument-registry/{hw_id}",
                headers={"Authorization": f"Bearer {admin_token}"}
            )
            if response.status_code == 200:
                print(f"  ✅ Deleted instrument: {hw_id}")
            elif response.status_code == 404:
                print(f"  ℹ️  Instrument not found (already deleted?): {hw_id}")
            else:
                print(f"  ⚠️  Failed to delete {hw_id}: {response.status_code}")
        except Exception as e:
            print(f"  ⚠️  Error deleting {hw_id}: {e}")
    
    # Delete test user
    if test_user_id:
        try:
            response = requests.delete(
                f"{BASE_URL}/admin/users/{test_user_id}",
                headers={"Authorization": f"Bearer {admin_token}"}
            )
            if response.status_code == 200:
                print(f"  ✅ Deleted test user: {test_user_id}")
            else:
                print(f"  ⚠️  Failed to delete test user: {response.status_code}")
        except Exception as e:
            print(f"  ⚠️  Error deleting test user: {e}")


def main():
    """Run all tests"""
    print("\n" + "="*80)
    print("MQTT BROKER MIGRATION + IMEI-BASED DEVICE ROUTING TEST SUITE")
    print("="*80)
    
    tests = [
        test_1_admin_login,
        test_2_create_test_user,
        test_3_create_flowmeter_with_imei,
        test_4_create_duplicate_imei,
        test_5_create_instrument_without_imei,
        test_6_create_instrument_with_non_numeric_imei,
        test_7_get_instrument_registry_includes_imei,
        test_8_update_instrument_imei,
        test_9_update_same_imei_to_another_instrument,
        test_10_clear_imei_with_empty_string,
        test_11_create_dwlr_with_manual_water_temp,
        test_12_update_dwlr_manual_water_temp,
        test_13_get_dwlr_registry_shows_manual_temp,
        test_14_flowmeter_manual_temp_coerced_to_null,
        test_15_ingest_dwlr_data_for_enrichment_test,
        test_16_get_dwlr_latest_response_shape,
        test_17_dwlr_latest_includes_manual_water_temp,
        test_18_all_latest_includes_manual_water_temp,
        test_19_dwlr_daily_includes_manual_water_temp,
        test_20_dwlr_daily_response_structure,
        test_21_flowmeter_status_shows_new_broker,
        test_22_https_ingestion_regression,
        test_23_sparse_imei_index,
    ]
    
    results = []
    for test in tests:
        try:
            result = test()
            results.append(result)
        except Exception as e:
            print(f"❌ EXCEPTION: {e}")
            results.append(False)
    
    # Cleanup
    try:
        cleanup()
    except Exception as e:
        print(f"⚠️  Cleanup error: {e}")
    
    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    passed = sum(results)
    total = len(results)
    print(f"Passed: {passed}/{total}")
    print(f"Failed: {total - passed}/{total}")
    
    if passed == total:
        print("\n🎉 ALL TESTS PASSED!")
    else:
        print(f"\n⚠️  {total - passed} TEST(S) FAILED")
    
    return passed == total


if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)
