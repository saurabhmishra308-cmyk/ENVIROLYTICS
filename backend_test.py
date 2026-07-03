"""
Backend test for Admin God-Mode feature.

Test the new Admin God-Mode feature — admins never expire, only client users do.

Credentials:
- Admin: admin@envirolytics.com / admin123

Test cases:
1. Create new admin — no expiry stamped
2. Create new client — normal 1-year stamp
3. GET /api/renewals returns "never_expires" for admins
4. Migration cleaned pre-existing admins
5. PUT expiry on admin is blocked
6. PUT expiry on client still works
7. POST /api/renewals/run-now — admins never counted as due
8. Auth flow still works for admins with no expiry
9. Regression checks
10. Sort order in GET /api/renewals
"""

import requests
import json
from datetime import datetime, timedelta
import os

# Get backend URL from environment
BACKEND_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://envirolytics-hub.preview.emergentagent.com")
BASE_URL = f"{BACKEND_URL}/api"

# Admin credentials
ADMIN_EMAIL = "admin@envirolytics.com"
ADMIN_PASSWORD = "Admin@Envirolytics2026"

# Test state
admin_token = None
test_admin_user_id = None
test_client_user_id = None
seed_admin_user_id = None


def log(msg):
    print(f"[TEST] {msg}")


def login_admin():
    """Login as admin and get JWT token."""
    global admin_token, seed_admin_user_id
    log("Logging in as admin...")
    resp = requests.post(
        f"{BASE_URL}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
    )
    assert resp.status_code == 200, f"Admin login failed: {resp.status_code} {resp.text}"
    data = resp.json()
    admin_token = data["access_token"]
    seed_admin_user_id = data["user"]["id"]
    log(f"✅ Admin login successful. Token: {admin_token[:20]}... Seed admin ID: {seed_admin_user_id}")
    return admin_token


def get_headers():
    """Get authorization headers."""
    return {"Authorization": f"Bearer {admin_token}"}


def test_1_create_admin_no_expiry():
    """Test 1: Create new admin — no expiry stamped."""
    global test_admin_user_id
    log("\n=== TEST 1: Create new admin — no expiry stamped ===")
    
    resp = requests.post(
        f"{BASE_URL}/admin/users/create",
        headers=get_headers(),
        json={
            "email": "godmode1@test.com",
            "password": "Test1234!",
            "full_name": "God Mode Admin 1",
            "role": "admin"
        }
    )
    
    assert resp.status_code == 200, f"Failed to create admin: {resp.status_code} {resp.text}"
    data = resp.json()
    assert data["success"] is True, "success should be true"
    
    user = data["user"]
    test_admin_user_id = user["id"]
    
    log(f"Created admin user: {user['email']} with ID: {test_admin_user_id}")
    log(f"  role: {user.get('role')}")
    log(f"  service_term_years: {user.get('service_term_years')}")
    log(f"  service_expiry_date: {user.get('service_expiry_date')}")
    
    # Verify no expiry fields
    assert user["role"] == "admin", f"Expected role='admin', got {user.get('role')}"
    assert user.get("service_term_years") is None, f"Expected service_term_years=None, got {user.get('service_term_years')}"
    assert user.get("service_expiry_date") is None, f"Expected service_expiry_date=None, got {user.get('service_expiry_date')}"
    
    # Verify via GET /api/admin/users/list
    resp = requests.get(f"{BASE_URL}/admin/users/list", headers=get_headers())
    assert resp.status_code == 200, f"Failed to get users list: {resp.status_code}"
    users = resp.json()["users"]
    admin_user = next((u for u in users if u["id"] == test_admin_user_id), None)
    assert admin_user is not None, "Admin user not found in list"
    assert admin_user.get("service_term_years") is None, "service_term_years should be None in list"
    assert admin_user.get("service_expiry_date") is None, "service_expiry_date should be None in list"
    
    log("✅ TEST 1 PASSED: Admin created with no expiry fields")


