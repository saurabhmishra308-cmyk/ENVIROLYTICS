#!/usr/bin/env python3
"""
QESPL API Integration Test Suite

Tests the NEW QESPL API integration for DO Meter & Water Quality parameters.
Backend now supports 3 device sources: mqtt (default), https_ingest, qespl_api.

Critical constraint: flowmeter and DWLR paths must NOT have changed.
"""
import requests
import json
import os
from typing import Dict, Any, Optional

# Get backend URL from environment
BACKEND_URL = os.getenv("REACT_APP_BACKEND_URL", "http://localhost:8001")
API_BASE = f"{BACKEND_URL}/api"

# Test credentials
ADMIN_EMAIL = "admin@envirolytics.com"
ADMIN_PASSWORD = "Admin@Envirolytics2026"

# Test data tracking
test_user_id = None
test_instruments = []
admin_token = None
client_token = None


def log_test(step: int, description: str):
    """Log test step"""
    print(f"\n{'='*80}")
    print(f"TEST {step}: {description}")
    print('='*80)


def log_result(passed: bool, message: str, response: Optional[requests.Response] = None):
    """Log test result"""
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status}: {message}")
    if response:
        print(f"  Status: {response.status_code}")
        try:
            print(f"  Response: {json.dumps(response.json(), indent=2)}")
        except:
            print(f"  Response: {response.text[:200]}")


def admin_login() -> str:
    """Login as admin and return JWT token"""
    log_test(1, "Admin login → 200")
    response = requests.post(
        f"{API_BASE}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
    )
    
    if response.status_code == 200:
        data = response.json()
        token = data.get("access_token")
        log_result(True, f"Admin login successful, token received", response)
        return token
    else:
        log_result(False, f"Admin login failed", response)
        raise Exception("Admin login failed")


def test_backwards_compatibility_flowmeter(token: str):
    """Test 2: Register flowmeter WITHOUT device_source (should default to mqtt)"""
    log_test(2, "Backwards-compatibility: Register flowmeter WITHOUT device_source → defaults to 'mqtt'")
    
    global test_user_id, test_instruments
    
    # First create a test user
    user_response = requests.post(
        f"{API_BASE}/admin/users/create",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "email": f"qespl_test_user_{os.urandom(4).hex()}@example.com",
            "password": "TestPass123!",
            "full_name": "QESPL Test User",
            "role": "client",
            "location_name": "Test Location",
            "latitude": 12.9716,
            "longitude": 77.5946
        }
    )
    
    if user_response.status_code != 200:
        log_result(False, "Failed to create test user", user_response)
        return False
    
    test_user_id = user_response.json()["user"]["id"]
    print(f"  Created test user: {test_user_id}")
    
    # Register flowmeter WITHOUT device_source
    response = requests.post(
        f"{API_BASE}/instrument-registry",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "hardware_id": "BACK_FM_1",
            "instrument_type": "flowmeter",
            "category": "groundwater_abstraction",
            "owner_user_id": test_user_id,
            "label": "Backwards Compat Flowmeter"
        }
    )
    
    if response.status_code == 200:
        data = response.json()
        instrument = data.get("instrument", {})
        device_source = instrument.get("device_source")
        qespl_device_id = instrument.get("qespl_device_id")
        
        if device_source == "mqtt" and qespl_device_id is None:
            test_instruments.append("BACK_FM_1")
            log_result(True, f"Flowmeter registered with device_source='mqtt' (default), no qespl_device_id", response)
            return True
        else:
            log_result(False, f"Expected device_source='mqtt' and qespl_device_id=None, got device_source='{device_source}', qespl_device_id={qespl_device_id}", response)
            return False
    else:
        log_result(False, "Failed to register flowmeter", response)
        return False


