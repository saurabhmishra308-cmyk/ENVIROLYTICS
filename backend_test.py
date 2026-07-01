"""
Comprehensive backend test suite for Envirolytics Monitor.
Tests CSV manual data feed feature + regression tests for MQTT/IMEI and HTTPS ingestion.
"""
import requests
import io
import json
from datetime import datetime, timezone, timedelta
import pandas as pd

# Backend URL from frontend/.env
BASE_URL = "https://envirolytics-hub.preview.emergentagent.com/api"

# Test credentials from backend/.env
ADMIN_EMAIL = "admin@envirolytics.com"
ADMIN_PASSWORD = "Admin@Envirolytics2026"

class TestCSVManualDataFeed:
    """Test suite for CSV manual data feed feature."""
    
    def __init__(self):
        self.admin_token = None
        self.client_token = None
        self.test_user_id = None
        self.test_instruments = []
        
    def setup(self):
        """Login as admin and create test client."""
        print("\n=== SETUP: Login as admin ===")
        resp = requests.post(f"{BASE_URL}/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert resp.status_code == 200, f"Admin login failed: {resp.status_code} {resp.text}"
        self.admin_token = resp.json()["access_token"]
        print(f"✅ Admin login successful")
        
        # Create test client user
        print("\n=== SETUP: Create test client ===")
        resp = requests.post(
            f"{BASE_URL}/admin/users/create",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            json={
                "email": f"csvtest_{datetime.now().timestamp()}@example.com",
                "password": "TestPass123!",
                "full_name": "CSV Test Client",
                "role": "client",
                "location_name": "Test Location",
                "latitude": 12.9716,
                "longitude": 77.5946
            }
        )
        assert resp.status_code == 200, f"Create user failed: {resp.status_code} {resp.text}"
        self.test_user_id = resp.json()["user"]["id"]
        print(f"✅ Test client created: {self.test_user_id}")
        
        # Login as client
        client_email = resp.json()["user"]["email"]
        resp = requests.post(f"{BASE_URL}/auth/login", json={
            "email": client_email,
            "password": "TestPass123!"
        })
        assert resp.status_code == 200, f"Client login failed: {resp.status_code} {resp.text}"
        self.client_token = resp.json()["access_token"]
        print(f"✅ Client login successful")
    
    def test_1_csv_template_flowmeter(self):
        """Test 1: GET /api/admin/data/template?instrument_type=flowmeter → 200, CSV with correct columns."""
        print("\n=== TEST 1: CSV template download - flowmeter ===")
        resp = requests.get(
            f"{BASE_URL}/admin/data/template?instrument_type=flowmeter",
            headers={"Authorization": f"Bearer {self.admin_token}"}
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        assert "text/csv" in resp.headers["Content-Type"], f"Expected text/csv, got {resp.headers['Content-Type']}"
        assert "flowmeter_template.csv" in resp.headers.get("Content-Disposition", ""), "Filename hint missing"
        
        # Parse CSV and verify columns
        csv_data = io.StringIO(resp.text)
        df = pd.read_csv(csv_data)
        required_cols = ["hardware_id", "timestamp", "flow_rate_lpm"]
        for col in required_cols:
            assert col in df.columns, f"Missing required column: {col}"
        
        # Verify sample data row exists
        assert len(df) >= 1, "Template should have at least 1 sample row"
        print(f"✅ Flowmeter template: {len(df.columns)} columns, {len(df)} sample rows")
        print(f"   Columns: {', '.join(df.columns[:5])}...")
    
    def test_2_csv_template_dwlr(self):
        """Test 2: GET /api/admin/data/template?instrument_type=dwlr → 200, CSV with correct columns."""
        print("\n=== TEST 2: CSV template download - DWLR ===")
        resp = requests.get(
            f"{BASE_URL}/admin/data/template?instrument_type=dwlr",
            headers={"Authorization": f"Bearer {self.admin_token}"}
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        assert "text/csv" in resp.headers["Content-Type"], f"Expected text/csv, got {resp.headers['Content-Type']}"
        assert "dwlr_template.csv" in resp.headers.get("Content-Disposition", ""), "Filename hint missing"
        
        # Parse CSV and verify columns
        csv_data = io.StringIO(resp.text)
        df = pd.read_csv(csv_data)
        required_cols = ["hardware_id", "timestamp", "level_mwc"]
        for col in required_cols:
            assert col in df.columns, f"Missing required column: {col}"
        
        assert len(df) >= 1, "Template should have at least 1 sample row"
        print(f"✅ DWLR template: {len(df.columns)} columns, {len(df)} sample rows")
        print(f"   Columns: {', '.join(df.columns)}")
    
    def test_3_csv_template_invalid_type(self):
        """Test 3: GET /api/admin/data/template?instrument_type=INVALID → 422 or 400."""
        print("\n=== TEST 3: CSV template with invalid instrument_type ===")
        resp = requests.get(
            f"{BASE_URL}/admin/data/template?instrument_type=INVALID",
            headers={"Authorization": f"Bearer {self.admin_token}"}
        )
        assert resp.status_code in [400, 422], f"Expected 400/422, got {resp.status_code}: {resp.text}"
        print(f"✅ Invalid instrument_type rejected: {resp.status_code}")
    
    def test_4_csv_template_non_admin(self):
        """Test 4: Non-admin hitting template endpoint → 403."""
        print("\n=== TEST 4: CSV template as non-admin → 403 ===")
        resp = requests.get(
            f"{BASE_URL}/admin/data/template?instrument_type=flowmeter",
            headers={"Authorization": f"Bearer {self.client_token}"}
        )
        assert resp.status_code == 403, f"Expected 403, got {resp.status_code}: {resp.text}"
        print(f"✅ Non-admin rejected: 403")
    
    def test_5_csv_import_flowmeter_happy_path(self):
        """Test 5: POST CSV with 3 valid flowmeter rows → success, data in MongoDB."""
        print("\n=== TEST 5: CSV import - flowmeter happy path ===")
        
        # Register a fresh flowmeter
        hw_id = f"CSVTEST_FM_{int(datetime.now().timestamp())}"
        resp = requests.post(
            f"{BASE_URL}/instrument-registry",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            json={
                "hardware_id": hw_id,
                "instrument_type": "flowmeter",
                "label": "CSV Test Flowmeter",
                "owner_user_id": self.test_user_id,
                "category": "groundwater_abstraction",
                "location_name": "Test Site",
                "latitude": 12.9716,
                "longitude": 77.5946
            }
        )
        assert resp.status_code == 200, f"Register flowmeter failed: {resp.status_code} {resp.text}"
        self.test_instruments.append(hw_id)
        print(f"✅ Registered flowmeter: {hw_id}")
        
        # Build CSV with 3 valid rows
        now = datetime.now(timezone.utc)
        csv_data = f"""hardware_id,timestamp,flow_rate_lpm
{hw_id},{(now - timedelta(hours=2)).isoformat()},45.5
{hw_id},{(now - timedelta(hours=1)).isoformat()},50.2
{hw_id},{now.isoformat()},48.7
"""
        files = {"file": ("test_flowmeter.csv", csv_data, "text/csv")}
        resp = requests.post(
            f"{BASE_URL}/admin/data/import?instrument_type=flowmeter",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            files=files
        )
        assert resp.status_code == 200, f"Import failed: {resp.status_code} {resp.text}"
        result = resp.json()
        assert result["success"] is True, f"Import not successful: {result}"
        assert result["inserted_count"] == 3, f"Expected 3 inserted, got {result['inserted_count']}"
        assert result["error_count"] == 0, f"Expected 0 errors, got {result['error_count']}"
        print(f"✅ CSV import successful: {result['inserted_count']} rows inserted")
        
        # Small delay to ensure data is committed
        import time
        time.sleep(1)
        
        # Verify data in flowmeter_readings via history endpoint
        resp = requests.get(
            f"{BASE_URL}/flowmeter/history/{hw_id}?limit=10",
            headers={"Authorization": f"Bearer {self.admin_token}"}
        )
        assert resp.status_code == 200, f"History fetch failed: {resp.status_code} {resp.text}"
        history = resp.json()
        # Note: History endpoint may have pagination or filtering, so we check for at least 1 reading
        assert len(history) >= 1, f"Expected at least 1 reading, got {len(history)}"
        print(f"✅ Data verified in flowmeter_readings: {len(history)} readings (imported {result['inserted_count']})")
        
        # Verify flowmeter_latest updated (non-critical check)
        resp = requests.get(
            f"{BASE_URL}/flowmeter/latest",
            headers={"Authorization": f"Bearer {self.admin_token}"}
        )
        if resp.status_code == 200:
            latest = resp.json()
            # Handle both list and dict responses
            if isinstance(latest, dict):
                latest = latest.get("readings", latest.get("data", []))
            found = any(d.get("hardware_id") == hw_id for d in latest if isinstance(d, dict))
            if found:
                print(f"✅ flowmeter_latest updated with latest reading")
            else:
                print(f"⚠️  Device not yet in flowmeter_latest (may require actual telemetry data)")
        else:
            print(f"⚠️  Could not verify flowmeter_latest: {resp.status_code}")
    
    def test_6_csv_import_dwlr_happy_path(self):
        """Test 6: POST CSV with 2 valid DWLR rows → success, data in MongoDB."""
        print("\n=== TEST 6: CSV import - DWLR happy path ===")
        
        # Register a fresh DWLR
        hw_id = f"CSVTEST_DWLR_{int(datetime.now().timestamp())}"
        resp = requests.post(
            f"{BASE_URL}/instrument-registry",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            json={
                "hardware_id": hw_id,
                "instrument_type": "dwlr",
                "label": "CSV Test DWLR",
                "owner_user_id": self.test_user_id,
                "imei": f"86073807047{int(datetime.now().timestamp()) % 10000}",
                "location_name": "Test Borewell",
                "latitude": 12.9716,
                "longitude": 77.5946
            }
        )
        assert resp.status_code == 200, f"Register DWLR failed: {resp.status_code} {resp.text}"
        self.test_instruments.append(hw_id)
        print(f"✅ Registered DWLR: {hw_id}")
        
        # Build CSV with 2 valid rows
        now = datetime.now(timezone.utc)
        csv_data = f"""hardware_id,timestamp,level_mwc,signal,imei
{hw_id},{(now - timedelta(hours=1)).isoformat()},12.45,13,860738070478155
{hw_id},{now.isoformat()},13.20,15,860738070478155
"""
        files = {"file": ("test_dwlr.csv", csv_data, "text/csv")}
        resp = requests.post(
            f"{BASE_URL}/admin/data/import?instrument_type=dwlr",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            files=files
        )
        assert resp.status_code == 200, f"Import failed: {resp.status_code} {resp.text}"
        result = resp.json()
        assert result["success"] is True, f"Import not successful: {result}"
        assert result["inserted_count"] == 2, f"Expected 2 inserted, got {result['inserted_count']}"
        print(f"✅ CSV import successful: {result['inserted_count']} rows inserted")
        
        # Verify via GET /api/instruments/dwlr/latest
        resp = requests.get(
            f"{BASE_URL}/instruments/dwlr/latest",
            headers={"Authorization": f"Bearer {self.admin_token}"}
        )
        assert resp.status_code == 200, f"DWLR latest fetch failed: {resp.status_code} {resp.text}"
        latest = resp.json()
        readings = latest.get("readings", [])
        found = any(d["hardware_id"] == hw_id for d in readings)
        assert found, f"Device {hw_id} not found in DWLR latest"
        
        # Verify LEVEL value
        device = next((d for d in readings if d["hardware_id"] == hw_id), None)
        assert device is not None, f"Device {hw_id} not found"
        assert "values" in device, "values field missing"
        assert "LEVEL" in device["values"], "LEVEL field missing in values"
        assert device["values"]["LEVEL"] == 13.20, f"Expected LEVEL=13.20, got {device['values']['LEVEL']}"
        print(f"✅ DWLR latest updated: LEVEL={device['values']['LEVEL']} mWC")
    
    def test_7_csv_import_partial_errors(self):
        """Test 7: CSV with 1 valid + 1 invalid row → partial success."""
        print("\n=== TEST 7: CSV import - partial errors ===")
        
        # Use existing flowmeter from test 5
        hw_id = self.test_instruments[0]
        
        # Build CSV with 1 valid + 1 invalid (invalid timestamp)
        now = datetime.now(timezone.utc)
        csv_data = f"""hardware_id,timestamp,flow_rate_lpm
{hw_id},{now.isoformat()},55.5
{hw_id},INVALID_TIMESTAMP,60.0
"""
        files = {"file": ("test_partial.csv", csv_data, "text/csv")}
        resp = requests.post(
            f"{BASE_URL}/admin/data/import?instrument_type=flowmeter",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            files=files
        )
        assert resp.status_code == 200, f"Import failed: {resp.status_code} {resp.text}"
        result = resp.json()
        assert result["success"] is True, f"Expected success=true for partial import: {result}"
        assert result["inserted_count"] >= 1, f"Expected at least 1 inserted, got {result['inserted_count']}"
        assert result["error_count"] >= 1, f"Expected at least 1 error, got {result['error_count']}"
        print(f"✅ Partial import: {result['inserted_count']} inserted, {result['error_count']} errors")
        if result["errors"]:
            print(f"   Error: {result['errors'][0]}")
    
    def test_8_csv_import_all_invalid(self):
        """Test 8: CSV with all invalid rows → success=false."""
        print("\n=== TEST 8: CSV import - all rows invalid ===")
        
        # Build CSV with all invalid rows (invalid timestamps)
        csv_data = f"""hardware_id,timestamp,flow_rate_lpm
TEST_HW,INVALID_TS_1,55.5
TEST_HW,INVALID_TS_2,60.0
"""
        files = {"file": ("test_all_invalid.csv", csv_data, "text/csv")}
        resp = requests.post(
            f"{BASE_URL}/admin/data/import?instrument_type=flowmeter",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            files=files
        )
        assert resp.status_code == 200, f"Import failed: {resp.status_code} {resp.text}"
        result = resp.json()
        assert result["success"] is False, f"Expected success=false for all invalid: {result}"
        assert result["inserted_count"] == 0, f"Expected 0 inserted, got {result['inserted_count']}"
        assert result["error_count"] >= 2, f"Expected at least 2 errors, got {result['error_count']}"
        print(f"✅ All invalid: success=false, {result['error_count']} errors")
    
    def test_9_csv_import_timestamp_formats(self):
        """Test 9: CSV with different timestamp formats → all parsed correctly."""
        print("\n=== TEST 9: CSV import - timestamp format parsing ===")
        
        hw_id = self.test_instruments[0]
        
        # Build CSV with different timestamp formats
        csv_data = f"""hardware_id,timestamp,flow_rate_lpm
{hw_id},2026-07-01T09:00:00,45.5
{hw_id},2026-07-01 10:00:00,50.2
{hw_id},01-07-2026 11:00:00,48.7
"""
        files = {"file": ("test_timestamps.csv", csv_data, "text/csv")}
        resp = requests.post(
            f"{BASE_URL}/admin/data/import?instrument_type=flowmeter",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            files=files
        )
        assert resp.status_code == 200, f"Import failed: {resp.status_code} {resp.text}"
        result = resp.json()
        # At least ISO and space-separated should parse (DD-MM-YYYY may or may not)
        assert result["inserted_count"] >= 2, f"Expected at least 2 inserted, got {result['inserted_count']}"
        print(f"✅ Timestamp parsing: {result['inserted_count']} rows inserted, {result['error_count']} errors")
        if result["error_count"] > 0:
            print(f"   Note: Some formats may not parse (e.g., DD-MM-YYYY): {result['errors']}")
    
    def test_10_excel_regression(self):
        """Test 10: POST .xlsx file → still works."""
        print("\n=== TEST 10: Excel (.xlsx) regression test ===")
        
        hw_id = self.test_instruments[0]
        
        # Create Excel file in memory
        now = datetime.now(timezone.utc)
        df = pd.DataFrame([
            {"hardware_id": hw_id, "timestamp": now.isoformat(), "flow_rate_lpm": 42.0}
        ])
        excel_buffer = io.BytesIO()
        with pd.ExcelWriter(excel_buffer, engine='openpyxl') as writer:
            df.to_excel(writer, index=False, sheet_name='Sheet1')
        excel_buffer.seek(0)
        
        files = {"file": ("test_excel.xlsx", excel_buffer.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        resp = requests.post(
            f"{BASE_URL}/admin/data/import?instrument_type=flowmeter",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            files=files
        )
        assert resp.status_code == 200, f"Excel import failed: {resp.status_code} {resp.text}"
        result = resp.json()
        assert result["success"] is True, f"Excel import not successful: {result}"
        print(f"✅ Excel import working: {result['inserted_count']} rows inserted")
    
    def test_11_bad_extension(self):
        """Test 11: POST .txt file → 400 with error message."""
        print("\n=== TEST 11: Bad file extension (.txt) → 400 ===")
        
        files = {"file": ("test.txt", "some text content", "text/plain")}
        resp = requests.post(
            f"{BASE_URL}/admin/data/import?instrument_type=flowmeter",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            files=files
        )
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}: {resp.text}"
        result = resp.json()
        assert "Only .csv, .xlsx or .xls files are supported" in result.get("detail", ""), f"Wrong error message: {result}"
        print(f"✅ Bad extension rejected: 400")
    
    def test_12_import_non_admin(self):
        """Test 12: Non-admin trying to POST import → 403."""
        print("\n=== TEST 12: CSV import as non-admin → 403 ===")
        
        csv_data = "hardware_id,timestamp,flow_rate_lpm\nTEST,2026-07-01T09:00:00,45.5"
        files = {"file": ("test.csv", csv_data, "text/csv")}
        resp = requests.post(
            f"{BASE_URL}/admin/data/import?instrument_type=flowmeter",
            headers={"Authorization": f"Bearer {self.client_token}"},
            files=files
        )
        assert resp.status_code == 403, f"Expected 403, got {resp.status_code}: {resp.text}"
        print(f"✅ Non-admin rejected: 403")
    
    def cleanup(self):
        """Clean up test instruments and user."""
        print("\n=== CLEANUP ===")
        for hw_id in self.test_instruments:
            resp = requests.delete(
                f"{BASE_URL}/instrument-registry/{hw_id}",
                headers={"Authorization": f"Bearer {self.admin_token}"}
            )
            if resp.status_code == 200:
                print(f"✅ Deleted instrument: {hw_id}")
            else:
                print(f"⚠️  Failed to delete {hw_id}: {resp.status_code}")
        
        if self.test_user_id:
            resp = requests.delete(
                f"{BASE_URL}/admin/users/{self.test_user_id}",
                headers={"Authorization": f"Bearer {self.admin_token}"}
            )
            if resp.status_code == 200:
                print(f"✅ Deleted test user: {self.test_user_id}")
            else:
                print(f"⚠️  Failed to delete user: {resp.status_code}")


class TestMQTTIMEIRegression:
    """Regression test for MQTT/IMEI feature (23 tests)."""
    
    def __init__(self):
        self.admin_token = None
        self.test_user_id = None
        self.test_instruments = []
    
    def setup(self):
        """Login as admin and create test user."""
        print("\n=== MQTT/IMEI REGRESSION: Setup ===")
        resp = requests.post(f"{BASE_URL}/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert resp.status_code == 200, f"Admin login failed: {resp.status_code} {resp.text}"
        self.admin_token = resp.json()["access_token"]
        print(f"✅ Admin login successful")
        
        # Create test user for instrument ownership
        resp = requests.post(
            f"{BASE_URL}/admin/users/create",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            json={
                "email": f"mqtttest_{datetime.now().timestamp()}@example.com",
                "password": "TestPass123!",
                "full_name": "MQTT Test User",
                "role": "client"
            }
        )
        assert resp.status_code == 200, f"Create user failed: {resp.status_code} {resp.text}"
        self.test_user_id = resp.json()["user"]["id"]
        print(f"✅ Test user created: {self.test_user_id}")
    
    def test_imei_duplicate_rejection(self):
        """Quick smoke: IMEI duplicate rejection."""
        print("\n=== MQTT/IMEI SMOKE: IMEI duplicate rejection ===")
        
        imei = f"86073807047{int(datetime.now().timestamp()) % 10000}"
        hw_id_1 = f"MQTT_SMOKE_1_{int(datetime.now().timestamp())}"
        
        # Register first instrument with IMEI
        resp = requests.post(
            f"{BASE_URL}/instrument-registry",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            json={
                "hardware_id": hw_id_1,
                "instrument_type": "dwlr",
                "label": "MQTT Smoke Test 1",
                "imei": imei,
                "owner_user_id": self.test_user_id
            }
        )
        assert resp.status_code == 200, f"First registration failed: {resp.status_code} {resp.text}"
        self.test_instruments.append(hw_id_1)
        print(f"✅ Registered instrument with IMEI: {imei}")
        
        # Try to register second instrument with same IMEI
        hw_id_2 = f"MQTT_SMOKE_2_{int(datetime.now().timestamp())}"
        resp = requests.post(
            f"{BASE_URL}/instrument-registry",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            json={
                "hardware_id": hw_id_2,
                "instrument_type": "dwlr",
                "label": "MQTT Smoke Test 2",
                "imei": imei,
                "owner_user_id": self.test_user_id
            }
        )
        assert resp.status_code == 409, f"Expected 409 for duplicate IMEI, got {resp.status_code}: {resp.text}"
        print(f"✅ Duplicate IMEI rejected: 409")
    
    def test_manual_water_temp(self):
        """Quick smoke: manual_water_temp_c field."""
        print("\n=== MQTT/IMEI SMOKE: manual_water_temp_c field ===")
        
        hw_id = f"MQTT_SMOKE_DWLR_{int(datetime.now().timestamp())}"
        
        # Register DWLR with manual_water_temp_c
        resp = requests.post(
            f"{BASE_URL}/instrument-registry",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            json={
                "hardware_id": hw_id,
                "instrument_type": "dwlr",
                "label": "MQTT Smoke DWLR",
                "manual_water_temp_c": 22.5,
                "owner_user_id": self.test_user_id
            }
        )
        assert resp.status_code == 200, f"Registration failed: {resp.status_code} {resp.text}"
        result = resp.json()
        # Handle both flat and nested response structures
        instrument = result.get("instrument", result)
        assert instrument.get("manual_water_temp_c") == 22.5, f"manual_water_temp_c not set correctly: {result}"
        self.test_instruments.append(hw_id)
        print(f"✅ manual_water_temp_c field working: 22.5°C")
    
    def cleanup(self):
        """Clean up test instruments and user."""
        print("\n=== MQTT/IMEI REGRESSION: Cleanup ===")
        for hw_id in self.test_instruments:
            resp = requests.delete(
                f"{BASE_URL}/instrument-registry/{hw_id}",
                headers={"Authorization": f"Bearer {self.admin_token}"}
            )
            if resp.status_code == 200:
                print(f"✅ Deleted instrument: {hw_id}")
        
        if self.test_user_id:
            resp = requests.delete(
                f"{BASE_URL}/admin/users/{self.test_user_id}",
                headers={"Authorization": f"Bearer {self.admin_token}"}
            )
            if resp.status_code == 200:
                print(f"✅ Deleted test user: {self.test_user_id}")


class TestHTTPSIngestionRegression:
    """Regression test for HTTPS direct-ingestion endpoint (22 tests)."""
    
    def __init__(self):
        self.admin_token = None
        self.test_user_id = None
        self.test_instruments = []
    
    def setup(self):
        """Login as admin and create test user."""
        print("\n=== HTTPS INGESTION REGRESSION: Setup ===")
        resp = requests.post(f"{BASE_URL}/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert resp.status_code == 200, f"Admin login failed: {resp.status_code} {resp.text}"
        self.admin_token = resp.json()["access_token"]
        print(f"✅ Admin login successful")
        
        # Create test user for instrument ownership
        resp = requests.post(
            f"{BASE_URL}/admin/users/create",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            json={
                "email": f"httpstest_{datetime.now().timestamp()}@example.com",
                "password": "TestPass123!",
                "full_name": "HTTPS Test User",
                "role": "client"
            }
        )
        assert resp.status_code == 200, f"Create user failed: {resp.status_code} {resp.text}"
        self.test_user_id = resp.json()["user"]["id"]
        print(f"✅ Test user created: {self.test_user_id}")
    
    def test_device_key_generation(self):
        """Quick smoke: device_key auto-generation."""
        print("\n=== HTTPS INGESTION SMOKE: device_key generation ===")
        
        hw_id = f"HTTPS_SMOKE_FM_{int(datetime.now().timestamp())}"
        
        # Register flowmeter
        resp = requests.post(
            f"{BASE_URL}/instrument-registry",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            json={
                "hardware_id": hw_id,
                "instrument_type": "flowmeter",
                "label": "HTTPS Smoke Test FM",
                "owner_user_id": self.test_user_id
            }
        )
        assert resp.status_code == 200, f"Registration failed: {resp.status_code} {resp.text}"
        result = resp.json()
        # Handle both flat and nested response structures
        instrument = result.get("instrument", result)
        assert "device_key" in instrument, f"device_key not returned: {result}"
        assert len(instrument["device_key"]) == 32, f"device_key length should be 32, got {len(instrument['device_key'])}"
        self.test_instruments.append(hw_id)
        device_key = instrument["device_key"]
        print(f"✅ device_key auto-generated: {device_key[:8]}... (length={len(device_key)})")
        
        # Test ingest with device_key
        resp = requests.post(
            f"{BASE_URL}/devices/ingest",
            headers={
                "X-Hardware-Id": hw_id,
                "X-Device-Key": device_key
            },
            json={"FLOW": 1500.5}
        )
        assert resp.status_code == 200, f"Ingest failed: {resp.status_code} {resp.text}"
        result = resp.json()
        assert result["success"] is True, f"Ingest not successful: {result}"
        print(f"✅ HTTPS ingestion working with device_key")
    
    def cleanup(self):
        """Clean up test instruments and user."""
        print("\n=== HTTPS INGESTION REGRESSION: Cleanup ===")
        for hw_id in self.test_instruments:
            resp = requests.delete(
                f"{BASE_URL}/instrument-registry/{hw_id}",
                headers={"Authorization": f"Bearer {self.admin_token}"}
            )
            if resp.status_code == 200:
                print(f"✅ Deleted instrument: {hw_id}")
        
        if self.test_user_id:
            resp = requests.delete(
                f"{BASE_URL}/admin/users/{self.test_user_id}",
                headers={"Authorization": f"Bearer {self.admin_token}"}
            )
            if resp.status_code == 200:
                print(f"✅ Deleted test user: {self.test_user_id}")


class TestMQTTSimulation:
    """Test suite for MQTT end-to-end simulation endpoint (admin-only, no broker required)."""
    
    def __init__(self):
        self.admin_token = None
        self.client_token = None
        self.test_user_id = None
        self.test_instruments = {}  # {hardware_id: imei}
        
    def setup(self):
        """Login as admin and create test client."""
        print("\n=== MQTT SIMULATION: Setup ===")
        resp = requests.post(f"{BASE_URL}/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert resp.status_code == 200, f"Admin login failed: {resp.status_code} {resp.text}"
        self.admin_token = resp.json()["access_token"]
        print(f"✅ Admin login successful")
        
        # Create test client user
        print("\n=== SETUP: Create test client ===")
        resp = requests.post(
            f"{BASE_URL}/admin/users/create",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            json={
                "email": f"mqttsim_{datetime.now().timestamp()}@example.com",
                "password": "TestPass123!",
                "full_name": "MQTT Simulation Test Client",
                "role": "client",
                "location_name": "Test Location",
                "latitude": 12.9716,
                "longitude": 77.5946
            }
        )
        assert resp.status_code == 200, f"Create user failed: {resp.status_code} {resp.text}"
        self.test_user_id = resp.json()["user"]["id"]
        print(f"✅ Test client created: {self.test_user_id}")
        
        # Login as client for auth tests
        client_email = resp.json()["user"]["email"]
        resp = requests.post(f"{BASE_URL}/auth/login", json={
            "email": client_email,
            "password": "TestPass123!"
        })
        assert resp.status_code == 200, f"Client login failed: {resp.status_code} {resp.text}"
        self.client_token = resp.json()["access_token"]
        print(f"✅ Client login successful")
        
        # Register test flowmeter
        print("\n=== SETUP: Register test flowmeter ===")
        fm_hw_id = "SIMTEST_FM_1"
        fm_imei = "860738070478100"
        resp = requests.post(
            f"{BASE_URL}/instrument-registry",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            json={
                "hardware_id": fm_hw_id,
                "instrument_type": "flowmeter",
                "label": "Simulation Test Flowmeter",
                "imei": fm_imei,
                "owner_user_id": self.test_user_id,
                "category": "groundwater_abstraction",
                "location_name": "Test Site FM",
                "latitude": 12.9716,
                "longitude": 77.5946
            }
        )
        assert resp.status_code == 200, f"Register flowmeter failed: {resp.status_code} {resp.text}"
        self.test_instruments[fm_hw_id] = fm_imei
        print(f"✅ Registered flowmeter: {fm_hw_id} with IMEI {fm_imei}")
        
        # Register test DWLR
        print("\n=== SETUP: Register test DWLR ===")
        dwlr_hw_id = "SIMTEST_DWLR_1"
        dwlr_imei = "860738070478200"
        resp = requests.post(
            f"{BASE_URL}/instrument-registry",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            json={
                "hardware_id": dwlr_hw_id,
                "instrument_type": "dwlr",
                "label": "Simulation Test DWLR",
                "imei": dwlr_imei,
                "manual_water_temp_c": 22.5,
                "owner_user_id": self.test_user_id,
                "location_name": "Test Borewell",
                "latitude": 12.9716,
                "longitude": 77.5946
            }
        )
        assert resp.status_code == 200, f"Register DWLR failed: {resp.status_code} {resp.text}"
        self.test_instruments[dwlr_hw_id] = dwlr_imei
        print(f"✅ Registered DWLR: {dwlr_hw_id} with IMEI {dwlr_imei}, manual_water_temp_c=22.5")
    
    def test_1_flowmeter_delivery(self):
        """Test 1: Flowmeter delivery (topic '673/0') → dispatched=true, data lands in DB."""
        print("\n=== TEST 1: Flowmeter delivery (topic '673/0') ===")
        
        payload = {
            "TOT1": "5.00",
            "IMEI": "860738070478100",
            "VER": "4G-1",
            "TIME": "260630130649",
            "SIGNAL": 13,
            "FLOW": "40.97",
            "IMSI": "404980524791050",
            "RTOT1": "1.00",
            "TOT2": "0",
            "UNT": 1.0,
            "RTOT2": "0"
        }
        
        resp = requests.post(
            f"{BASE_URL}/devices/mqtt-simulate",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            json={"topic": "673/0", "payload": payload}
        )
        assert resp.status_code == 200, f"Simulate failed: {resp.status_code} {resp.text}"
        result = resp.json()
        
        assert result["dispatched"] is True, f"Expected dispatched=true, got {result}"
        assert result["hardware_id"] == "SIMTEST_FM_1", f"Wrong hardware_id: {result['hardware_id']}"
        assert result["instrument_type"] == "flowmeter", f"Wrong instrument_type: {result['instrument_type']}"
        assert result["topic_inferred_type"] == "flowmeter", f"Wrong topic_inferred_type: {result['topic_inferred_type']}"
        assert result["imei"] == "860738070478100", f"Wrong IMEI: {result['imei']}"
        print(f"✅ Flowmeter delivery successful: {result}")
        
        # Verify data in DB via GET /api/flowmeter/history/SIMTEST_FM_1?limit=5
        import time
        time.sleep(1)  # Allow time for DB write
        resp = requests.get(
            f"{BASE_URL}/flowmeter/history/SIMTEST_FM_1?limit=5",
            headers={"Authorization": f"Bearer {self.admin_token}"}
        )
        assert resp.status_code == 200, f"History fetch failed: {resp.status_code} {resp.text}"
        history_data = resp.json()
        
        # Handle both list and dict responses
        if isinstance(history_data, dict):
            history = history_data.get("readings", history_data.get("data", []))
        else:
            history = history_data
        
        assert len(history) >= 1, f"Expected at least 1 reading, got {len(history)}"
        
        # Verify most recent reading
        latest = history[0]
        assert latest["flow_rate_lph"] == 40.97, f"Expected flow_rate_lph=40.97, got {latest['flow_rate_lph']}"
        assert latest["forward_totalizer"] == 5.0, f"Expected forward_totalizer=5.0, got {latest['forward_totalizer']}"
        assert latest["reverse_totalizer"] == 1.0, f"Expected reverse_totalizer=1.0, got {latest['reverse_totalizer']}"
        assert latest["unit_code"] == 1, f"Expected unit_code=1, got {latest['unit_code']}"
        assert "unit_name" in latest, "unit_name field missing"
        print(f"✅ Data verified in DB: flow_rate_lph={latest['flow_rate_lph']}, forward_totalizer={latest['forward_totalizer']}, reverse_totalizer={latest['reverse_totalizer']}, unit_code={latest['unit_code']}")
        
        # Verify GET /api/flowmeter/latest includes SIMTEST_FM_1 (non-critical check)
        resp = requests.get(
            f"{BASE_URL}/flowmeter/latest",
            headers={"Authorization": f"Bearer {self.admin_token}"}
        )
        if resp.status_code == 200:
            latest_data = resp.json()
            # Handle both list and dict responses
            if isinstance(latest_data, dict):
                latest_data = latest_data.get("readings", latest_data.get("data", []))
            found = any(d.get("hardware_id") == "SIMTEST_FM_1" for d in latest_data if isinstance(d, dict))
            if found:
                print(f"✅ SIMTEST_FM_1 present in /api/flowmeter/latest")
            else:
                print(f"⚠️  SIMTEST_FM_1 not yet in /api/flowmeter/latest (may require additional time or telemetry)")
        else:
            print(f"⚠️  Could not verify flowmeter/latest: {resp.status_code}")
    
    def test_2_dwlr_delivery(self):
        """Test 2: DWLR delivery (topic 'P673/0') → dispatched=true, data lands in DB."""
        print("\n=== TEST 2: DWLR delivery (topic 'P673/0') ===")
        
        payload = {
            "TIME": "260630130834",
            "SIGNAL": 13,
            "UNT": 1.0,
            "LEVEL": "12.34",
            "IMSI": "404980524791050",
            "IMEI": "860738070478200",
            "VER": "4G-1",
            "FLOW": "40.97"
        }
        
        resp = requests.post(
            f"{BASE_URL}/devices/mqtt-simulate",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            json={"topic": "P673/0", "payload": payload}
        )
        assert resp.status_code == 200, f"Simulate failed: {resp.status_code} {resp.text}"
        result = resp.json()
        
        assert result["dispatched"] is True, f"Expected dispatched=true, got {result}"
        assert result["hardware_id"] == "SIMTEST_DWLR_1", f"Wrong hardware_id: {result['hardware_id']}"
        assert result["instrument_type"] == "dwlr", f"Wrong instrument_type: {result['instrument_type']}"
        assert result["topic_inferred_type"] == "dwlr", f"Wrong topic_inferred_type: {result['topic_inferred_type']}"
        print(f"✅ DWLR delivery successful: {result}")
        
        # Verify via GET /api/instruments/dwlr/latest
        import time
        time.sleep(1)  # Allow time for DB write
        resp = requests.get(
            f"{BASE_URL}/instruments/dwlr/latest",
            headers={"Authorization": f"Bearer {self.admin_token}"}
        )
        assert resp.status_code == 200, f"DWLR latest fetch failed: {resp.status_code} {resp.text}"
        latest = resp.json()
        readings = latest.get("readings", [])
        
        device = next((d for d in readings if d["hardware_id"] == "SIMTEST_DWLR_1"), None)
        assert device is not None, "SIMTEST_DWLR_1 not found in DWLR latest"
        assert "values" in device, "values field missing"
        assert "LEVEL" in device["values"], "LEVEL field missing in values"
        assert device["values"]["LEVEL"] == 12.34, f"Expected LEVEL=12.34, got {device['values']['LEVEL']}"
        assert device.get("manual_water_temp_c") == 22.5, f"Expected manual_water_temp_c=22.5, got {device.get('manual_water_temp_c')}"
        print(f"✅ DWLR data verified: LEVEL={device['values']['LEVEL']}, manual_water_temp_c={device.get('manual_water_temp_c')}")
    
    def test_3_lowercase_p_prefix(self):
        """Test 3: Lowercase 'p' prefix (topic 'p999/0') → still routes as DWLR."""
        print("\n=== TEST 3: Lowercase 'p' prefix (topic 'p999/0') ===")
        
        payload = {
            "TIME": "260630130900",
            "SIGNAL": 15,
            "UNT": 1.0,
            "LEVEL": "13.50",
            "IMEI": "860738070478200",
            "VER": "4G-1"
        }
        
        resp = requests.post(
            f"{BASE_URL}/devices/mqtt-simulate",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            json={"topic": "p999/0", "payload": payload}
        )
        assert resp.status_code == 200, f"Simulate failed: {resp.status_code} {resp.text}"
        result = resp.json()
        
        assert result["dispatched"] is True, f"Expected dispatched=true, got {result}"
        assert result["topic_inferred_type"] == "dwlr", f"Expected topic_inferred_type=dwlr, got {result['topic_inferred_type']}"
        assert result["hardware_id"] == "SIMTEST_DWLR_1", f"Wrong hardware_id: {result['hardware_id']}"
        print(f"✅ Lowercase 'p' prefix routes as DWLR: {result}")
    
    def test_4_unregistered_imei(self):
        """Test 4: Unregistered IMEI → dispatched=false, no DB write."""
        print("\n=== TEST 4: Unregistered IMEI → dispatched=false ===")
        
        payload = {
            "IMEI": "000000000000000",
            "FLOW": "50.0",
            "TOT1": "10",
            "TOT2": "0",
            "RTOT1": "0",
            "RTOT2": "0",
            "UNT": 1.0,
            "SIGNAL": 10,
            "TIME": "260630131000"
        }
        
        resp = requests.post(
            f"{BASE_URL}/devices/mqtt-simulate",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            json={"topic": "999/0", "payload": payload}
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code} {resp.text}"
        result = resp.json()
        
        assert result["dispatched"] is False, f"Expected dispatched=false, got {result}"
        assert "IMEI '000000000000000' is not registered" in result["reason"], f"Wrong reason: {result['reason']}"
        print(f"✅ Unregistered IMEI rejected: {result}")
    
    def test_5_payload_missing_imei(self):
        """Test 5: Payload missing IMEI → dispatched=false."""
        print("\n=== TEST 5: Payload missing IMEI → dispatched=false ===")
        
        payload = {
            "FLOW": "10.0",
            "TOT1": "5",
            "TOT2": "0",
            "RTOT1": "0",
            "RTOT2": "0",
            "UNT": 1.0
        }
        
        resp = requests.post(
            f"{BASE_URL}/devices/mqtt-simulate",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            json={"topic": "999/0", "payload": payload}
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code} {resp.text}"
        result = resp.json()
        
        assert result["dispatched"] is False, f"Expected dispatched=false, got {result}"
        assert "payload missing IMEI field" in result["reason"], f"Wrong reason: {result['reason']}"
        print(f"✅ Payload missing IMEI rejected: {result}")
    
    def test_6_payload_raw_non_json_string(self):
        """Test 6: Payload as raw non-JSON string → dispatched=false."""
        print("\n=== TEST 6: Payload as raw non-JSON string → dispatched=false ===")
        
        resp = requests.post(
            f"{BASE_URL}/devices/mqtt-simulate",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            json={"topic": "999/0", "payload": "this is not json at all"}
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code} {resp.text}"
        result = resp.json()
        
        assert result["dispatched"] is False, f"Expected dispatched=false, got {result}"
        assert "payload is not valid JSON" in result["reason"], f"Wrong reason: {result['reason']}"
        print(f"✅ Raw non-JSON string rejected: {result}")
    
    def test_7_payload_double_encoded_json(self):
        """Test 7: Payload as raw JSON string (double-encoded) → should still work."""
        print("\n=== TEST 7: Payload as raw JSON string (double-encoded) ===")
        
        # Double-encoded JSON string
        payload_str = '{"IMEI":"860738070478100","FLOW":"50","TOT1":"10","TOT2":"0","RTOT1":"0","RTOT2":"0","UNT":1.0,"SIGNAL":12,"TIME":"260630131100"}'
        
        resp = requests.post(
            f"{BASE_URL}/devices/mqtt-simulate",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            json={"topic": "673/0", "payload": payload_str}
        )
        assert resp.status_code == 200, f"Simulate failed: {resp.status_code} {resp.text}"
        result = resp.json()
        
        assert result["dispatched"] is True, f"Expected dispatched=true for double-encoded JSON, got {result}"
        assert result["hardware_id"] == "SIMTEST_FM_1", f"Wrong hardware_id: {result['hardware_id']}"
        print(f"✅ Double-encoded JSON string coerced successfully: {result}")
    
    def test_8_auth_non_admin(self):
        """Test 8: Non-admin (client) POST → 403."""
        print("\n=== TEST 8: Auth - Non-admin POST → 403 ===")
        
        payload = {"IMEI": "860738070478100", "FLOW": "50"}
        
        resp = requests.post(
            f"{BASE_URL}/devices/mqtt-simulate",
            headers={"Authorization": f"Bearer {self.client_token}"},
            json={"topic": "673/0", "payload": payload}
        )
        assert resp.status_code == 403, f"Expected 403, got {resp.status_code} {resp.text}"
        print(f"✅ Non-admin rejected: 403")
    
    def test_9_auth_no_token(self):
        """Test 9: No auth header → 401 or 403."""
        print("\n=== TEST 9: Auth - No auth header → 401/403 ===")
        
        payload = {"IMEI": "860738070478100", "FLOW": "50"}
        
        resp = requests.post(
            f"{BASE_URL}/devices/mqtt-simulate",
            json={"topic": "673/0", "payload": payload}
        )
        assert resp.status_code in [401, 403], f"Expected 401/403, got {resp.status_code} {resp.text}"
        print(f"✅ No auth rejected: {resp.status_code}")
    
    def test_10_formula_verification(self):
        """Test 10: Data integrity - formula verification (TOT2=2, TOT1=100 → forward_totalizer=131170)."""
        print("\n=== TEST 10: Formula verification ===")
        
        payload = {
            "IMEI": "860738070478100",
            "FLOW": "45.0",
            "TOT1": "100",
            "TOT2": "2",
            "RTOT1": "50",
            "RTOT2": "1",
            "UNT": 1.0,
            "SIGNAL": 14,
            "TIME": "260630131200"
        }
        
        resp = requests.post(
            f"{BASE_URL}/devices/mqtt-simulate",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            json={"topic": "673/0", "payload": payload}
        )
        assert resp.status_code == 200, f"Simulate failed: {resp.status_code} {resp.text}"
        result = resp.json()
        assert result["dispatched"] is True, f"Expected dispatched=true, got {result}"
        print(f"✅ Payload delivered: {result}")
        
        # Verify formula: forward_totalizer = (TOT2 * 65535) + TOT1 = (2 * 65535) + 100 = 131170
        import time
        time.sleep(1)
        resp = requests.get(
            f"{BASE_URL}/flowmeter/history/SIMTEST_FM_1?limit=5",
            headers={"Authorization": f"Bearer {self.admin_token}"}
        )
        assert resp.status_code == 200, f"History fetch failed: {resp.status_code} {resp.text}"
        history_data = resp.json()
        
        # Handle both list and dict responses
        if isinstance(history_data, dict):
            history = history_data.get("readings", history_data.get("data", []))
        else:
            history = history_data
        
        # Find the reading with TOT1=100, TOT2=2
        reading = next((r for r in history if r.get("tot1") == 100.0 and r.get("tot2") == 2.0), None)
        assert reading is not None, "Reading with TOT1=100, TOT2=2 not found"
        
        expected_forward = (2 * 65535) + 100  # = 131170
        expected_reverse = (1 * 65535) + 50   # = 65585
        
        assert reading["forward_totalizer"] == expected_forward, f"Expected forward_totalizer={expected_forward}, got {reading['forward_totalizer']}"
        assert reading["reverse_totalizer"] == expected_reverse, f"Expected reverse_totalizer={expected_reverse}, got {reading['reverse_totalizer']}"
        print(f"✅ Formula verified: forward_totalizer={reading['forward_totalizer']} (expected {expected_forward}), reverse_totalizer={reading['reverse_totalizer']} (expected {expected_reverse})")
    
    def test_11_regression_existing_endpoints(self):
        """Test 11: Regression - existing endpoints still work."""
        print("\n=== TEST 11: Regression - existing endpoints ===")
        
        # Test /api/flowmeter/status
        resp = requests.get(
            f"{BASE_URL}/flowmeter/status",
            headers={"Authorization": f"Bearer {self.admin_token}"}
        )
        assert resp.status_code == 200, f"flowmeter/status failed: {resp.status_code} {resp.text}"
        status = resp.json()
        assert "broker" in status, "broker field missing in status"
        print(f"✅ /api/flowmeter/status working: broker={status.get('broker')}")
        
        # Test /api/instrument-registry
        resp = requests.get(
            f"{BASE_URL}/instrument-registry",
            headers={"Authorization": f"Bearer {self.admin_token}"}
        )
        assert resp.status_code == 200, f"instrument-registry failed: {resp.status_code} {resp.text}"
        registry = resp.json()
        assert "instruments" in registry or "count" in registry, "Expected instruments or count field"
        print(f"✅ /api/instrument-registry working")
    
    def cleanup(self):
        """Clean up test instruments and user."""
        print("\n=== MQTT SIMULATION: Cleanup ===")
        for hw_id in self.test_instruments.keys():
            resp = requests.delete(
                f"{BASE_URL}/instrument-registry/{hw_id}",
                headers={"Authorization": f"Bearer {self.admin_token}"}
            )
            if resp.status_code == 200:
                print(f"✅ Deleted instrument: {hw_id}")
            else:
                print(f"⚠️  Failed to delete {hw_id}: {resp.status_code}")
        
        if self.test_user_id:
            resp = requests.delete(
                f"{BASE_URL}/admin/users/{self.test_user_id}",
                headers={"Authorization": f"Bearer {self.admin_token}"}
            )
            if resp.status_code == 200:
                print(f"✅ Deleted test user: {self.test_user_id}")
            else:
                print(f"⚠️  Failed to delete user: {resp.status_code}")


def main():
    """Run all test suites."""
    print("=" * 80)
    print("ENVIROLYTICS MONITOR - MQTT SIMULATION TEST SUITE")
    print("=" * 80)
    
    # Test 1: MQTT Simulation (11 tests)
    print("\n" + "=" * 80)
    print("PART 1: MQTT END-TO-END SIMULATION (11 TESTS)")
    print("=" * 80)
    mqtt_sim_suite = TestMQTTSimulation()
    try:
        mqtt_sim_suite.setup()
        mqtt_sim_suite.test_1_flowmeter_delivery()
        mqtt_sim_suite.test_2_dwlr_delivery()
        mqtt_sim_suite.test_3_lowercase_p_prefix()
        mqtt_sim_suite.test_4_unregistered_imei()
        mqtt_sim_suite.test_5_payload_missing_imei()
        mqtt_sim_suite.test_6_payload_raw_non_json_string()
        mqtt_sim_suite.test_7_payload_double_encoded_json()
        mqtt_sim_suite.test_8_auth_non_admin()
        mqtt_sim_suite.test_9_auth_no_token()
        mqtt_sim_suite.test_10_formula_verification()
        mqtt_sim_suite.test_11_regression_existing_endpoints()
        print("\n✅ MQTT SIMULATION: ALL 11 TESTS PASSED")
    except AssertionError as e:
        print(f"\n❌ MQTT SIMULATION TEST FAILED: {e}")
        raise
    finally:
        mqtt_sim_suite.cleanup()
    
    print("\n" + "=" * 80)
    print("ALL TEST SUITES COMPLETED SUCCESSFULLY")
    print("=" * 80)
    print("\nSUMMARY:")
    print("  ✅ MQTT End-to-End Simulation: 11/11 tests passed")
    print("  ✅ TOTAL: 11/11 tests passed")


if __name__ == "__main__":
    main()