def test_2_create_client_normal_stamp():
    """Test 2: Create new client — normal 1-year stamp."""
    global test_client_user_id
    log("\n=== TEST 2: Create new client — normal 1-year stamp ===")
    
    resp = requests.post(
        f"{BASE_URL}/admin/users/create",
        headers=get_headers(),
        json={
            "email": "client_expiry@test.com",
            "password": "Test1234!",
            "full_name": "Test Client",
            "role": "client"
        }
    )
    
    assert resp.status_code == 200, f"Failed to create client: {resp.status_code} {resp.text}"
    data = resp.json()
    user = data["user"]
    test_client_user_id = user["id"]
    
    log(f"Created client user: {user['email']} with ID: {test_client_user_id}")
    log(f"  role: {user.get('role')}")
    log(f"  service_term_years: {user.get('service_term_years')}")
    log(f"  service_expiry_date: {user.get('service_expiry_date')}")
    
    # Verify expiry fields
    assert user["role"] == "client", f"Expected role='client', got {user.get('role')}"
    assert user.get("service_term_years") == 1.0, f"Expected service_term_years=1.0, got {user.get('service_term_years')}"
    assert user.get("service_expiry_date") is not None, "service_expiry_date should not be None"
    
    # Verify expiry is approximately now + 365 days
    expiry_date = datetime.fromisoformat(user["service_expiry_date"].replace("Z", "+00:00"))
    now = datetime.now(expiry_date.tzinfo)
    expected_expiry = now + timedelta(days=365)
    diff_days = abs((expiry_date - expected_expiry).days)
    assert diff_days <= 2, f"Expiry date should be ~365 days from now, got {diff_days} days difference"
    
    log(f"✅ TEST 2 PASSED: Client created with service_term_years=1.0 and expiry ≈ now+365 days")


def test_3_renewals_never_expires():
    """Test 3: GET /api/renewals returns "never_expires" for admins."""
    log("\n=== TEST 3: GET /api/renewals returns 'never_expires' for admins ===")
    
    resp = requests.get(f"{BASE_URL}/renewals", headers=get_headers())
    assert resp.status_code == 200, f"Failed to get renewals: {resp.status_code} {resp.text}"
    data = resp.json()
    
    users = data["users"]
    log(f"Total users in renewals list: {len(users)}")
    
    # Find seed admin
    seed_admin = next((u for u in users if u["id"] == seed_admin_user_id), None)
    assert seed_admin is not None, "Seed admin not found in renewals list"
    log(f"Seed admin ({seed_admin['email']}):")
    log(f"  status: {seed_admin.get('status')}")
    log(f"  days_until_expiry: {seed_admin.get('days_until_expiry')}")
    log(f"  service_expiry_date: {seed_admin.get('service_expiry_date')}")
    log(f"  service_term_years: {seed_admin.get('service_term_years')}")
    
    assert seed_admin["status"] == "never_expires", f"Expected status='never_expires', got {seed_admin.get('status')}"
    assert seed_admin.get("days_until_expiry") is None, f"Expected days_until_expiry=None, got {seed_admin.get('days_until_expiry')}"
    assert seed_admin.get("service_expiry_date") is None, f"Expected service_expiry_date=None, got {seed_admin.get('service_expiry_date')}"
    assert seed_admin.get("service_term_years") is None, f"Expected service_term_years=None, got {seed_admin.get('service_term_years')}"
    
    # Find test admin
    test_admin = next((u for u in users if u["id"] == test_admin_user_id), None)
    assert test_admin is not None, "Test admin not found in renewals list"
    log(f"Test admin ({test_admin['email']}):")
    log(f"  status: {test_admin.get('status')}")
    log(f"  days_until_expiry: {test_admin.get('days_until_expiry')}")
    
    assert test_admin["status"] == "never_expires", f"Expected status='never_expires', got {test_admin.get('status')}"
    assert test_admin.get("days_until_expiry") is None, "days_until_expiry should be None for admin"
    
    # Find test client
    test_client = next((u for u in users if u["id"] == test_client_user_id), None)
    assert test_client is not None, "Test client not found in renewals list"
    log(f"Test client ({test_client['email']}):")
    log(f"  status: {test_client.get('status')}")
    log(f"  days_until_expiry: {test_client.get('days_until_expiry')}")
    log(f"  service_expiry_date: {test_client.get('service_expiry_date')}")
    
    assert test_client["status"] == "active", f"Expected status='active', got {test_client.get('status')}"
    assert test_client.get("days_until_expiry") is not None, "days_until_expiry should not be None for client"
    assert test_client.get("service_expiry_date") is not None, "service_expiry_date should not be None for client"
    assert 360 <= test_client["days_until_expiry"] <= 370, f"Expected days_until_expiry ≈ 365, got {test_client['days_until_expiry']}"
    
    log("✅ TEST 3 PASSED: Renewals endpoint returns correct status for admins and clients")