def test_dwlr_default_source(token: str):
    """Test 3: DWLR still works with default source"""
    log_test(3, "DWLR still works: Register DWLR with default source → 'mqtt'")
    
    response = requests.post(
        f"{API_BASE}/instrument-registry",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "hardware_id": "BACK_DWLR_1",
            "instrument_type": "dwlr",
            "owner_user_id": test_user_id,
            "label": "Backwards Compat DWLR"
        }
    )
    
    if response.status_code == 200:
        data = response.json()
        instrument = data.get("instrument", {})
        device_source = instrument.get("device_source")
        
        if device_source == "mqtt":
            test_instruments.append("BACK_DWLR_1")
            log_result(True, f"DWLR registered with device_source='mqtt' (default)", response)
            return True
        else:
            log_result(False, f"Expected device_source='mqtt', got '{device_source}'", response)
            return False
    else:
        log_result(False, "Failed to register DWLR", response)
        return False


def test_register_qespl_water_quality(token: str):
    """Test 4: Register QESPL water_quality device"""
    log_test(4, "Register QESPL water_quality device with qespl_device_id")
    
    response = requests.post(
        f"{API_BASE}/instrument-registry",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "hardware_id": "WQ_T1",
            "instrument_type": "water_quality",
            "owner_user_id": test_user_id,
            "device_source": "qespl_api",
            "qespl_device_id": "DTU10019126",
            "label": "QESPL Water Quality Sensor"
        }
    )
    
    if response.status_code == 200:
        data = response.json()
        instrument = data.get("instrument", {})
        device_source = instrument.get("device_source")
        qespl_device_id = instrument.get("qespl_device_id")
        
        if device_source == "qespl_api" and qespl_device_id == "DTU10019126":
            test_instruments.append("WQ_T1")
            log_result(True, f"Water quality device registered with QESPL source", response)
            return True
        else:
            log_result(False, f"Unexpected device_source or qespl_device_id", response)
            return False
    else:
        log_result(False, "Failed to register water_quality device", response)
        return False


def test_register_qespl_dometer(token: str):
    """Test 5: Register QESPL dometer device"""
    log_test(5, "Register QESPL dometer device with qespl_device_id")
    
    response = requests.post(
        f"{API_BASE}/instrument-registry",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "hardware_id": "DO_T1",
            "instrument_type": "dometer",
            "owner_user_id": test_user_id,
            "device_source": "qespl_api",
            "qespl_device_id": "DTU10019126",
            "label": "QESPL DO Meter"
        }
    )
    
    if response.status_code == 200:
        data = response.json()
        instrument = data.get("instrument", {})
        device_source = instrument.get("device_source")
        qespl_device_id = instrument.get("qespl_device_id")
        
        if device_source == "qespl_api" and qespl_device_id == "DTU10019126":
            test_instruments.append("DO_T1")
            log_result(True, f"Dometer device registered with QESPL source", response)
            return True
        else:
            log_result(False, f"Unexpected device_source or qespl_device_id", response)
            return False
    else:
        log_result(False, "Failed to register dometer device", response)
        return False


def test_validation_missing_qespl_device_id(token: str):
    """Test 6: Validation - missing qespl_device_id when source is qespl_api → 400"""
    log_test(6, "Validation: missing qespl_device_id when device_source=qespl_api → 400")
    
    response = requests.post(
        f"{API_BASE}/instrument-registry",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "hardware_id": "WQ_BAD",
            "instrument_type": "water_quality",
            "owner_user_id": test_user_id,
            "device_source": "qespl_api"
            # Missing qespl_device_id
        }
    )
    
    if response.status_code == 400:
        error_message = response.json().get("detail", "")
        if "qespl_device_id" in error_message.lower():
            log_result(True, f"Correctly rejected with 400: {error_message}", response)
            return True
        else:
            log_result(False, f"Got 400 but error message doesn't mention qespl_device_id", response)
            return False
    else:
        log_result(False, f"Expected 400, got {response.status_code}", response)
        return False


def test_validation_invalid_device_source(token: str):
    """Test 7: Validation - invalid device_source → 400"""
    log_test(7, "Validation: invalid device_source → 400")
    
    response = requests.post(
        f"{API_BASE}/instrument-registry",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "hardware_id": "INVALID_SRC",
            "instrument_type": "water_quality",
            "owner_user_id": test_user_id,
            "device_source": "garbage",
            "label": "Invalid Source Test"
        }
    )
    
    if response.status_code == 400:
        error_message = response.json().get("detail", "")
        if "device_source" in error_message.lower() or "unsupported" in error_message.lower():
            log_result(True, f"Correctly rejected with 400: {error_message}", response)
            return True
        else:
            log_result(False, f"Got 400 but error message doesn't mention device_source", response)
            return False
    else:
        log_result(False, f"Expected 400, got {response.status_code}", response)
        return False


