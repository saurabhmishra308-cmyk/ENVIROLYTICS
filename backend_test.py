#!/usr/bin/env python3
"""
Comprehensive Backend Regression Test Suite
Full QA verification for Envirolytics Monitor API

Tests all 25 critical endpoints as specified in the review request:
- Auth & users (3 tests)
- Instruments per-user scoping (5 tests)
- Alerts (2 tests)
- Limits (4 tests)
- Notifications (4 tests)
- Exports (3 tests)
- Misc (4 tests)
- Cleanup
"""
import requests
import sys
from typing import Dict, Optional

# Backend URL from environment
BASE_URL = "https://carbon-track-24.preview.emergentagent.com/api"

# Test credentials
ADMIN_EMAIL = "admin@envirolytics.com"
ADMIN_PASSWORD = "Admin@Envirolytics2026"

# Test data
TEST_USER_EMAIL = "qa_regression_test@example.com"
TEST_USER_PASSWORD = "QATest@2026!"
TEST_USER_NAME = "QA Regression Test User"

# Global state
admin_token: Optional[str] = None
client_token: Optional[str] = None
test_user_id: Optional[str] = None

# Test results tracking
passed = 0
failed = 0
errors = []


def log(msg: str, level: str = "INFO"):
    """Log test progress"""
    prefix = {
        "INFO": "ℹ️ ",
        "PASS": "✅",
        "FAIL": "❌",
        "WARN": "⚠️ ",
    }.get(level, "  ")
    print(f"{prefix} {msg}")


def assert_status(response: requests.Response, expected: int, test_name: str) -> bool:
    """Assert response status code"""
    global passed, failed, errors
    if response.status_code == expected:
        passed += 1
        log(f"PASS: {test_name} → {response.status_code}", "PASS")
        return True
    else:
        failed += 1
        error_msg = f"FAIL: {test_name} → Expected {expected}, got {response.status_code}"
        try:
            error_msg += f" | Body: {response.json()}"
        except:
            error_msg += f" | Body: {response.text[:200]}"
        log(error_msg, "FAIL")
        errors.append(error_msg)
        return False


def assert_field(data: dict, field: str, test_name: str) -> bool:
    """Assert field exists in response"""
    global passed, failed, errors
    if field in data:
        passed += 1
        log(f"PASS: {test_name} → Field '{field}' exists", "PASS")
        return True
    else:
        failed += 1
        error_msg = f"FAIL: {test_name} → Field '{field}' missing from response"
        log(error_msg, "FAIL")
        errors.append(error_msg)
        return False


def assert_count(data: dict, expected: int, test_name: str) -> bool:
    """Assert count in response"""
    global passed, failed, errors
    actual = data.get("count", len(data.get("instruments", [])))
    if actual == expected:
        passed += 1
        log(f"PASS: {test_name} → Count={actual}", "PASS")
        return True
    else:
        failed += 1
        error_msg = f"FAIL: {test_name} → Expected count={expected}, got {actual}"
        log(error_msg, "FAIL")
        errors.append(error_msg)
        return False


def assert_content_type(response: requests.Response, expected: str, test_name: str) -> bool:
    """Assert content-type header"""
    global passed, failed, errors
    actual = response.headers.get("content-type", "")
    if expected in actual:
        passed += 1
        log(f"PASS: {test_name} → Content-Type contains '{expected}'", "PASS")
        return True
    else:
        failed += 1
        error_msg = f"FAIL: {test_name} → Expected Content-Type to contain '{expected}', got '{actual}'"
        log(error_msg, "FAIL")
        errors.append(error_msg)
        return False


# ============================================================================
# TEST SUITE
# ============================================================================

def test_1_admin_login():
    """Test 1: POST /api/auth/login as admin → 200, JWT returned"""
    global admin_token
    log("Test 1: Admin login", "INFO")
    
    response = requests.post(f"{BASE_URL}/auth/login", json={
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD
    })
    
    if not assert_status(response, 200, "Admin login"):
        return False
    
    data = response.json()
    if assert_field(data, "access_token", "Admin login JWT"):
        admin_token = data["access_token"]
        return True
    return False