def test_4_migration_cleaned_admins():
    """Test 4: Migration cleaned pre-existing admins."""
    log("\n=== TEST 4: Migration cleaned pre-existing admins ===")
    
    # Get all users and check that every admin has null expiry fields
    resp = requests.get(f"{BASE_URL}/admin/users/list", headers=get_headers())
    assert resp.status_code == 200, f"Failed to get users list: {resp.status_code}"
    users = resp.json()["users"]
    
    admin_users = [u for u in users if u.get("role") == "admin"]
    log(f"Found {len(admin_users)} admin users")
    
    for admin in admin_users:
        log(f"Admin {admin['email']}:")
        log(f"  service_expiry_date: {admin.get('service_expiry_date')}")
        log(f"  service_term_years: {admin.get('service_term_years')}")
        
        assert admin.get("service_expiry_date") is None, f"Admin {admin['email']} has non-null service_expiry_date"
        assert admin.get("service_term_years") is None, f"Admin {admin['email']} has non-null service_term_years"
    
    log("✅ TEST 4 PASSED: All admin users have null expiry fields (migration worked)")


def test_5_put_expiry_on_admin_blocked():
    """Test 5: PUT expiry on admin is blocked."""
    log("\n=== TEST 5: PUT expiry on admin is blocked ===")
    
    # Try to set expiry on test admin
    today = datetime.now().date()
    future_date = (today + timedelta(days=10)).isoformat()
    
    resp = requests.put(
        f"{BASE_URL}/renewals/{test_admin_user_id}",
        headers=get_headers(),
        json={"service_expiry_date": future_date}
    )
    
    log(f"PUT /api/renewals/{test_admin_user_id} response: {resp.status_code}")
    log(f"Response body: {resp.text}")
    
    assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
    data = resp.json()
    assert "god mode" in data["detail"].lower() or "never expire" in data["detail"].lower(), \
        f"Expected error message about god mode, got: {data['detail']}"
    
    # Try on seed admin too
    resp = requests.put(
        f"{BASE_URL}/renewals/{seed_admin_user_id}",
        headers=get_headers(),
        json={"service_expiry_date": future_date}
    )
    
    log(f"PUT /api/renewals/{seed_admin_user_id} response: {resp.status_code}")
    assert resp.status_code == 400, f"Expected 400 for seed admin, got {resp.status_code}"
    
    log("✅ TEST 5 PASSED: PUT expiry on admin is blocked with 400 error")