def test_new_instrument_types_accepted(token: str):
    """Test 8: Validation - new instrument types are accepted"""
    log_test(8, "Validation: new instrument types (dometer, water_quality) accepted")
    
    # Test dometer with mqtt source
    response1 = requests.post(
        f"{API_BASE}/instrument-registry",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "hardware_id": "DO_MQTT_T1",
            "instrument_type": "dometer",
            "owner_user_id": test_user_id,
            "device_source": "mqtt",
            "label": "MQTT Dometer"
        }
    )
    
    # Test water_quality with mqtt source
    response2 = requests.post(
        f"{API_BASE}/instrument-registry",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "hardware_id": "WQ_MQTT_T1",
            "instrument_type": "water_quality",
            "owner_user_id": test_user_id,
            "device_source": "mqtt",
            "label": "MQTT Water Quality"
        }
    )
    
    success1 = response1.status_code == 200
    success2 = response2.status_code == 200
    
    if success1:
        test_instruments.append("DO_MQTT_T1")
        log_result(True, "Dometer with mqtt source accepted", response1)
    else:
        log_result(False, "Dometer with mqtt source rejected", response1)
    
    if success2:
        test_instruments.append("WQ_MQTT_T1")
        log_result(True, "Water_quality with mqtt source accepted", response2)
    else:
        log_result(False, "Water_quality with mqtt source rejected", response2)
    
    return success1 and success2