def test_2_auth_me():
    """Test 2: GET /api/auth/me → 200"""
    log("Test 2: GET /api/auth/me", "INFO")
    
    response = requests.get(f"{BASE_URL}/auth/me", headers={
        "Authorization": f"Bearer {admin_token}"
    })
    
    if not assert_status(response, 200, "GET /api/auth/me"):
        return False
    
    data = response.json()
    return assert_field(data, "email", "Auth me response")


def test_3_create_user():
    """Test 3: POST /api/admin/users/create → 200, returns user.id"""
    global test_user_id
    log("Test 3: Create test user", "INFO")
    
    response = requests.post(f"{BASE_URL}/admin/users/create", 
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "email": TEST_USER_EMAIL,
            "password": TEST_USER_PASSWORD,
            "full_name": TEST_USER_NAME,
            "role": "client",
            "location_name": "QA Test Site",
            "latitude": 26.8467,
            "longitude": 80.9462
        }
    )
    
    if not assert_status(response, 200, "Create user"):
        return False
    
    data = response.json()
    if data.get("success") and data.get("user", {}).get("id"):
        test_user_id = data["user"]["id"]
        log(f"Created test user: {test_user_id}", "INFO")
        return assert_field(data["user"], "id", "User creation response")
    return False


def test_4_register_flowmeter():
    """Test 4: POST /api/instrument-registry with QA_FM_1 → 200"""
    log("Test 4: Register flowmeter QA_FM_1", "INFO")
    
    response = requests.post(f"{BASE_URL}/instrument-registry",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "hardware_id": "QA_FM_1",
            "instrument_type": "flowmeter",
            "category": "groundwater_abstraction",
            "owner_user_id": test_user_id,
            "label": "QA Flowmeter 1",
            "location_name": "QA Test Site"
        }
    )
    
    return assert_status(response, 200, "Register flowmeter QA_FM_1")


def test_5_register_dwlr():
    """Test 5: POST /api/instrument-registry with QA_DWLR_1 → 200"""
    log("Test 5: Register DWLR QA_DWLR_1", "INFO")
    
    response = requests.post(f"{BASE_URL}/instrument-registry",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "hardware_id": "QA_DWLR_1",
            "instrument_type": "dwlr",
            "owner_user_id": test_user_id,
            "label": "QA DWLR 1"
        }
    )
    
    return assert_status(response, 200, "Register DWLR QA_DWLR_1")


def test_6_duplicate_instrument():
    """Test 6: POST /api/instrument-registry with duplicate QA_FM_1 → 409"""
    log("Test 6: Duplicate instrument registration (should fail)", "INFO")
    
    response = requests.post(f"{BASE_URL}/instrument-registry",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "hardware_id": "QA_FM_1",
            "instrument_type": "flowmeter",
            "owner_user_id": test_user_id
        }
    )
    
    return assert_status(response, 409, "Duplicate instrument → 409")


def test_7_client_login_and_list():
    """Test 7: Login as client → GET /api/instrument-registry → count=2"""
    global client_token
    log("Test 7: Client login and list instruments", "INFO")
    
    # Login as client
    response = requests.post(f"{BASE_URL}/auth/login", json={
        "email": TEST_USER_EMAIL,
        "password": TEST_USER_PASSWORD
    })
    
    if not assert_status(response, 200, "Client login"):
        return False
    
    data = response.json()
    if not assert_field(data, "access_token", "Client login JWT"):
        return False
    
    client_token = data["access_token"]
    
    # List instruments as client
    response = requests.get(f"{BASE_URL}/instrument-registry",
        headers={"Authorization": f"Bearer {client_token}"}
    )
    
    if not assert_status(response, 200, "Client list instruments"):
        return False
    
    data = response.json()
    return assert_count(data, 2, "Client sees exactly 2 instruments")


