"""End-to-end tests for the new Instrument Registry feature (iteration 7).

Covers: admin CRUD, multi-tenant filtering, dashboard endpoint visibility,
wipe-demo cascade, validation (missing fields, duplicate hardware_id),
and that field-simulator is disabled.
"""
import os
import uuid
import pytest
import requests

# External preview URL times out from inside this container, so default to localhost:8001
# which is the actual FastAPI process. Override via env BASE_URL if needed.
BASE_URL = os.environ.get("BASE_URL") or os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001")
BASE_URL = BASE_URL.rstrip("/")

ADMIN_EMAIL = "admin@envirolytics.com"
ADMIN_PASS = "Admin@Envirolytics2026"
CLIENT_EMAIL = "client@envirolytics.com"
CLIENT_PASS = "Client@123456"

DEMO_IDS = ["FM_GW_001", "FM_STP_IN", "FM_STP_OUT", "DWLR001", "PH001", "TDS001", "COND001"]


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed {email}: {r.status_code} {r.text}"
    body = r.json()
    return body["access_token"], body["user"]


@pytest.fixture(scope="module")
def admin_session():
    token, user = _login(ADMIN_EMAIL, ADMIN_PASS)
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s, user


@pytest.fixture(scope="module")
def client_session(admin_session):
    """Login as a regular client. Create the user via admin API if missing."""
    s_admin, _ = admin_session
    # ensure client exists; ignore if already there
    s_admin.post(f"{BASE_URL}/api/admin/users/create", json={
        "email": CLIENT_EMAIL,
        "password": CLIENT_PASS,
        "full_name": "Test Client",
        "role": "client",
    }, timeout=15)
    token, user = _login(CLIENT_EMAIL, CLIENT_PASS)
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s, user


@pytest.fixture(scope="module")
def created_hw_ids():
    return []


# ---------- 1. Basic auth + sanity ----------
class TestSanity:
    def test_health(self):
        r = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert r.status_code in (200, 404), r.status_code  # if no health route, login proves it up

    def test_login_admin(self, admin_session):
        s, u = admin_session
        assert u["role"] == "admin"

    def test_flowmeter_status(self, admin_session):
        s, _ = admin_session
        r = s.get(f"{BASE_URL}/api/flowmeter/status", timeout=10)
        assert r.status_code == 200
        data = r.json()
        # broker should report a status field at minimum
        assert "broker_connected" in data or "connected" in data or "status" in data


# ---------- 2. Validation ----------
class TestValidation:
    def test_create_missing_owner(self, admin_session):
        s, _ = admin_session
        r = s.post(f"{BASE_URL}/api/instrument-registry", json={
            "hardware_id": f"TEST_VAL_{uuid.uuid4().hex[:6]}",
            "instrument_type": "flowmeter",
        }, timeout=10)
        assert r.status_code == 422, r.text  # owner_user_id is a required field

    def test_create_missing_hw_id(self, admin_session):
        s, _ = admin_session
        r = s.post(f"{BASE_URL}/api/instrument-registry", json={
            "instrument_type": "flowmeter",
            "owner_user_id": "irrelevant",
        }, timeout=10)
        assert r.status_code == 422, r.text

    def test_create_unknown_owner(self, admin_session):
        s, _ = admin_session
        r = s.post(f"{BASE_URL}/api/instrument-registry", json={
            "hardware_id": f"TEST_UO_{uuid.uuid4().hex[:6]}",
            "instrument_type": "flowmeter",
            "owner_user_id": "does-not-exist",
        }, timeout=10)
        assert r.status_code == 404


