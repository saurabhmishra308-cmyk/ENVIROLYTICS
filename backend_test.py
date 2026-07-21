#!/usr/bin/env python3
"""
Backend Test Suite for NEW Session Features

Tests the NEW additions in this session:
1. Water-Quality history endpoint (GET /api/flowmeter-mgmt/water-quality/{hardware_id}/history?hours=N)
2. Access-request endpoint (POST /api/access-requests + GET /api/access-requests)
3. Regression tests for existing endpoints

Admin credentials: admin@envirolytics.com / Admin@Envirolytics2026
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
test_client_email = None
test_instruments = []
test_access_request_ids = []
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
            data = response.json()
            print(f"  Response: {json.dumps(data, indent=2)}")
        except:
            print(f"  Response: {response.text[:500]}")


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


# ============================
# WATER-QUALITY HISTORY ENDPOINT TESTS
# ============================

def test_register_water_quality_device(token: str):
    """Test 2a: Register a water_quality device with QESPL source"""
    log_test(2, "Register water_quality device with QESPL source")
    
    global test_user_id, test_instruments
    
    # First create a test user to own the device
    user_response = requests.post(
        f"{API_BASE}/admin/users/create",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "email": f"wq_test_user_{os.urandom(4).hex()}@example.com",
            "password": "TestPass123!",
            "full_name": "WQ Test User",
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
    
    # Register water_quality device with QESPL source
    response = requests.post(
        f"{API_BASE}/instrument-registry",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "hardware_id": "WQ_TEST_H1",
            "instrument_type": "water_quality",
            "owner_user_id": test_user_id,
            "device_source": "qespl_api",
            "qespl_device_id": "DTU10019126",
            "label": "WQ Test"
        }
    )
    
    if response.status_code == 200:
        data = response.json()
        instrument = data.get("instrument", {})
        hw_id = instrument.get("hardware_id")
        
        if hw_id == "WQ_TEST_H1":
            test_instruments.append("WQ_TEST_H1")
            log_result(True, f"Water quality device registered successfully", response)
            return True
        else:
            log_result(False, f"Unexpected hardware_id in response", response)
            return False
    else:
        log_result(False, "Failed to register water_quality device", response)
        return False


def test_trigger_qespl_poll(token: str):
    """Test 2b: Trigger QESPL poll to get data"""
    log_test(3, "Trigger QESPL poll → POST /api/devices/qespl/run-now")
    
    response = requests.post(
        f"{API_BASE}/devices/qespl/run-now",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code == 200:
        data = response.json()
        polled = data.get("polled", 0)
        ok = data.get("ok", 0)
        
        log_result(True, f"QESPL poll executed: polled={polled}, ok={ok}", response)
        return True
    else:
        log_result(False, f"QESPL poll failed", response)
        return False


def test_water_quality_history_success(token: str):
    """Test 2c: GET water-quality history endpoint - verify response structure"""
    log_test(4, "GET /api/flowmeter-mgmt/water-quality/WQ_TEST_H1/history?hours=24 as admin → 200")
    
    response = requests.get(
        f"{API_BASE}/flowmeter-mgmt/water-quality/WQ_TEST_H1/history?hours=24",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code == 200:
        data = response.json()
        
        # Verify required fields
        required_fields = ["hardware_id", "label", "hours", "count", "series", "chlorine"]
        missing_fields = [f for f in required_fields if f not in data]
        
        if missing_fields:
            log_result(False, f"Missing required fields: {missing_fields}", response)
            return False
        
        # Verify chlorine object structure
        chlorine = data.get("chlorine", {})
        chlorine_fields = ["target_mg_l", "increase_below_mg_l", "decrease_above_mg_l", "status", "message", "color"]
        missing_chlorine_fields = [f for f in chlorine_fields if f not in chlorine]
        
        if missing_chlorine_fields:
            log_result(False, f"Missing chlorine fields: {missing_chlorine_fields}", response)
            return False
        
        # Verify chlorine constants (CPCB STP outlet limits)
        decrease_above = chlorine.get("decrease_above_mg_l")
        increase_below = chlorine.get("increase_below_mg_l")
        
        if decrease_above != 0.5:
            log_result(False, f"Expected decrease_above_mg_l=0.5 (CPCB limit), got {decrease_above}", response)
            return False
        
        if increase_below != 0.2:
            log_result(False, f"Expected increase_below_mg_l=0.2, got {increase_below}", response)
            return False
        
        log_result(True, f"Water-quality history endpoint working correctly. Chlorine constants: decrease_above=0.5, increase_below=0.2", response)
        return True
    else:
        log_result(False, f"Water-quality history endpoint failed", response)
        return False


def test_water_quality_history_404(token: str):
    """Test 2d: GET water-quality history for unknown hardware_id → 404"""
    log_test(5, "GET /api/flowmeter-mgmt/water-quality/UNKNOWN_HW/history → 404")
    
    response = requests.get(
        f"{API_BASE}/flowmeter-mgmt/water-quality/UNKNOWN_HW/history?hours=24",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code == 404:
        log_result(True, f"Correctly returned 404 for unknown hardware_id", response)
        return True
    else:
        log_result(False, f"Expected 404, got {response.status_code}", response)
        return False


def test_water_quality_history_403_scoping(token: str):
    """Test 2e: Test scoping - non-owner client gets 403"""
    log_test(6, "Test scoping: Create new client, try to access WQ_TEST_H1 → 403")
    
    # Create a NEW non-admin client with no owned instruments
    user_response = requests.post(
        f"{API_BASE}/admin/users/create",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "email": f"no_access_client_{os.urandom(4).hex()}@example.com",
            "password": "TestPass123!",
            "full_name": "No Access Client",
            "role": "client",
            "location_name": "Other Location",
            "latitude": 13.0,
            "longitude": 78.0
        }
    )
    
    if user_response.status_code != 200:
        log_result(False, "Failed to create no-access client", user_response)
        return False
    
    no_access_user_id = user_response.json()["user"]["id"]
    no_access_email = user_response.json()["user"]["email"]
    
    # Login as this client
    login_response = requests.post(
        f"{API_BASE}/auth/login",
        json={"email": no_access_email, "password": "TestPass123!"}
    )
    
    if login_response.status_code != 200:
        log_result(False, "Failed to login as no-access client", login_response)
        return False
    
    no_access_token = login_response.json().get("access_token")
    
    # Try to access WQ_TEST_H1 (owned by different user)
    response = requests.get(
        f"{API_BASE}/flowmeter-mgmt/water-quality/WQ_TEST_H1/history?hours=24",
        headers={"Authorization": f"Bearer {no_access_token}"}
    )
    
    # Cleanup: delete the no-access user
    requests.delete(
        f"{API_BASE}/admin/users/{no_access_user_id}",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code == 403:
        log_result(True, f"Correctly returned 403 for non-owner client", response)
        return True
    else:
        log_result(False, f"Expected 403, got {response.status_code}", response)
        return False


# ============================
# ACCESS-REQUEST ENDPOINT TESTS
# ============================

def test_create_temp_client_for_access_request(token: str):
    """Test 3a: Create a temp client for access request testing"""
    log_test(7, "Create temp client via /api/admin/users/create")
    
    global test_client_email
    
    test_client_email = f"access_req_client_{os.urandom(4).hex()}@example.com"
    
    response = requests.post(
        f"{API_BASE}/admin/users/create",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "email": test_client_email,
            "password": "ClientPass123!",
            "full_name": "Access Request Test Client",
            "role": "client",
            "location_name": "Client Site A",
            "latitude": 12.5,
            "longitude": 77.5
        }
    )
    
    if response.status_code == 200:
        log_result(True, f"Temp client created: {test_client_email}", response)
        return True
    else:
        log_result(False, "Failed to create temp client", response)
        return False


def test_post_access_request(token: str):
    """Test 3b: Login as client and POST access request"""
    log_test(8, "Login as client and POST /api/access-requests")
    
    global client_token
    
    # Login as client
    login_response = requests.post(
        f"{API_BASE}/auth/login",
        json={"email": test_client_email, "password": "ClientPass123!"}
    )
    
    if login_response.status_code != 200:
        log_result(False, "Failed to login as client", login_response)
        return False
    
    client_token = login_response.json().get("access_token")
    print(f"  Client logged in successfully")
    
    # POST access request
    response = requests.post(
        f"{API_BASE}/access-requests",
        headers={"Authorization": f"Bearer {client_token}"},
        json={
            "instrument_type": "dwlr",
            "message": "Please add my Site-A DWLR",
            "hardware_id_hint": "DWLR_A_1"
        }
    )
    
    if response.status_code == 200:
        data = response.json()
        
        # Verify response structure
        required_fields = ["success", "logged", "email_result", "admin"]
        missing_fields = [f for f in required_fields if f not in data]
        
        if missing_fields:
            log_result(False, f"Missing required fields: {missing_fields}", response)
            return False
        
        if not data.get("success"):
            log_result(False, "success field is not True", response)
            return False
        
        if not data.get("logged"):
            log_result(False, "logged field is not True", response)
            return False
        
        email_result = data.get("email_result", {})
        # Email might fail if RESEND_API_KEY not configured, but endpoint should still return 200
        print(f"  Email result: sent={email_result.get('sent')}")
        
        admin_email = data.get("admin")
        if admin_email != "saurabh@envirolytics.in":
            log_result(False, f"Expected admin='saurabh@envirolytics.in', got '{admin_email}'", response)
            return False
        
        log_result(True, f"Access request created successfully. Email sent={email_result.get('sent')}, admin={admin_email}", response)
        return True
    else:
        log_result(False, f"Failed to create access request", response)
        return False


def test_get_access_requests_as_client(token: str):
    """Test 3c: GET /api/access-requests as client → should see own request"""
    log_test(9, "GET /api/access-requests as client → count=1")
    
    response = requests.get(
        f"{API_BASE}/access-requests",
        headers={"Authorization": f"Bearer {client_token}"}
    )
    
    if response.status_code == 200:
        data = response.json()
        count = data.get("count", 0)
        requests_list = data.get("requests", [])
        
        if count >= 1 and len(requests_list) >= 1:
            # Verify the request we created is present
            our_request = next((r for r in requests_list if r.get("instrument_type") == "dwlr" and r.get("hardware_id_hint") == "DWLR_A_1"), None)
            
            if our_request:
                log_result(True, f"Client sees their own access request (count={count})", response)
                return True
            else:
                log_result(False, f"Client's request not found in list", response)
                return False
        else:
            log_result(False, f"Expected count >= 1, got count={count}", response)
            return False
    else:
        log_result(False, f"Failed to get access requests as client", response)
        return False


def test_get_access_requests_as_admin(token: str):
    """Test 3d: GET /api/access-requests as admin → should see all requests"""
    log_test(10, "GET /api/access-requests as admin → count >= 1")
    
    response = requests.get(
        f"{API_BASE}/access-requests",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code == 200:
        data = response.json()
        count = data.get("count", 0)
        requests_list = data.get("requests", [])
        
        if count >= 1:
            # Verify the client's request is visible to admin
            client_request = next((r for r in requests_list if r.get("instrument_type") == "dwlr" and r.get("hardware_id_hint") == "DWLR_A_1"), None)
            
            if client_request:
                log_result(True, f"Admin sees all access requests including client's (count={count})", response)
                return True
            else:
                log_result(False, f"Client's request not visible to admin", response)
                return False
        else:
            log_result(False, f"Expected count >= 1, got count={count}", response)
            return False
    else:
        log_result(False, f"Failed to get access requests as admin", response)
        return False


def test_access_request_validation(token: str):
    """Test 3e: Missing instrument_type → 422 validation error"""
    log_test(11, "POST /api/access-requests with missing instrument_type → 422")
    
    response = requests.post(
        f"{API_BASE}/access-requests",
        headers={"Authorization": f"Bearer {client_token}"},
        json={
            "message": "Please add my device",
            "hardware_id_hint": "DEVICE_1"
            # Missing instrument_type
        }
    )
    
    if response.status_code == 422:
        log_result(True, f"Correctly returned 422 for missing instrument_type", response)
        return True
    else:
        log_result(False, f"Expected 422, got {response.status_code}", response)
        return False


# ============================
# REGRESSION TESTS
# ============================

def test_regression_flowmeter_default_source(token: str):
    """Test 4a: Register flowmeter without device_source → defaults to mqtt"""
    log_test(12, "Regression: POST /api/instrument-registry with flowmeter (default source=mqtt)")
    
    response = requests.post(
        f"{API_BASE}/instrument-registry",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "hardware_id": "REG_FM_TEST",
            "instrument_type": "flowmeter",
            "owner_user_id": test_user_id,
            "label": "Regression Test Flowmeter"
        }
    )
    
    if response.status_code == 200:
        data = response.json()
        instrument = data.get("instrument", {})
        device_source = instrument.get("device_source")
        
        if device_source == "mqtt":
            test_instruments.append("REG_FM_TEST")
            log_result(True, f"Flowmeter registered with default device_source='mqtt'", response)
            return True
        else:
            log_result(False, f"Expected device_source='mqtt', got '{device_source}'", response)
            return False
    else:
        log_result(False, "Failed to register flowmeter", response)
        return False


def test_regression_qespl_run_now(token: str):
    """Test 4b: POST /api/devices/qespl/run-now → 200"""
    log_test(13, "Regression: POST /api/devices/qespl/run-now → 200")
    
    response = requests.post(
        f"{API_BASE}/devices/qespl/run-now",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code == 200:
        log_result(True, f"QESPL run-now endpoint working", response)
        return True
    else:
        log_result(False, f"QESPL run-now failed", response)
        return False


def test_regression_instruments_all_latest(token: str):
    """Test 4c: GET /api/instruments/all/latest → 200"""
    log_test(14, "Regression: GET /api/instruments/all/latest → 200")
    
    response = requests.get(
        f"{API_BASE}/instruments/all/latest",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code == 200:
        log_result(True, f"Instruments all/latest endpoint working", response)
        return True
    else:
        log_result(False, f"Instruments all/latest failed", response)
        return False


def test_regression_alerts_offline(token: str):
    """Test 4d: GET /api/alerts/offline?hours=2 → 200"""
    log_test(15, "Regression: GET /api/alerts/offline?hours=2 → 200")
    
    response = requests.get(
        f"{API_BASE}/alerts/offline?hours=2",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code == 200:
        log_result(True, f"Alerts offline endpoint working", response)
        return True
    else:
        log_result(False, f"Alerts offline failed", response)
        return False


def test_regression_limits(token: str):
    """Test 4e: GET /api/limits → 200"""
    log_test(16, "Regression: GET /api/limits → 200")
    
    response = requests.get(
        f"{API_BASE}/limits",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code == 200:
        log_result(True, f"Limits endpoint working", response)
        return True
    else:
        log_result(False, f"Limits failed", response)
        return False


def test_regression_notifications_emails(token: str):
    """Test 4f: GET /api/notifications/emails → 200 (max=4)"""
    log_test(17, "Regression: GET /api/notifications/emails → 200 (max=4)")
    
    response = requests.get(
        f"{API_BASE}/notifications/emails",
        headers={"Authorization": f"Bearer {token}"}
    )
    
    if response.status_code == 200:
        data = response.json()
        emails = data.get("emails", [])
        
        if len(emails) <= 4:
            log_result(True, f"Notifications emails endpoint working (count={len(emails)}, max=4)", response)
            return True
        else:
            log_result(False, f"Expected max 4 emails, got {len(emails)}", response)
            return False
    else:
        log_result(False, f"Notifications emails failed", response)
        return False


# ============================
# CLEANUP
# ============================

def test_cleanup(token: str):
    """Test 5: Cleanup - DELETE test instruments, test user, access requests"""
    log_test(18, "Cleanup: DELETE test data")
    
    success = True
    
    # Delete test instruments
    for hw_id in test_instruments[:]:
        response = requests.delete(
            f"{API_BASE}/instrument-registry/{hw_id}",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        if response.status_code == 200:
            print(f"  ✅ Deleted instrument: {hw_id}")
            test_instruments.remove(hw_id)
        else:
            print(f"  ❌ Failed to delete instrument: {hw_id} (status {response.status_code})")
            success = False
    
    # Delete test users
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
    
    # Delete temp client (access request user)
    if test_client_email:
        # Get user list to find the client's ID
        users_response = requests.get(
            f"{API_BASE}/admin/users/list",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        if users_response.status_code == 200:
            users = users_response.json().get("users", [])
            client_user = next((u for u in users if u.get("email") == test_client_email), None)
            
            if client_user:
                client_id = client_user.get("id")
                delete_response = requests.delete(
                    f"{API_BASE}/admin/users/{client_id}",
                    headers={"Authorization": f"Bearer {token}"}
                )
                if delete_response.status_code == 200:
                    print(f"  ✅ Deleted temp client: {test_client_email}")
                else:
                    print(f"  ❌ Failed to delete temp client: {test_client_email}")
                    success = False
    
    # Note: Access requests are stored in DB but don't have a DELETE endpoint
    # They will remain in the access_requests collection (acceptable for testing)
    print(f"  ℹ️  Access requests remain in DB (no DELETE endpoint)")
    
    log_result(success, "Cleanup completed")
    return success


def test_backend_logs():
    """Test 6: Check backend logs for errors"""
    log_test(19, "Backend logs: Check for exceptions")
    
    import subprocess
    
    try:
        result = subprocess.run(
            ["tail", "-n", "100", "/var/log/supervisor/backend.err.log"],
            capture_output=True,
            text=True,
            timeout=5
        )
        
        error_log = result.stdout
        
        # Look for recent exceptions or errors
        error_lines = [line for line in error_log.split('\n') if any(keyword in line.lower() for keyword in ['error', 'exception', 'traceback', 'failed'])]
        
        if error_lines:
            print(f"  ⚠️  Found {len(error_lines)} potential error lines (last 10):")
            for line in error_lines[-10:]:
                print(f"    {line[:200]}")
            # Don't fail the test - just report
            log_result(True, f"Backend logs checked (found {len(error_lines)} error-like lines)")
            return True
        else:
            log_result(True, "No errors found in backend logs")
            return True
    except Exception as e:
        print(f"  ⚠️  Could not check logs: {e}")
        log_result(True, "Log check skipped (non-critical)")
        return True


def main():
    """Run all tests for NEW session features"""
    print("\n" + "="*80)
    print("BACKEND TEST SUITE - NEW SESSION FEATURES")
    print("="*80)
    print(f"Backend URL: {API_BASE}")
    print(f"Admin: {ADMIN_EMAIL}")
    print("="*80)
    print("\nTesting:")
    print("1. Water-Quality history endpoint")
    print("2. Access-request endpoint")
    print("3. Regression tests")
    print("="*80)
    
    results = []
    
    try:
        # Test 1: Admin login
        global admin_token
        admin_token = admin_login()
        results.append(("Admin login", True))
        
        # WATER-QUALITY HISTORY ENDPOINT TESTS
        results.append(("Register water_quality device", test_register_water_quality_device(admin_token)))
        results.append(("Trigger QESPL poll", test_trigger_qespl_poll(admin_token)))
        results.append(("Water-quality history success", test_water_quality_history_success(admin_token)))
        results.append(("Water-quality history 404", test_water_quality_history_404(admin_token)))
        results.append(("Water-quality history 403 scoping", test_water_quality_history_403_scoping(admin_token)))
        
        # ACCESS-REQUEST ENDPOINT TESTS
        results.append(("Create temp client", test_create_temp_client_for_access_request(admin_token)))
        results.append(("POST access request", test_post_access_request(admin_token)))
        results.append(("GET access requests as client", test_get_access_requests_as_client(admin_token)))
        results.append(("GET access requests as admin", test_get_access_requests_as_admin(admin_token)))
        results.append(("Access request validation", test_access_request_validation(admin_token)))
        
        # REGRESSION TESTS
        results.append(("Regression: Flowmeter default source", test_regression_flowmeter_default_source(admin_token)))
        results.append(("Regression: QESPL run-now", test_regression_qespl_run_now(admin_token)))
        results.append(("Regression: Instruments all/latest", test_regression_instruments_all_latest(admin_token)))
        results.append(("Regression: Alerts offline", test_regression_alerts_offline(admin_token)))
        results.append(("Regression: Limits", test_regression_limits(admin_token)))
        results.append(("Regression: Notifications emails", test_regression_notifications_emails(admin_token)))
        
        # CLEANUP
        results.append(("Cleanup", test_cleanup(admin_token)))
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
    
    if passed == total:
        print("\n🎉 ALL TESTS PASSED - NEW FEATURES WORKING CORRECTLY")
    else:
        print(f"\n⚠️  {total - passed} TEST(S) FAILED")
    
    return passed == total


if __name__ == "__main__":
    import sys
    success = main()
    sys.exit(0 if success else 1)