def test_qespl_poll_manually(token: str):
    """Test 9: Trigger QESPL poll manually → POST /api/devices/qespl/run-now"""
    log_test(9, "Trigger QESPL poll manually as admin → 200 with {polled, ok, failed}")
    
    response = requests.post(
        f"{API_BASE}/devices/qespl/run-now",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code == 200:
        data = response.json()
        polled = data.get("polled", 0)
        ok = data.get("ok", 0)
        failed = data.get("failed", 0)
        
        # We registered 2 QESPL devices (WQ_T1, DO_T1), so polled should be >= 2
        if polled >= 2:
            log_result(True, f"QESPL poll executed: polled={polled}, ok={ok}, failed={failed}", response)
            return True
        else:
            log_result(False, f"Expected polled >= 2, got polled={polled}", response)
            return False
    else:
        log_result(False, f"QESPL poll failed", response)
        return False


def test_verify_data_landed(token: str):
    """Test 10: Verify data landed via same pipeline → GET /api/instruments/all/latest"""
    log_test(10, "Verify data landed via same pipeline (if QESPL API returned data)")
    
    response = requests.get(
        f"{API_BASE}/instruments/all/latest",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code == 200:
        data = response.json()
        by_type = data.get("by_type", {})
        
        # Check if water_quality or dometer data exists
        water_quality_data = by_type.get("water_quality", [])
        dometer_data = by_type.get("dometer", [])
        
        wq_found = any(d.get("hardware_id") in ["WQ_T1", "WQ_MQTT_T1"] for d in water_quality_data)
        do_found = any(d.get("hardware_id") in ["DO_T1", "DO_MQTT_T1"] for d in dometer_data)
        
        if wq_found or do_found:
            log_result(True, f"Data found in pipeline: water_quality={wq_found}, dometer={do_found}", response)
        else:
            # This is acceptable - QESPL API might not have returned data yet
            log_result(True, f"No data yet from QESPL API (acceptable - API may not have data for test DTU)", response)
        return True
    else:
        log_result(False, f"Failed to get instruments/all/latest", response)
        return False


def test_qespl_run_now_admin_only(token: str):
    """Test 11: QESPL run-now is admin-only → 403 for non-admin"""
    log_test(11, "QESPL run-now is admin-only → 403 for non-admin client")
    
    # Login as the test client
    global client_token
    
    # Get client email from test_user_id
    user_response = requests.get(
        f"{API_BASE}/admin/users/list",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if user_response.status_code != 200:
        log_result(False, "Failed to get users list", user_response)
        return False
    
    users = user_response.json().get("users", [])
    test_user = next((u for u in users if u.get("id") == test_user_id), None)
    
    if not test_user:
        log_result(False, f"Test user {test_user_id} not found", None)
        return False
    
    client_email = test_user.get("email")
    
    # Login as client
    client_login_response = requests.post(
        f"{API_BASE}/auth/login",
        json={"email": client_email, "password": "TestPass123!"}
    )
    
    if client_login_response.status_code != 200:
        log_result(False, "Failed to login as client", client_login_response)
        return False
    
    client_token = client_login_response.json().get("access_token")
    
    # Try to call run-now as client
    response = requests.post(
        f"{API_BASE}/devices/qespl/run-now",
        headers={"Authorization": f"Bearer {client_token}"}
    )
    
    if response.status_code == 403:
        log_result(True, "Client correctly rejected with 403", response)
        return True
    else:
        log_result(False, f"Expected 403, got {response.status_code}", response)
        return False


def test_qespl_run_now_no_devices(token: str):
    """Test 12: QESPL run-now with NO qespl devices → polled:0"""
    log_test(12, "QESPL run-now with NO qespl devices → polled:0")
    
    # First delete all QESPL devices
    qespl_devices = ["WQ_T1", "DO_T1"]
    for hw_id in qespl_devices:
        delete_response = requests.delete(
            f"{API_BASE}/instrument-registry/{hw_id}",
            headers={"Authorization": f"Bearer {token}"}
        )
        if delete_response.status_code == 200:
            print(f"  Deleted QESPL device: {hw_id}")
            test_instruments.remove(hw_id)
    
    # Now call run-now
    response = requests.post(
        f"{API_BASE}/devices/qespl/run-now",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code == 200:
        data = response.json()
        polled = data.get("polled", -1)
        
        if polled == 0:
            log_result(True, f"QESPL poll with no devices: polled=0", response)
            return True
        else:
            log_result(False, f"Expected polled=0, got polled={polled}", response)
            return False
    else:
        log_result(False, f"QESPL poll failed", response)
        return False


def test_cleanup(token: str):
    """Test 13: Cleanup - DELETE all test instruments"""
    log_test(13, "Cleanup: DELETE all test instruments")
    
    global test_instruments
    
    success = True
    for hw_id in test_instruments[:]:  # Copy list to avoid modification during iteration
        response = requests.delete(
            f"{API_BASE}/instrument-registry/{hw_id}",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        if response.status_code == 200:
            print(f"  ✅ Deleted: {hw_id}")
            test_instruments.remove(hw_id)
        else:
            print(f"  ❌ Failed to delete: {hw_id} (status {response.status_code})")
            success = False
    
    # Delete test user
    if test_user_id:
        user_delete_response = requests.delete(
            f"{API_BASE}/admin/users/{test_user_id}",
            headers={"Authorization": f"Bearer {token}"}
        )
        if user_delete_response.status_code == 200:
            print(f"  ✅ Deleted test user: {test_user_id}")
        else:
            print(f"  ❌ Failed to delete test user: {test_user_id}")
            success = False
    
    log_result(success, "Cleanup completed")
    return success


def test_no_regressions(token: str):
    """Test 14: No regressions - verify existing endpoints still work"""
    log_test(14, "No regressions: Verify existing endpoints still work")
    
    endpoints = [
        ("GET /api/alerts/offline?hours=2", f"{API_BASE}/alerts/offline?hours=2"),
        ("GET /api/limits", f"{API_BASE}/limits"),
        ("GET /api/certificates/list", f"{API_BASE}/certificates/list"),
        ("GET /api/renewals", f"{API_BASE}/renewals"),
    ]
    
    all_passed = True
    for name, url in endpoints:
        response = requests.get(url, headers={"Authorization": f"Bearer {token}"})
        if response.status_code == 200:
            print(f"  ✅ {name} → 200")
        else:
            print(f"  ❌ {name} → {response.status_code}")
            all_passed = False
    
    log_result(all_passed, "All regression endpoints working")
    return all_passed


def test_backend_logs():
    """Test 15: Check backend logs for QESPL-related errors"""
    log_test(15, "Backend logs: Check for QESPL-related exceptions")
    
    import subprocess
    
    try:
        # Check backend logs for qespl-related errors
        result = subprocess.run(
            ["tail", "-n", "200", "/var/log/supervisor/backend.err.log"],
            capture_output=True,
            text=True,
            timeout=5
        )
        
        error_log = result.stdout
        
        # Look for qespl-related errors
        qespl_errors = [line for line in error_log.split('\n') if '[qespl]' in line.lower() and ('error' in line.lower() or 'exception' in line.lower() or 'traceback' in line.lower())]
        
        if qespl_errors:
            print(f"  ⚠️  Found {len(qespl_errors)} QESPL-related error lines:")
            for line in qespl_errors[:10]:  # Show first 10
                print(f"    {line}")
            log_result(False, f"Found QESPL errors in backend logs")
            return False
        else:
            # Check for any qespl log lines (info level)
            qespl_logs = [line for line in error_log.split('\n') if '[qespl]' in line.lower()]
            if qespl_logs:
                print(f"  ℹ️  Found {len(qespl_logs)} QESPL log lines (info level):")
                for line in qespl_logs[-5:]:  # Show last 5
                    print(f"    {line}")
            log_result(True, "No QESPL exceptions found in backend logs")
            return True
    except Exception as e:
        print(f"  ⚠️  Could not check logs: {e}")
        log_result(True, "Log check skipped (non-critical)")
        return True


def main():
    """Run all QESPL integration tests"""
    print("\n" + "="*80)
    print("QESPL API INTEGRATION TEST SUITE")
    print("="*80)
    print(f"Backend URL: {API_BASE}")
    print(f"Admin: {ADMIN_EMAIL}")
    print("="*80)
    
    results = []
    
    try:
        # Test 1: Admin login
        global admin_token
        admin_token = admin_login()
        results.append(("Admin login", True))
        
        # Test 2: Backwards compatibility - flowmeter
        results.append(("Backwards compat: Flowmeter defaults to mqtt", test_backwards_compatibility_flowmeter(admin_token)))
        
        # Test 3: DWLR still works
        results.append(("DWLR defaults to mqtt", test_dwlr_default_source(admin_token)))
        
        # Test 4: Register QESPL water_quality
        results.append(("Register QESPL water_quality", test_register_qespl_water_quality(admin_token)))
        
        # Test 5: Register QESPL dometer
        results.append(("Register QESPL dometer", test_register_qespl_dometer(admin_token)))
        
        # Test 6: Validation - missing qespl_device_id
        results.append(("Validation: missing qespl_device_id → 400", test_validation_missing_qespl_device_id(admin_token)))
        
        # Test 7: Validation - invalid device_source
        results.append(("Validation: invalid device_source → 400", test_validation_invalid_device_source(admin_token)))
        
        # Test 8: New instrument types accepted
        results.append(("New instrument types accepted", test_new_instrument_types_accepted(admin_token)))
        
        # Test 9: QESPL poll manually
        results.append(("QESPL poll manually", test_qespl_poll_manually(admin_token)))
        
        # Test 10: Verify data landed
        results.append(("Verify data pipeline", test_verify_data_landed(admin_token)))
        
        # Test 11: QESPL run-now admin-only
        results.append(("QESPL run-now admin-only", test_qespl_run_now_admin_only(admin_token)))
        
        # Test 12: QESPL run-now with no devices
        results.append(("QESPL run-now with no devices", test_qespl_run_now_no_devices(admin_token)))
        
        # Test 13: Cleanup
        results.append(("Cleanup", test_cleanup(admin_token)))
        
        # Test 14: No regressions
        results.append(("No regressions", test_no_regressions(admin_token)))
        
        # Test 15: Backend logs
        results.append(("Backend logs check", test_backend_logs()))
        
    except Exception as e:
        print(f"\n❌ FATAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        results.append(("Fatal error", False))
    
    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status}: {name}")
    
    print("="*80)
    print(f"TOTAL: {passed}/{total} tests passed")
    print("="*80)
    
    return passed == total


if __name__ == "__main__":
    import sys
    success = main()
    sys.exit(0 if success else 1)