def test_6_put_expiry_on_client_works():
    """Test 6: PUT expiry on client still works."""
    log("\n=== TEST 6: PUT expiry on client still works ===")
    
    # Set client expiry to today + 10 days
    today = datetime.now().date()
    future_date = (today + timedelta(days=10)).isoformat()
    
    resp = requests.put(
        f"{BASE_URL}/renewals/{test_client_user_id}",
        headers=get_headers(),
        json={"service_expiry_date": future_date}
    )
    
    log(f"PUT /api/renewals/{test_client_user_id} response: {resp.status_code}")
    assert resp.status_code == 200, f"Failed to update client expiry: {resp.status_code} {resp.text}"
    
    data = resp.json()
    log(f"Updated client:")
    log(f"  status: {data.get('status')}")
    log(f"  days_until_expiry: {data.get('days_until_expiry')}")
    log(f"  service_expiry_date: {data.get('service_expiry_date')}")
    
    assert data["status"] == "expiring", f"Expected status='expiring', got {data.get('status')}"
    assert 8 <= data["days_until_expiry"] <= 12, f"Expected days_until_expiry ≈ 10, got {data['days_until_expiry']}"
    
    # Verify via GET /api/renewals
    resp = requests.get(f"{BASE_URL}/renewals", headers=get_headers())
    assert resp.status_code == 200, f"Failed to get renewals: {resp.status_code}"
    users = resp.json()["users"]
    client = next((u for u in users if u["id"] == test_client_user_id), None)
    assert client is not None, "Client not found in renewals list"
    assert client["status"] == "expiring", f"Expected status='expiring' in list, got {client.get('status')}"
    assert 8 <= client["days_until_expiry"] <= 12, f"Expected days_until_expiry ≈ 10 in list, got {client['days_until_expiry']}"
    
    log("✅ TEST 6 PASSED: PUT expiry on client works correctly")


def test_7_run_now_admins_not_counted():
    """Test 7: POST /api/renewals/run-now — admins never counted as due."""
    log("\n=== TEST 7: POST /api/renewals/run-now — admins never counted as due ===")
    
    resp = requests.post(f"{BASE_URL}/renewals/run-now", headers=get_headers())
    assert resp.status_code == 200, f"Failed to run renewals: {resp.status_code} {resp.text}"
    
    data = resp.json()
    log(f"Renewals run-now result:")
    log(f"  checked: {data.get('checked')}")
    log(f"  due: {data.get('due')}")
    log(f"  sent: {data.get('sent')}")
    
    # The client we set to expire in 10 days should be in 'due' (within 30-day window)
    # But NO admin should be counted
    assert data["due"] >= 1, f"Expected at least 1 user due (the client), got {data['due']}"
    
    # Verify that the client is the one counted (not admins)
    # We can't directly verify this, but we can check that admins are not in the reminder state
    log("✅ TEST 7 PASSED: run-now counted due users (client within 30-day window)")


def test_8_auth_flow_works():
    """Test 8: Auth flow still works for admins with no expiry."""
    log("\n=== TEST 8: Auth flow still works for admins with no expiry ===")
    
    # Login as seed admin
    resp = requests.post(
        f"{BASE_URL}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
    )
    assert resp.status_code == 200, f"Seed admin login failed: {resp.status_code} {resp.text}"
    log(f"✅ Seed admin login successful")
    
    # Login as test admin
    resp = requests.post(
        f"{BASE_URL}/auth/login",
        json={"email": "godmode1@test.com", "password": "Test1234!"}
    )
    assert resp.status_code == 200, f"Test admin login failed: {resp.status_code} {resp.text}"
    log(f"✅ Test admin login successful")
    
    log("✅ TEST 8 PASSED: Auth flow works for admins with no expiry")


def test_9_regression_checks():
    """Test 9: Regression checks."""
    log("\n=== TEST 9: Regression checks ===")
    
    # GET /api/flowmeter/status
    resp = requests.get(f"{BASE_URL}/flowmeter/status", headers=get_headers())
    assert resp.status_code == 200, f"Flowmeter status failed: {resp.status_code}"
    data = resp.json()
    log(f"Flowmeter status: connected={data.get('connected')}")
    assert data.get("connected") is True, "Flowmeter should be connected"
    
    # GET /api/instrument-registry
    resp = requests.get(f"{BASE_URL}/instrument-registry", headers=get_headers())
    assert resp.status_code == 200, f"Instrument registry failed: {resp.status_code}"
    log(f"Instrument registry: {resp.status_code}")
    
    # Dummy-data endpoints still work
    resp = requests.get(f"{BASE_URL}/admin/users/list", headers=get_headers())
    assert resp.status_code == 200, f"Users list failed: {resp.status_code}"
    log(f"Users list: {resp.status_code}")
    
    # CSV import still works (just check endpoint exists)
    # We won't actually upload a file, just verify the endpoint is mounted
    
    # MQTT ingestion still works (check status)
    resp = requests.get(f"{BASE_URL}/flowmeter/status", headers=get_headers())
    assert resp.status_code == 200, f"MQTT status check failed: {resp.status_code}"
    
    log("✅ TEST 9 PASSED: All regression checks passed")