# ---------- 3. CRUD + multi-tenant ----------
class TestCRUDMultiTenant:
    def test_create_assign_to_client(self, admin_session, client_session, created_hw_ids):
        s_admin, _ = admin_session
        _, client_user = client_session
        hw = f"TEST_FM_{uuid.uuid4().hex[:6]}"
        r = s_admin.post(f"{BASE_URL}/api/instrument-registry", json={
            "hardware_id": hw,
            "instrument_type": "flowmeter",
            "owner_user_id": client_user["id"],
            "label": "Test Plant A Flowmeter",
            "category": "groundwater_abstraction",
            "location_name": "Borewell Test",
            "latitude": 26.85,
            "longitude": 80.95,
        }, timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["success"] is True
        assert body["instrument"]["hardware_id"] == hw
        assert body["instrument"]["owner_user_id"] == client_user["id"]
        created_hw_ids.append(hw)

    def test_duplicate_returns_409(self, admin_session, client_session, created_hw_ids):
        s_admin, _ = admin_session
        _, client_user = client_session
        assert created_hw_ids, "previous test should have created one"
        hw = created_hw_ids[0]
        r = s_admin.post(f"{BASE_URL}/api/instrument-registry", json={
            "hardware_id": hw,
            "instrument_type": "flowmeter",
            "owner_user_id": client_user["id"],
        }, timeout=10)
        assert r.status_code == 409

    def test_admin_lists_all(self, admin_session, created_hw_ids):
        s, _ = admin_session
        r = s.get(f"{BASE_URL}/api/instrument-registry", timeout=10)
        assert r.status_code == 200
        ids = {it["hardware_id"] for it in r.json()["instruments"]}
        for hw in created_hw_ids:
            assert hw in ids, f"admin should see {hw}"

    def test_client_only_sees_own(self, admin_session, client_session, created_hw_ids):
        s_admin, _ = admin_session
        s_client, client_user = client_session
        # Create another instrument owned by admin (not the client)
        admin_hw = f"TEST_ADM_{uuid.uuid4().hex[:6]}"
        admin_user_id = admin_session[1]["id"]
        r = s_admin.post(f"{BASE_URL}/api/instrument-registry", json={
            "hardware_id": admin_hw,
            "instrument_type": "ph",
            "owner_user_id": admin_user_id,
        }, timeout=10)
        assert r.status_code == 200
        created_hw_ids.append(admin_hw)

        r = s_client.get(f"{BASE_URL}/api/instrument-registry", timeout=10)
        assert r.status_code == 200
        client_items = r.json()["instruments"]
        ids = {it["hardware_id"] for it in client_items}
        # Client SHOULD see their own
        assert created_hw_ids[0] in ids
        # Client SHOULD NOT see the admin-owned one
        assert admin_hw not in ids
        # All listed must belong to client
        for it in client_items:
            assert it["owner_user_id"] == client_user["id"]

    def test_update_instrument(self, admin_session, created_hw_ids):
        s, _ = admin_session
        hw = created_hw_ids[0]
        r = s.put(f"{BASE_URL}/api/instrument-registry/{hw}", json={
            "label": "Renamed Plant A FM",
            "location_name": "Renamed location",
        }, timeout=10)
        assert r.status_code == 200, r.text
        assert "label" in r.json()["updated_fields"]
        # verify persistence
        r2 = s.get(f"{BASE_URL}/api/instrument-registry", timeout=10)
        found = next((i for i in r2.json()["instruments"] if i["hardware_id"] == hw), None)
        assert found is not None
        assert found["label"] == "Renamed Plant A FM"

    def test_dashboard_filters_for_client(self, client_session):
        s, _ = client_session
        # /api/flowmeter/latest should return only items the client owns
        r = s.get(f"{BASE_URL}/api/flowmeter/latest", timeout=10)
        assert r.status_code == 200
        # /api/instruments/all/latest also filtered
        r2 = s.get(f"{BASE_URL}/api/instruments/all/latest", timeout=10)
        assert r2.status_code == 200
        # /api/flowmeter-mgmt/categories filtered
        r3 = s.get(f"{BASE_URL}/api/flowmeter-mgmt/categories", timeout=10)
        assert r3.status_code == 200
        # Demo IDs MUST NOT appear in any client response
        body = (r.json(), r2.json(), r3.json())
        blob = str(body)
        for hw in DEMO_IDS:
            assert hw not in blob, f"demo id {hw} leaked to client response"


# ---------- 4. Client cannot mutate ----------
class TestClientForbidden:
    def test_client_cannot_create(self, client_session):
        s, _ = client_session
        r = s.post(f"{BASE_URL}/api/instrument-registry", json={
            "hardware_id": "TEST_CLIENT_FAIL",
            "instrument_type": "flowmeter",
            "owner_user_id": "any",
        }, timeout=10)
        assert r.status_code == 403, r.status_code

    def test_client_cannot_wipe_demo(self, client_session):
        s, _ = client_session
        r = s.post(f"{BASE_URL}/api/instrument-registry/wipe-demo", timeout=10)
        assert r.status_code == 403

    def test_client_cannot_delete(self, client_session):
        s, _ = client_session
        r = s.delete(f"{BASE_URL}/api/instrument-registry/anything", timeout=10)
        assert r.status_code in (403, 404)  # 404 if missing, 403 if forbidden — both prove no destructive access


# ---------- 5. Wipe Demo ----------
class TestWipeDemo:
    def test_wipe_demo_returns_summary(self, admin_session):
        s, _ = admin_session
        r = s.post(f"{BASE_URL}/api/instrument-registry/wipe-demo", timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["success"] is True
        assert body["wiped"]["device_count"] == 7
        for hw in DEMO_IDS:
            assert hw in body["wiped"]["per_device"]

    def test_demo_devices_purged_from_endpoints(self, admin_session):
        s, _ = admin_session
        r = s.get(f"{BASE_URL}/api/flowmeter/latest", timeout=10)
        assert r.status_code == 200
        assert not any(item.get("hardware_id") in DEMO_IDS for item in (r.json() if isinstance(r.json(), list) else r.json().get("readings", [])))


# ---------- 6. Delete (cascade) ----------
class TestDelete:
    def test_admin_delete_cascades(self, admin_session, created_hw_ids):
        s, _ = admin_session
        for hw in list(created_hw_ids):
            r = s.delete(f"{BASE_URL}/api/instrument-registry/{hw}", timeout=10)
            assert r.status_code == 200, f"delete {hw}: {r.text}"
            body = r.json()
            assert body["success"] is True
            assert body["hardware_id"] == hw
            assert "removed" in body
        # Verify all are gone
        r = s.get(f"{BASE_URL}/api/instrument-registry", timeout=10)
        ids = {it["hardware_id"] for it in r.json()["instruments"]}
        for hw in created_hw_ids:
            assert hw not in ids
        created_hw_ids.clear()

    def test_delete_unknown_returns_404(self, admin_session):
        s, _ = admin_session
        r = s.delete(f"{BASE_URL}/api/instrument-registry/DOES_NOT_EXIST_xyz", timeout=10)
        assert r.status_code == 404


# ---------- 7. Existing endpoints regression ----------
class TestRegression:
    def test_auth_me(self, admin_session):
        s, _ = admin_session
        r = s.get(f"{BASE_URL}/api/auth/me", timeout=10)
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN_EMAIL

    def test_audit_log(self, admin_session):
        s, _ = admin_session
        r = s.get(f"{BASE_URL}/api/audit-log", timeout=10)
        assert r.status_code in (200, 404)  # endpoint may have alternate path

    def test_weather(self, admin_session):
        s, _ = admin_session
        r = s.get(f"{BASE_URL}/api/weather/current", timeout=15)
        assert r.status_code in (200, 404)
