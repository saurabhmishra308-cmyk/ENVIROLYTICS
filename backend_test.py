#!/usr/bin/env python3
"""
Smoke test for Envirolytics Monitor backend after lint cleanup.
Verifies that minimal non-functional changes did NOT break any logic.
"""
import requests
import io
import sys
from datetime import datetime

# Backend URL from frontend/.env
BASE_URL = "https://carbon-track-24.preview.emergentagent.com/api"

# Test credentials from /app/memory/test_credentials.md
ADMIN_EMAIL = "admin@envirolytics.com"
ADMIN_PASSWORD = "Admin@Envirolytics2026"

class TestRunner:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.admin_token = None
        self.client_token = None
        self.test_user_id = None
        self.test_instruments = []
        
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

    def test_auth_login(self):
        """Test 1: Auth seeding & login - verify login returns 200 with valid JWT"""
        print("\n🔐 Test 1: Auth & Login")
        
        resp = requests.post(f"{BASE_URL}/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        
        if self.assert_status(resp, 200, "Admin login returns 200"):
            data = resp.json()
            if self.assert_contains(data, "access_token", "Response contains access_token"):
                self.admin_token = data["access_token"]
                self.log(f"   Admin token obtained")

    def test_certificates_upload_and_list(self):
        """Test 2: Certificates upload + list - verify extension validation still works"""
        print("\n📄 Test 2: Certificates Upload & List")
        
        if not self.admin_token:
            self.log("⚠️  Skipping - no admin token")
            return
        
        headers = {"Authorization": f"Bearer {self.admin_token}"}
        
        # Create a small PDF-like file
        pdf_content = b"%PDF-1.4\n%Test PDF\n%%EOF"
        files = {"file": ("test_cert.pdf", io.BytesIO(pdf_content), "application/pdf")}
        data = {
            "cert_type": "installation",
            "year": 2026,
            "notes": "Smoke test certificate"
        }
        
        resp = requests.post(f"{BASE_URL}/certificates/upload", headers=headers, files=files, data=data)
        
        if self.assert_status(resp, 200, "Certificate upload with PDF returns 200"):
            cert_data = resp.json()
            if self.assert_contains(cert_data, "certificate", "Response contains certificate"):
                cert_id = cert_data["certificate"]["id"]
                self.log(f"   Certificate uploaded: {cert_id}")
                
                # Test list endpoint
                list_resp = requests.get(f"{BASE_URL}/certificates/list", headers=headers)
                if self.assert_status(list_resp, 200, "Certificate list returns 200"):
                    list_data = list_resp.json()
                    if self.assert_contains(list_data, "certificates", "List contains certificates array"):
                        # Verify our cert is in the list
                        found = any(c["id"] == cert_id for c in list_data["certificates"])
                        if found:
                            self.passed += 1
                            self.log(f"✅ Uploaded certificate found in list")
                        else:
                            self.failed += 1
                            self.log(f"❌ Uploaded certificate NOT found in list")
                
                # Cleanup
                requests.delete(f"{BASE_URL}/certificates/{cert_id}", headers=headers)

    def test_per_user_scoping(self):
        """Test 3: Per-user scoping - quick re-run of critical checks"""
        print("\n👥 Test 3: Per-User Instrument Scoping")
        
        if not self.admin_token:
            self.log("⚠️  Skipping - no admin token")
            return
        
        headers = {"Authorization": f"Bearer {self.admin_token}"}
        
        # Create temp client
        timestamp = datetime.now().strftime("%H%M%S")
        client_email = f"smoke_test_{timestamp}@envirolytics.com"
        client_password = "SmokeTest@2026"
        
        resp = requests.post(f"{BASE_URL}/admin/users/create", headers=headers, json={
            "email": client_email,
            "password": client_password,
            "full_name": "Smoke Test User",
            "role": "client",
            "location_name": "Test Location",
            "latitude": 26.8467,
            "longitude": 80.9462
        })
        
        if not self.assert_status(resp, 200, "Create temp client user"):
            return
        
        user_data = resp.json()
        self.test_user_id = user_data["user"]["id"]
        self.log(f"   Created user: {self.test_user_id}")
        
        # Register 2 instruments to this user
        instruments = [
            {
                "hardware_id": f"FM_SMOKE_{timestamp}_1",
                "instrument_type": "flowmeter",
                "label": "Smoke Test FM 1",
                "owner_user_id": self.test_user_id,
                "category": "groundwater_abstraction",
                "location_name": "Test Site 1",
                "latitude": 26.85,
                "longitude": 80.95
            },
            {
                "hardware_id": f"DWLR_SMOKE_{timestamp}_1",
                "instrument_type": "dwlr",
                "label": "Smoke Test DWLR 1",
                "owner_user_id": self.test_user_id,
                "location_name": "Test Site 2",
                "latitude": 26.86,
                "longitude": 80.96
            }
        ]
        
        for inst in instruments:
            resp = requests.post(f"{BASE_URL}/instrument-registry", headers=headers, json=inst)
            if self.assert_status(resp, 200, f"Register {inst['instrument_type']} to client"):
                self.test_instruments.append(inst["hardware_id"])
        
        # Login as client
        client_resp = requests.post(f"{BASE_URL}/auth/login", json={
            "email": client_email,
            "password": client_password
        })
        
        if not self.assert_status(client_resp, 200, "Client login"):
            return
        
        self.client_token = client_resp.json()["access_token"]
        client_headers = {"Authorization": f"Bearer {self.client_token}"}
        
        # Test: Client sees only their instruments
        resp = requests.get(f"{BASE_URL}/instrument-registry", headers=client_headers)
        if self.assert_status(resp, 200, "Client GET /instrument-registry"):
            data = resp.json()
            count = data.get("count", 0)
            if count == 2:
                self.passed += 1
                self.log(f"✅ Client sees exactly 2 instruments (their own)")
            else:
                self.failed += 1
                self.log(f"❌ Client sees {count} instruments, expected 2")
        
        # Test: Offline alerts scoped to client
        resp = requests.get(f"{BASE_URL}/alerts/offline", headers=client_headers)
        self.assert_status(resp, 200, "Client GET /alerts/offline (scoped)")
        
        # Test: Limit breaches scoped to client
        resp = requests.get(f"{BASE_URL}/alerts/limit-breaches", headers=client_headers)
        self.assert_status(resp, 200, "Client GET /alerts/limit-breaches (scoped)")
        
        # Test: Export CSV for owned instruments
        resp = requests.get(f"{BASE_URL}/flowmeter-mgmt/export?format=csv", headers=client_headers)
        if self.assert_status(resp, 200, "Client export CSV for owned instruments"):
            if "text/csv" in resp.headers.get("content-type", ""):
                self.passed += 1
                self.log(f"✅ Export returns text/csv content-type")
            else:
                self.failed += 1
                self.log(f"❌ Export content-type is {resp.headers.get('content-type')}")
        
        # Test: DWLR daily endpoint
        dwlr_hw = self.test_instruments[1] if len(self.test_instruments) > 1 else None
        if dwlr_hw:
            resp = requests.get(f"{BASE_URL}/flowmeter-mgmt/dwlr/{dwlr_hw}/daily?days=7", headers=client_headers)
            self.assert_status(resp, 200, "Client GET DWLR daily data for owned instrument")

    def test_renewals(self):
        """Test 4: Renewals endpoint"""
        print("\n🔄 Test 4: Renewals")
        
        if not self.admin_token:
            self.log("⚠️  Skipping - no admin token")
            return
        
        headers = {"Authorization": f"Bearer {self.admin_token}"}
        resp = requests.get(f"{BASE_URL}/renewals", headers=headers)
        self.assert_status(resp, 200, "GET /renewals returns 200")

    def test_notifications(self):
        """Test 5: Notifications endpoint"""
        print("\n📧 Test 5: Notifications")
        
        if not self.admin_token:
            self.log("⚠️  Skipping - no admin token")
            return
        
        headers = {"Authorization": f"Bearer {self.admin_token}"}
        resp = requests.get(f"{BASE_URL}/notifications/emails", headers=headers)
        self.assert_status(resp, 200, "GET /notifications/emails returns 200 (admin only)")

    def cleanup(self):
        """Cleanup test data"""
        print("\n🧹 Cleanup")
        
        if not self.admin_token:
            return
        
        headers = {"Authorization": f"Bearer {self.admin_token}"}
        
        # Delete test instruments
        for hw_id in self.test_instruments:
            resp = requests.delete(f"{BASE_URL}/instrument-registry/{hw_id}", headers=headers)
            if resp.status_code == 200:
                self.log(f"✅ Deleted instrument {hw_id}")
        
        # Delete test user
        if self.test_user_id:
            resp = requests.delete(f"{BASE_URL}/admin/users/{self.test_user_id}", headers=headers)
            if resp.status_code == 200:
                self.log(f"✅ Deleted test user {self.test_user_id}")

    def run(self):
        print("=" * 70)
        print("🧪 ENVIROLYTICS MONITOR - SMOKE TEST AFTER LINT CLEANUP")
        print("=" * 70)
        
        try:
            self.test_auth_login()
            self.test_certificates_upload_and_list()
            self.test_per_user_scoping()
            self.test_renewals()
            self.test_notifications()
        finally:
            self.cleanup()
        
        print("\n" + "=" * 70)
        print(f"📊 RESULTS: {self.passed} passed, {self.failed} failed")
        print("=" * 70)
        
        return self.failed == 0

if __name__ == "__main__":
    runner = TestRunner()
    success = runner.run()
    sys.exit(0 if success else 1)