def test_8_client_filter_dwlr():
    """Test 8: GET /api/instrument-registry?instrument_type=dwlr as client → count=1"""
    log("Test 8: Client filter by instrument_type=dwlr", "INFO")
    
    response = requests.get(f"{BASE_URL}/instrument-registry?instrument_type=dwlr",
        headers={"Authorization": f"Bearer {client_token}"}
    )
    
    if not assert_status(response, 200, "Client filter DWLR"):
        return False
    
    data = response.json()
    return assert_count(data, 1, "Client sees exactly 1 DWLR")


def test_9_client_offline_alerts():
    """Test 9: GET /api/alerts/offline?hours=2 as client → 200"""
    log("Test 9: Client offline alerts (scoped)", "INFO")
    
    response = requests.get(f"{BASE_URL}/alerts/offline?hours=2",
        headers={"Authorization": f"Bearer {client_token}"}
    )
    
    if not assert_status(response, 200, "Client offline alerts"):
        return False
    
    data = response.json()
    # Should return scoped list (may be empty or contain only client's devices)
    return assert_field(data, "offline", "Offline alerts response")


def test_10_client_limit_breaches():
    """Test 10: GET /api/alerts/limit-breaches as client → 200"""
    log("Test 10: Client limit breaches", "INFO")
    
    response = requests.get(f"{BASE_URL}/alerts/limit-breaches",
        headers={"Authorization": f"Bearer {client_token}"}
    )
    
    if not assert_status(response, 200, "Client limit breaches"):
        return False
    
    data = response.json()
    return assert_field(data, "breaches", "Limit breaches response")


def test_11_create_limit_hidden():
    """Test 11: POST /api/limits with visible_to_client=false → 200"""
    log("Test 11: Create limit (hidden from client)", "INFO")
    
    response = requests.post(f"{BASE_URL}/limits",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "hardware_id": "QA_FM_1",
            "label": "QA Limit 1",
            "monthly_limit_kl": 100.0,
            "min_limit_kl": 10.0,
            "customer_email": "t@e.com",
            "visible_to_client": False,
            "is_active": True
        }
    )
    
    return assert_status(response, 200, "Create limit (hidden)")


def test_12_client_cannot_see_hidden_limit():
    """Test 12: GET /api/limits as client → empty (visible_to_client=false)"""
    log("Test 12: Client cannot see hidden limit", "INFO")
    
    response = requests.get(f"{BASE_URL}/limits",
        headers={"Authorization": f"Bearer {client_token}"}
    )
    
    if not assert_status(response, 200, "Client list limits"):
        return False
    
    data = response.json()
    return assert_count(data, 0, "Client sees 0 limits (hidden)")


def test_13_toggle_limit_visible():
    """Test 13: PUT /api/limits/QA_FM_1 with visible_to_client=true → 200"""
    log("Test 13: Toggle limit to visible", "INFO")
    
    response = requests.put(f"{BASE_URL}/limits/QA_FM_1",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "visible_to_client": True
        }
    )
    
    return assert_status(response, 200, "Toggle limit visible")


def test_14_client_can_see_visible_limit():
    """Test 14: GET /api/limits as client → count=1"""
    log("Test 14: Client can now see visible limit", "INFO")
    
    response = requests.get(f"{BASE_URL}/limits",
        headers={"Authorization": f"Bearer {client_token}"}
    )
    
    if not assert_status(response, 200, "Client list limits (visible)"):
        return False
    
    data = response.json()
    return assert_count(data, 1, "Client sees 1 limit (visible)")


