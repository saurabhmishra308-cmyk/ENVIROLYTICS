#!/usr/bin/env python3
"""
Focused regression smoke test for MongoDB index changes.
Verifies that new unique indexes are enforced gracefully (409/400, not 500).
"""
import requests
import sys
from datetime import datetime

# Backend URL from frontend/.env
BASE_URL = "https://carbon-track-24.preview.emergentagent.com/api"

# Test credentials from /app/memory/test_credentials.md
ADMIN_EMAIL = "admin@envirolytics.com"
ADMIN_PASSWORD = "Admin@Envirolytics2026"

class IndexTestRunner:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.admin_token = None
        self.client_token = None
        self.test_user_id = None
        self.test_user_email = None
        self.test_user_password = None
        self.test_hw_id = "IDX_TEST_FM_1"
        
    def log(self, msg):
        print(f"  {msg}")
    
    def assert_status(self, response, expected, test_name):
        if response.status_code == expected:
            self.passed += 1
            self.log(f"✅ {test_name}")
            return True
        else:
            self.failed += 1
            self.log(f"❌ {test_name}")
            self.log(f"   Expected {expected}, got {response.status_code}")
            try:
                self.log(f"   Response: {response.json()}")
            except:
                self.log(f"   Response: {response.text[:200]}")
            return False
    
    def assert_status_in(self, response, expected_list, test_name):
        """Assert status is one of the expected values"""
        if response.status_code in expected_list:
            self.passed += 1
            self.log(f"✅ {test_name} (got {response.status_code})")
            return True
        else:
            self.failed += 1
            self.log(f"❌ {test_name}")
            self.log(f"   Expected one of {expected_list}, got {response.status_code}")
            try:
                self.log(f"   Response: {response.json()}")
            except:
                self.log(f"   Response: {response.text[:200]}")
            return False
    
    def assert_not_500(self, response, test_name):
        """Assert that response is NOT a 500 error"""
        if response.status_code != 500:
            self.passed += 1
            self.log(f"✅ {test_name} (got {response.status_code}, not 500)")
            return True
        else:
            self.failed += 1
            self.log(f"❌ {test_name} - Got 500 Internal Server Error!")
            try:
                self.log(f"   Response: {response.json()}")
            except:
                self.log(f"   Response: {response.text[:500]}")
            return False
    
    def assert_contains(self, data, key, test_name):
        if key in data:
            self.passed += 1
            self.log(f"✅ {test_name}")
            return True
        else:
            self.failed += 1
            self.log(f"❌ {test_name}")
            self.log(f"   Key '{key}' not found in response")
            return False

    def step_1_admin_login(self):
        """Step 1: POST /api/auth/login as admin → 200 with valid JWT"""
        print("\n📝 Step 1: Admin Login")
        
        resp = requests.post(f"{BASE_URL}/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        
        if self.assert_status(resp, 200, "Admin login returns 200"):
            data = resp.json()
            if self.assert_contains(data, "access_token", "Response contains access_token"):
                self.admin_token = data["access_token"]
                self.log(f"   Admin token obtained")

    def step_2_get_instrument_registry(self):
        """Step 2: GET /api/instrument-registry → 200"""
        print("\n📝 Step 2: GET /api/instrument-registry")
        
        if not self.admin_token:
            self.log("⚠️  Skipping - no admin token")
            return
        
        headers = {"Authorization": f"Bearer {self.admin_token}"}
        resp = requests.get(f"{BASE_URL}/instrument-registry", headers=headers)
        self.assert_status(resp, 200, "GET /instrument-registry returns 200")

    def step_3_create_test_user(self):
        """Step 3: POST /api/admin/users/create with fresh email/password → 200 with user.id"""
        print("\n📝 Step 3: Create Test User")
        
        if not self.admin_token:
            self.log("⚠️  Skipping - no admin token")
            return
        
        headers = {"Authorization": f"Bearer {self.admin_token}"}
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.test_user_email = f"idx_test_{timestamp}@envirolytics.com"
        self.test_user_password = "IdxTest@2026"
        
        resp = requests.post(f"{BASE_URL}/admin/users/create", headers=headers, json={
            "email": self.test_user_email,
            "password": self.test_user_password,
            "full_name": "Index Test User",
            "role": "client",
            "location_name": "Index Test Location",
            "latitude": 26.8467,
            "longitude": 80.9462
        })
        
        if self.assert_status(resp, 200, "Create test user returns 200"):
            data = resp.json()
            if self.assert_contains(data, "user", "Response contains user object"):
                user = data["user"]
                if self.assert_contains(user, "id", "User object contains id"):
                    self.test_user_id = user["id"]
                    self.log(f"   Created user ID: {self.test_user_id}")

    def step_4_register_instrument(self):
        """Step 4: POST /api/instrument-registry with test hardware_id → 200"""
        print("\n📝 Step 4: Register Instrument (First Time)")
        
        if not self.admin_token or not self.test_user_id:
            self.log("⚠️  Skipping - no admin token or test user")
            return
        
        headers = {"Authorization": f"Bearer {self.admin_token}"}
        resp = requests.post(f"{BASE_URL}/instrument-registry", headers=headers, json={
            "hardware_id": self.test_hw_id,
            "instrument_type": "flowmeter",
            "label": "Index Test Flowmeter",
            "owner_user_id": self.test_user_id,
            "category": "groundwater_abstraction",
            "location_name": "Test Site",
            "latitude": 26.85,
            "longitude": 80.95
        })
        
        self.assert_status(resp, 200, "Register instrument returns 200")

    def step_5_duplicate_instrument_unique_index(self):
        """Step 5: POST /api/instrument-registry with SAME hardware_id → 409/400 (NOT 500)"""
        print("\n📝 Step 5: Duplicate Instrument Registration (Unique Index Test)")
        
        if not self.admin_token or not self.test_user_id:
            self.log("⚠️  Skipping - no admin token or test user")
            return
        
        headers = {"Authorization": f"Bearer {self.admin_token}"}
        resp = requests.post(f"{BASE_URL}/instrument-registry", headers=headers, json={
            "hardware_id": self.test_hw_id,
            "instrument_type": "flowmeter",
            "label": "Duplicate Test Flowmeter",
            "owner_user_id": self.test_user_id,
            "category": "groundwater_abstraction",
            "location_name": "Test Site 2",
            "latitude": 26.86,
            "longitude": 80.96
        })
        
        # Should get 409 or 400, NOT 500
        if self.assert_not_500(resp, "Duplicate hardware_id does NOT return 500"):
            self.assert_status_in(resp, [400, 409], "Duplicate hardware_id returns 400 or 409 (graceful)")

    def step_6_client_login(self):
        """Step 6: Login as the new client"""
        print("\n📝 Step 6: Client Login")
        
        if not self.test_user_email or not self.test_user_password:
            self.log("⚠️  Skipping - no test user credentials")
            return
        
        resp = requests.post(f"{BASE_URL}/auth/login", json={
            "email": self.test_user_email,
            "password": self.test_user_password
        })
        
        if self.assert_status(resp, 200, "Client login returns 200"):
            data = resp.json()
            if self.assert_contains(data, "access_token", "Response contains access_token"):
                self.client_token = data["access_token"]
                self.log(f"   Client token obtained")

    def step_7_client_get_instruments(self):
        """Step 7: GET /api/instrument-registry as client → 200, count=1"""
        print("\n📝 Step 7: Client GET Instruments")
        
        if not self.client_token:
            self.log("⚠️  Skipping - no client token")
            return
        
        headers = {"Authorization": f"Bearer {self.client_token}"}
        resp = requests.get(f"{BASE_URL}/instrument-registry", headers=headers)
        
        if self.assert_status(resp, 200, "Client GET /instrument-registry returns 200"):
            data = resp.json()
            count = data.get("count", 0)
            if count == 1:
                self.passed += 1
                self.log(f"✅ Client sees exactly 1 instrument (scoped correctly)")
            else:
                self.failed += 1
                self.log(f"❌ Client sees {count} instruments, expected 1")

    def step_8_client_offline_alerts(self):
        """Step 8: GET /api/alerts/offline?hours=2 → 200, scoped"""
        print("\n📝 Step 8: Client GET Offline Alerts")
        
        if not self.client_token:
            self.log("⚠️  Skipping - no client token")
            return
        
        headers = {"Authorization": f"Bearer {self.client_token}"}
        resp = requests.get(f"{BASE_URL}/alerts/offline?hours=2", headers=headers)
        self.assert_status(resp, 200, "Client GET /alerts/offline returns 200 (scoped)")

    def step_9_client_limit_breaches(self):
        """Step 9: GET /api/alerts/limit-breaches → 200"""
        print("\n📝 Step 9: Client GET Limit Breaches")
        
        if not self.client_token:
            self.log("⚠️  Skipping - no client token")
            return
        
        headers = {"Authorization": f"Bearer {self.client_token}"}
        resp = requests.get(f"{BASE_URL}/alerts/limit-breaches", headers=headers)
        self.assert_status(resp, 200, "Client GET /alerts/limit-breaches returns 200")

    def step_10_admin_create_limit(self):
        """Step 10: POST /api/limits as admin → 200"""
        print("\n📝 Step 10: Admin Create Limit")
        
        if not self.admin_token:
            self.log("⚠️  Skipping - no admin token")
            return
        
        headers = {"Authorization": f"Bearer {self.admin_token}"}
        resp = requests.post(f"{BASE_URL}/limits", headers=headers, json={
            "hardware_id": self.test_hw_id,
            "monthly_limit_kl": 100,
            "min_limit_kl": 10,
            "customer_email": "t@e.com",
            "visible_to_client": True
        })
        
        self.assert_status(resp, 200, "Admin POST /limits returns 200")

    def step_11_duplicate_limit_unique_index(self):
        """Step 11: POST /api/limits with SAME hardware_id → 409 (unique index)"""
        print("\n📝 Step 11: Duplicate Limit Creation (Unique Index Test)")
        
        if not self.admin_token:
            self.log("⚠️  Skipping - no admin token")
            return
        
        headers = {"Authorization": f"Bearer {self.admin_token}"}
        resp = requests.post(f"{BASE_URL}/limits", headers=headers, json={
            "hardware_id": self.test_hw_id,
            "monthly_limit_kl": 200,
            "min_limit_kl": 20,
            "customer_email": "t2@e.com",
            "visible_to_client": False
        })
        
        # Should get 409 (already exists)
        if self.assert_not_500(resp, "Duplicate limit hardware_id does NOT return 500"):
            self.assert_status(resp, 409, "Duplicate limit returns 409 (already exists)")

    def step_12_client_export_csv(self):
        """Step 12: GET /api/flowmeter-mgmt/export?format=csv as client → 200"""
        print("\n📝 Step 12: Client Export CSV")
        
        if not self.client_token:
            self.log("⚠️  Skipping - no client token")
            return
        
        headers = {"Authorization": f"Bearer {self.client_token}"}
        resp = requests.get(f"{BASE_URL}/flowmeter-mgmt/export?format=csv", headers=headers)
        self.assert_status(resp, 200, "Client GET /flowmeter-mgmt/export returns 200")

    def step_13_client_dwlr_daily(self):
        """Step 13: GET /api/flowmeter-mgmt/dwlr/{hw_id}/daily?days=7 → 403 (not a DWLR)"""
        print("\n📝 Step 13: Client GET DWLR Daily (Should Fail - Not a DWLR)")
        
        if not self.client_token:
            self.log("⚠️  Skipping - no client token")
            return
        
        headers = {"Authorization": f"Bearer {self.client_token}"}
        resp = requests.get(f"{BASE_URL}/flowmeter-mgmt/dwlr/{self.test_hw_id}/daily?days=7", headers=headers)
        self.assert_status(resp, 403, "Client GET DWLR daily for flowmeter returns 403 (not a DWLR)")

    def step_14_cleanup(self):
        """Step 14: Cleanup - DELETE instrument, limit, and user"""
        print("\n📝 Step 14: Cleanup")
        
        if not self.admin_token:
            self.log("⚠️  Skipping - no admin token")
            return
        
        headers = {"Authorization": f"Bearer {self.admin_token}"}
        
        # Delete limit
        resp = requests.delete(f"{BASE_URL}/limits/{self.test_hw_id}", headers=headers)
        if resp.status_code == 200:
            self.passed += 1
            self.log(f"✅ Deleted limit for {self.test_hw_id}")
        else:
            self.log(f"⚠️  Could not delete limit (status {resp.status_code})")
        
        # Delete instrument
        resp = requests.delete(f"{BASE_URL}/instrument-registry/{self.test_hw_id}", headers=headers)
        if resp.status_code == 200:
            self.passed += 1
            self.log(f"✅ Deleted instrument {self.test_hw_id}")
        else:
            self.log(f"⚠️  Could not delete instrument (status {resp.status_code})")
        
        # Delete user
        if self.test_user_id:
            resp = requests.delete(f"{BASE_URL}/admin/users/{self.test_user_id}", headers=headers)
            if resp.status_code == 200:
                self.passed += 1
                self.log(f"✅ Deleted test user {self.test_user_id}")
            else:
                self.log(f"⚠️  Could not delete user (status {resp.status_code})")

    def check_backend_logs(self):
        """Check backend logs for exceptions/tracebacks"""
        print("\n📝 Backend Log Check")
        self.log("Note: Log check requires manual inspection of /var/log/supervisor/backend.*.log")
        self.log("Looking for: exceptions, tracebacks, or errors after startup")

    def run(self):
        print("=" * 80)
        print("🧪 MONGODB INDEX REGRESSION TEST - Envirolytics Monitor")
        print("=" * 80)
        print("Testing: Unique indexes enforce gracefully (409/400, NOT 500)")
        print()
        
        try:
            self.step_1_admin_login()
            self.step_2_get_instrument_registry()
            self.step_3_create_test_user()
            self.step_4_register_instrument()
            self.step_5_duplicate_instrument_unique_index()
            self.step_6_client_login()
            self.step_7_client_get_instruments()
            self.step_8_client_offline_alerts()
            self.step_9_client_limit_breaches()
            self.step_10_admin_create_limit()
            self.step_11_duplicate_limit_unique_index()
            self.step_12_client_export_csv()
            self.step_13_client_dwlr_daily()
            self.step_14_cleanup()
            self.check_backend_logs()
        except Exception as e:
            print(f"\n❌ UNEXPECTED ERROR: {e}")
            import traceback
            traceback.print_exc()
            self.failed += 1
        
        print("\n" + "=" * 80)
        print(f"📊 RESULTS: {self.passed} passed, {self.failed} failed")
        print("=" * 80)
        
        if self.failed == 0:
            print("✅ ALL TESTS PASSED - MongoDB indexes working correctly!")
        else:
            print(f"❌ {self.failed} TEST(S) FAILED - Review output above")
        
        return self.failed == 0

if __name__ == "__main__":
    runner = IndexTestRunner()
    success = runner.run()
    sys.exit(0 if success else 1)
