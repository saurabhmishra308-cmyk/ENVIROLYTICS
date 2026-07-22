"""Iteration — Admin-only ESPL/MQTT traffic + LockedSectionOverlay + access requests.

Backend surface under test (all against the public REACT_APP_BACKEND_URL):
- GET  /api/flowmeter/status                    → shape (connected, subscribed_topics, broker, total_received, dropped_unknown, recent_messages)
- GET  /api/devices/qespl/traffic  (admin only) → shape + 401/403 for client
- POST /api/devices/qespl/run-now  (admin only) → {success, polled, ok, failed}
- POST /api/instrument-registry     (admin only) → 401/403 for client
- POST /api/access-requests         (auth)      → 200 with {success, logged, admin}
- Registered devices: DTU10020326 and DTU10020426 (dometer / DO Analyzer) already seeded.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@envirolytics.com"
ADMIN_PASSWORD = "Admin@Envirolytics2026"
CLIENT_EMAIL = "testclient@envirolytics.com"
CLIENT_PASSWORD = "Client@Test2026"


# -------- Fixtures --------
@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"Admin login failed: {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def client_token():
    r = requests.post(f"{API}/auth/login", json={"email": CLIENT_EMAIL, "password": CLIENT_PASSWORD})
    assert r.status_code == 200, f"Client login failed: {r.text}"
    data = r.json()
    assert data["user"]["role"] == "client"
    return data["access_token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def client_headers(client_token):
    return {"Authorization": f"Bearer {client_token}", "Content-Type": "application/json"}


# -------- MQTT /api/flowmeter/status shape --------
class TestFlowmeterStatusShape:
    def test_status_has_required_keys(self):
        r = requests.get(f"{API}/flowmeter/status")
        assert r.status_code == 200
        body = r.json()
        for k in ("connected", "subscribed_topics", "broker",
                  "total_received", "dropped_unknown", "recent_messages"):
            assert k in body, f"missing key {k} in /flowmeter/status"
        assert isinstance(body["subscribed_topics"], list)
        assert isinstance(body["recent_messages"], list)
        assert "broker.hivemq.com" in body["broker"] or body["broker"] != "—"


# -------- ESPL /api/devices/qespl/traffic shape + auth --------
class TestQesplTraffic:
    def test_traffic_admin_shape(self, admin_headers):
        r = requests.get(f"{API}/devices/qespl/traffic", headers=admin_headers)
        assert r.status_code == 200, r.text
        body = r.json()
        for k in ("endpoint", "interval_sec", "auth_enabled",
                  "total_polled", "failed", "last_pass_at", "recent_polls", "registered_devices"):
            assert k in body, f"missing key {k} in /devices/qespl/traffic"
        assert isinstance(body["recent_polls"], list)
        # 2 DTUs already registered under admin as qespl_api
        assert body["registered_devices"] >= 2

    def test_traffic_client_forbidden(self, client_headers):
        r = requests.get(f"{API}/devices/qespl/traffic", headers=client_headers)
        assert r.status_code in (401, 403)

    def test_traffic_no_auth_forbidden(self):
        r = requests.get(f"{API}/devices/qespl/traffic")
        assert r.status_code in (401, 403)


# -------- ESPL /run-now (poll now) --------
class TestQesplRunNow:
    def test_run_now_admin_success(self, admin_headers):
        r = requests.post(f"{API}/devices/qespl/run-now", headers=admin_headers, timeout=60)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("success") is True
        for k in ("polled", "ok", "failed"):
            assert k in body
        # 2 devices seeded; polled should be at least 2
        assert body["polled"] >= 2

    def test_run_now_client_forbidden(self, client_headers):
        r = requests.post(f"{API}/devices/qespl/run-now", headers=client_headers)
        assert r.status_code in (401, 403)

    def test_run_now_no_auth_forbidden(self):
        r = requests.post(f"{API}/devices/qespl/run-now")
        assert r.status_code in (401, 403)


# -------- Instrument Registry admin-only writes --------
class TestInstrumentRegistryGuard:
    def test_client_cannot_post_registry(self, client_headers):
        payload = {
            "hardware_id": f"TEST_HW_{uuid.uuid4().hex[:6]}",
            "instrument_type": "flowmeter",
            "label": "Client attempt",
        }
        r = requests.post(f"{API}/instrument-registry", headers=client_headers, json=payload)
        assert r.status_code in (401, 403)

    def test_no_auth_cannot_post_registry(self):
        payload = {"hardware_id": "X", "instrument_type": "flowmeter"}
        r = requests.post(f"{API}/instrument-registry", json=payload)
        assert r.status_code in (401, 403)


# -------- Access Requests --------
class TestAccessRequests:
    def test_client_can_submit_access_request(self, client_headers):
        payload = {
            "instrument_type": "flowmeter",
            "hardware_id_hint": "TEST_HW_HINT",
            "message": "TEST — please register a flowmeter for me",
        }
        r = requests.post(f"{API}/access-requests", headers=client_headers, json=payload)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("success") is True
        assert body.get("logged") is True
        # ADMIN_EMAIL should be saurabh@envirolytics.in unless overridden
        assert "admin" in body

    def test_no_auth_access_request_blocked(self):
        r = requests.post(f"{API}/access-requests", json={"instrument_type": "flowmeter"})
        assert r.status_code in (401, 403)

    def test_access_request_validation(self, client_headers):
        # Empty instrument_type
        r = requests.post(f"{API}/access-requests", headers=client_headers,
                          json={"instrument_type": ""})
        assert r.status_code in (400, 422)


# -------- Registered DTUs check --------
class TestRegisteredDtus:
    def test_two_dtus_registered_as_dometer(self, admin_headers):
        r = requests.get(f"{API}/instrument-registry", headers=admin_headers)
        assert r.status_code == 200
        items = r.json()["instruments"]
        dtus = [i for i in items if i["hardware_id"] in ("DTU10020326", "DTU10020426")]
        assert len(dtus) == 2, f"Expected both DTUs seeded, got {[d['hardware_id'] for d in dtus]}"
        for d in dtus:
            assert d.get("device_source") == "qespl_api", f"{d['hardware_id']} device_source={d.get('device_source')}"
            assert d.get("instrument_type") == "dometer", f"{d['hardware_id']} type={d.get('instrument_type')}"
            assert d.get("qespl_device_id") == d["hardware_id"], f"{d['hardware_id']} qespl_device_id missing/mismatch"