def test_15_admin_list_notification_emails():
    """Test 15: GET /api/notifications/emails as admin → 200"""
    log("Test 15: Admin list notification emails", "INFO")
    
    response = requests.get(f"{BASE_URL}/notifications/emails",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    if not assert_status(response, 200, "Admin list notification emails"):
        return False
    
    data = response.json()
    return assert_field(data, "emails", "Notification emails response")


def test_16_notification_emails_max_cap():
    """Test 16: PUT /api/notifications/emails with 5 emails → 400 (max 4)"""
    log("Test 16: Notification emails max cap (should fail)", "INFO")
    
    response = requests.put(f"{BASE_URL}/notifications/emails",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "emails": [
                "ops1@example.com",
                "ops2@example.com",
                "ops3@example.com",
                "ops4@example.com",
                "ops5@example.com"
            ]
        }
    )
    
    return assert_status(response, 400, "Notification emails max cap → 400")


def test_17_notification_emails_valid():
    """Test 17: PUT /api/notifications/emails with 4 emails → 200"""
    log("Test 17: Set notification emails (4 valid)", "INFO")
    
    response = requests.put(f"{BASE_URL}/notifications/emails",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "emails": [
                "ops1@example.com",
                "ops2@example.com",
                "ops3@example.com",
                "ops4@example.com"
            ]
        }
    )
    
    return assert_status(response, 200, "Set notification emails (4 valid)")


def test_18_client_cannot_access_notifications():
    """Test 18: GET /api/notifications/emails as client → 403"""
    log("Test 18: Client cannot access notifications (should fail)", "INFO")
    
    response = requests.get(f"{BASE_URL}/notifications/emails",
        headers={"Authorization": f"Bearer {client_token}"}
    )
    
    return assert_status(response, 403, "Client access notifications → 403")


def test_19_client_export_csv():
    """Test 19: GET /api/flowmeter-mgmt/export?format=csv as client → 200"""
    log("Test 19: Client export CSV", "INFO")
    
    response = requests.get(f"{BASE_URL}/flowmeter-mgmt/export?format=csv",
        headers={"Authorization": f"Bearer {client_token}"}
    )
    
    if not assert_status(response, 200, "Client export CSV"):
        return False
    
    return assert_content_type(response, "text/csv", "CSV export content-type")


def test_20_client_dwlr_daily():
    """Test 20: GET /api/flowmeter-mgmt/dwlr/QA_DWLR_1/daily?days=7 as client → 200"""
    log("Test 20: Client DWLR daily data", "INFO")
    
    response = requests.get(f"{BASE_URL}/flowmeter-mgmt/dwlr/QA_DWLR_1/daily?days=7",
        headers={"Authorization": f"Bearer {client_token}"}
    )
    
    if not assert_status(response, 200, "Client DWLR daily"):
        return False
    
    data = response.json()
    return assert_field(data, "series", "DWLR daily response")


def test_21_client_dwlr_forbidden():
    """Test 21: GET /api/flowmeter-mgmt/dwlr/NOT_MINE/daily as client → 403"""
    log("Test 21: Client access unowned DWLR (should fail)", "INFO")
    
    response = requests.get(f"{BASE_URL}/flowmeter-mgmt/dwlr/NOT_MINE/daily?days=7",
        headers={"Authorization": f"Bearer {client_token}"}
    )
    
    return assert_status(response, 403, "Client access unowned DWLR → 403")


def test_22_weather_live():
    """Test 22: GET /api/weather/live → 200"""
    log("Test 22: Weather live data", "INFO")
    
    response = requests.get(f"{BASE_URL}/weather/live",
        headers={"Authorization": f"Bearer {client_token}"}
    )
    
    if not assert_status(response, 200, "Weather live"):
        return False
    
    data = response.json()
    return assert_field(data, "main", "Weather live response")