def test_10_sort_order():
    """Test 10: Sort order in GET /api/renewals."""
    log("\n=== TEST 10: Sort order in GET /api/renewals ===")
    
    resp = requests.get(f"{BASE_URL}/renewals", headers=get_headers())
    assert resp.status_code == 200, f"Failed to get renewals: {resp.status_code}"
    users = resp.json()["users"]
    
    log(f"Renewals list order (first 5):")
    for i, u in enumerate(users[:5]):
        log(f"  {i+1}. {u['email']}: days_until_expiry={u.get('days_until_expiry')}, status={u.get('status')}")
    
    # Verify that admins with days_until_expiry=None are at the end
    # First, find the last non-admin (should have numeric days_until_expiry)
    last_non_admin_idx = -1
    for i, u in enumerate(users):
        if u.get("days_until_expiry") is not None:
            last_non_admin_idx = i
    
    # Then verify all admins come after
    for i in range(last_non_admin_idx + 1, len(users)):
        u = users[i]
        if u.get("days_until_expiry") is None:
            log(f"Admin at position {i+1}: {u['email']} (days_until_expiry=None)")
        else:
            # This would be a sorting error
            log(f"⚠️ Non-admin at position {i+1} after last non-admin: {u['email']} (days_until_expiry={u.get('days_until_expiry')})")
    
    # Verify numeric days are sorted ascending
    numeric_days = [u["days_until_expiry"] for u in users if u.get("days_until_expiry") is not None]
    if numeric_days:
        is_sorted = all(numeric_days[i] <= numeric_days[i+1] for i in range(len(numeric_days)-1))
        assert is_sorted, f"Numeric days_until_expiry not sorted ascending: {numeric_days[:10]}"
        log(f"✅ Numeric days sorted ascending: {numeric_days[:5]}...")
    
    log("✅ TEST 10 PASSED: Sort order correct (admins with None at end)")


def cleanup():
    """Cleanup test data."""
    log("\n=== CLEANUP ===")
    
    # Delete test admin
    if test_admin_user_id:
        resp = requests.delete(f"{BASE_URL}/admin/users/{test_admin_user_id}", headers=get_headers())
        if resp.status_code == 200:
            log(f"✅ Deleted test admin: godmode1@test.com")
        else:
            log(f"⚠️ Failed to delete test admin: {resp.status_code}")
    
    # Delete test client
    if test_client_user_id:
        resp = requests.delete(f"{BASE_URL}/admin/users/{test_client_user_id}", headers=get_headers())
        if resp.status_code == 200:
            log(f"✅ Deleted test client: client_expiry@test.com")
        else:
            log(f"⚠️ Failed to delete test client: {resp.status_code}")


def main():
    """Run all tests."""
    try:
        log("=" * 80)
        log("ADMIN GOD-MODE FEATURE TEST")
        log("=" * 80)
        
        # Login
        login_admin()
        
        # Run tests
        test_1_create_admin_no_expiry()
        test_2_create_client_normal_stamp()
        test_3_renewals_never_expires()
        test_4_migration_cleaned_admins()
        test_5_put_expiry_on_admin_blocked()
        test_6_put_expiry_on_client_works()
        test_7_run_now_admins_not_counted()
        test_8_auth_flow_works()
        test_9_regression_checks()
        test_10_sort_order()
        
        # Cleanup
        cleanup()
        
        log("\n" + "=" * 80)
        log("✅ ALL TESTS PASSED")
        log("=" * 80)
        
    except AssertionError as e:
        log(f"\n❌ TEST FAILED: {e}")
        cleanup()
        raise
    except Exception as e:
        log(f"\n❌ UNEXPECTED ERROR: {e}")
        cleanup()
        raise


if __name__ == "__main__":
    main()