def test_23_audit_log_summary():
    """Test 23: GET /api/admin/audit-log/summary as admin → 200"""
    log("Test 23: Admin audit log summary", "INFO")
    
    response = requests.get(f"{BASE_URL}/admin/audit-log/summary",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    if not assert_status(response, 200, "Audit log summary"):
        return False
    
    data = response.json()
    return assert_field(data, "total_edits", "Audit log summary response")


def test_24_certificates_list():
    """Test 24: GET /api/certificates/list as admin → 200"""
    log("Test 24: Admin list certificates", "INFO")
    
    response = requests.get(f"{BASE_URL}/certificates/list",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    if not assert_status(response, 200, "Certificates list"):
        return False
    
    data = response.json()
    return assert_field(data, "certificates", "Certificates list response")


def test_25_renewals_list():
    """Test 25: GET /api/renewals as admin → 200"""
    log("Test 25: Admin list renewals", "INFO")
    
    response = requests.get(f"{BASE_URL}/renewals",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    
    if not assert_status(response, 200, "Renewals list"):
        return False
    
    data = response.json()
    return assert_field(data, "users", "Renewals list response")


# ============================================================================
# CLEANUP
# ============================================================================

def cleanup():
    """Cleanup: Delete test data"""
    log("Cleanup: Removing test data", "INFO")
    
    # Delete limit
    response = requests.delete(f"{BASE_URL}/limits/QA_FM_1",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    if response.status_code == 200:
        log("Deleted limit QA_FM_1", "INFO")
    
    # Delete instruments
    response = requests.delete(f"{BASE_URL}/instrument-registry/QA_FM_1",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    if response.status_code == 200:
        log("Deleted instrument QA_FM_1", "INFO")
    
    response = requests.delete(f"{BASE_URL}/instrument-registry/QA_DWLR_1",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    if response.status_code == 200:
        log("Deleted instrument QA_DWLR_1", "INFO")
    
    # Delete test user
    if test_user_id:
        response = requests.delete(f"{BASE_URL}/admin/users/{test_user_id}",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        if response.status_code == 200:
            log(f"Deleted test user {test_user_id}", "INFO")
    
    # Reset notification emails
    response = requests.put(f"{BASE_URL}/notifications/emails",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"emails": []}
    )
    if response.status_code == 200:
        log("Reset notification emails to []", "INFO")


# ============================================================================
# MAIN
# ============================================================================

def main():
    """Run all tests"""
    log("=" * 80, "INFO")
    log("BACKEND REGRESSION TEST SUITE", "INFO")
    log("=" * 80, "INFO")
    
    tests = [
        test_1_admin_login,
        test_2_auth_me,
        test_3_create_user,
        test_4_register_flowmeter,
        test_5_register_dwlr,
        test_6_duplicate_instrument,
        test_7_client_login_and_list,
        test_8_client_filter_dwlr,
        test_9_client_offline_alerts,
        test_10_client_limit_breaches,
        test_11_create_limit_hidden,
        test_12_client_cannot_see_hidden_limit,
        test_13_toggle_limit_visible,
        test_14_client_can_see_visible_limit,
        test_15_admin_list_notification_emails,
        test_16_notification_emails_max_cap,
        test_17_notification_emails_valid,
        test_18_client_cannot_access_notifications,
        test_19_client_export_csv,
        test_20_client_dwlr_daily,
        test_21_client_dwlr_forbidden,
        test_22_weather_live,
        test_23_audit_log_summary,
        test_24_certificates_list,
        test_25_renewals_list,
    ]
    
    for test in tests:
        try:
            test()
        except Exception as e:
            log(f"EXCEPTION in {test.__name__}: {e}", "FAIL")
            errors.append(f"EXCEPTION in {test.__name__}: {e}")
            global failed
            failed += 1
    
    # Cleanup
    try:
        cleanup()
    except Exception as e:
        log(f"Cleanup error: {e}", "WARN")
    
    # Summary
    log("=" * 80, "INFO")
    log("TEST SUMMARY", "INFO")
    log("=" * 80, "INFO")
    log(f"Total assertions: {passed + failed}", "INFO")
    log(f"Passed: {passed}", "PASS")
    log(f"Failed: {failed}", "FAIL" if failed > 0 else "INFO")
    
    if errors:
        log("=" * 80, "INFO")
        log("FAILED TESTS:", "FAIL")
        for error in errors:
            log(error, "FAIL")
    
    log("=" * 80, "INFO")
    
    # Exit code
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
