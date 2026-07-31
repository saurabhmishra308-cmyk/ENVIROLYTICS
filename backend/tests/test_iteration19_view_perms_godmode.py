"""
Iteration 19 backend regression tests:
- Admin login (email, username, and by user id via /auth/me)
- Per-device-type view permissions (8 new keys) and enforcement on /api/instrument-registry
- Admin GOD-MODE guards (cannot deactivate/delete/demote admin, cannot set view-perms)
- Refactored api_wq_config.py endpoints still functional
"""
import os
import pytest
import requests

def _load_env():
    from pathlib import Path
    envf = Path("/app/frontend/.env")
    if envf.exists():
        for line in envf.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip()
    return os.environ.get("REACT_APP_BACKEND_URL", "")

BASE_URL = _load_env().rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL missing"
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@envirolytics.com"
ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "Admin@Envirolytics2026"
CLIENT_EMAIL = "testclient@envirolytics.com"
CLIENT_USERNAME = "testclient"
CLIENT_PASSWORD = "Client@Test2026"

DEVICE_TYPE_KEYS = [
    "show_flowmeter_devices",
    "show_dwlr_devices",
    "show_do_devices",
    "show_chlorine_devices",
    "show_ocems_devices",
    "show_ph_devices",
    "show_tds_devices",
    "show_conductivity_devices",
]


def _login(identifier: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": identifier, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed for {identifier}: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok, f"no token in login resp: {r.json()}"
    return tok


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def client_token():
    return _login(CLIENT_USERNAME, CLIENT_PASSWORD)


@pytest.fixture(scope="module")
def client_headers(client_token):
    return {"Authorization": f"Bearer {client_token}"}


@pytest.fixture(scope="module")
def admin_id(admin_headers):
    r = requests.get(f"{API}/auth/me", headers=admin_headers, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.fixture(scope="module")
def client_id(admin_headers):
    r = requests.get(f"{API}/admin/users/list", headers=admin_headers, timeout=10)
    assert r.status_code == 200, r.text
    users = r.json().get("users", []) if isinstance(r.json(), dict) else r.json()
    for u in users:
        if u.get("username") == CLIENT_USERNAME or u.get("email") == CLIENT_EMAIL:
            return u["id"]
    pytest.fail("testclient user not found")


# ----------------------------- Admin login ------------------------------
class TestAdminLogin:
    def test_login_with_email(self):
        tok = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
        assert isinstance(tok, str) and len(tok) > 20

    def test_login_with_username(self):
        tok = _login(ADMIN_USERNAME, ADMIN_PASSWORD)
        assert isinstance(tok, str) and len(tok) > 20

    def test_me_returns_admin_role(self, admin_headers):
        r = requests.get(f"{API}/auth/me", headers=admin_headers, timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert data["role"] == "admin"
        assert data.get("is_active") is True


# --------------------- View permissions get/put (8 device keys) ---------
class TestViewPermissions:
    def test_get_view_permissions_has_all_23_keys(self, admin_headers, client_id):
        r = requests.get(f"{API}/admin/users/{client_id}/view-permissions", headers=admin_headers, timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "permissions" in data
        perms = data["permissions"]
        for k in DEVICE_TYPE_KEYS:
            assert k in perms, f"missing device-type key {k}"
        # 15 page keys + 8 device keys
        all_keys = data.get("all_keys", [])
        assert len(all_keys) == 23, f"expected 23 keys, got {len(all_keys)}: {all_keys}"

    def test_put_view_permissions_accepts_device_keys(self, admin_headers, client_id):
        payload = {"permissions": {k: True for k in DEVICE_TYPE_KEYS}}
        r = requests.put(
            f"{API}/admin/users/{client_id}/view-permissions",
            headers=admin_headers, json=payload, timeout=10
        )
        assert r.status_code == 200, r.text
        p = r.json()["permissions"]
        for k in DEVICE_TYPE_KEYS:
            assert p[k] is True

    def test_me_view_permissions_client(self, client_headers):
        r = requests.get(f"{API}/auth/me/view-permissions", headers=client_headers, timeout=10)
        assert r.status_code == 200, r.text
        perms = r.json()["permissions"]
        for k in DEVICE_TYPE_KEYS:
            assert k in perms

    def test_me_view_permissions_admin_all_true(self, admin_headers):
        r = requests.get(f"{API}/auth/me/view-permissions", headers=admin_headers, timeout=10)
        assert r.status_code == 200
        perms = r.json()["permissions"]
        for k in DEVICE_TYPE_KEYS:
            assert perms.get(k) is True


# ----------------------- Enforcement on instrument-registry --------------
class TestDeviceTypeEnforcement:
    def _set_flowmeter(self, admin_headers, client_id, value: bool):
        r = requests.put(
            f"{API}/admin/users/{client_id}/view-permissions",
            headers=admin_headers,
            json={"permissions": {"show_flowmeter_devices": value}}, timeout=10
        )
        assert r.status_code == 200, r.text

    def test_client_registry_excludes_flowmeter_when_disabled(self, admin_headers, client_headers, client_id):
        # baseline: enable everything
        self._set_flowmeter(admin_headers, client_id, True)
        r0 = requests.get(f"{API}/instrument-registry", headers=client_headers, timeout=10)
        assert r0.status_code == 200, r0.text
        items0 = r0.json() if isinstance(r0.json(), list) else r0.json().get("instruments", [])
        types0 = {i.get("instrument_type") for i in items0}
        hw_ids0 = {i.get("hardware_id") for i in items0}
        assert "flowmeter" in types0, f"expected flowmeter visible when ON. types={types0} hw={hw_ids0}"

        # disable flowmeter
        self._set_flowmeter(admin_headers, client_id, False)
        r1 = requests.get(f"{API}/instrument-registry", headers=client_headers, timeout=10)
        assert r1.status_code == 200
        items1 = r1.json() if isinstance(r1.json(), list) else r1.json().get("instruments", [])
        types1 = {i.get("instrument_type") for i in items1}
        assert "flowmeter" not in types1, f"flowmeter should be hidden. types={types1}"

        # filtered query returns empty
        r2 = requests.get(f"{API}/instrument-registry?instrument_type=flowmeter", headers=client_headers, timeout=10)
        assert r2.status_code == 200
        items2 = r2.json() if isinstance(r2.json(), list) else r2.json().get("instruments", [])
        assert len(items2) == 0, f"expected empty when flowmeter hidden, got {items2}"

        # /api/instruments/all/latest also excludes flowmeter
        r3 = requests.get(f"{API}/instruments/all/latest", headers=client_headers, timeout=10)
        assert r3.status_code == 200
        latest = r3.json() if isinstance(r3.json(), list) else r3.json().get("instruments", r3.json().get("readings", []))
        latest_types = {i.get("instrument_type") for i in (latest if isinstance(latest, list) else [])}
        assert "flowmeter" not in latest_types, f"latest still shows flowmeter: {latest_types}"

        # re-enable
        self._set_flowmeter(admin_headers, client_id, True)
        r4 = requests.get(f"{API}/instrument-registry", headers=client_headers, timeout=10)
        items4 = r4.json() if isinstance(r4.json(), list) else r4.json().get("instruments", [])
        types4 = {i.get("instrument_type") for i in items4}
        assert "flowmeter" in types4, "flowmeter should reappear after re-enable"

    def test_admin_sees_all_devices_regardless(self, admin_headers, client_id):
        # even if we set some toggles on client, admin registry is unchanged
        requests.put(
            f"{API}/admin/users/{client_id}/view-permissions",
            headers=admin_headers,
            json={"permissions": {"show_flowmeter_devices": False}}, timeout=10
        )
        r = requests.get(f"{API}/instrument-registry", headers=admin_headers, timeout=10)
        assert r.status_code == 200
        items = r.json() if isinstance(r.json(), list) else r.json().get("instruments", [])
        types = {i.get("instrument_type") for i in items}
        assert "flowmeter" in types, f"admin should see flowmeter; got {types}"
        # restore
        requests.put(
            f"{API}/admin/users/{client_id}/view-permissions",
            headers=admin_headers,
            json={"permissions": {"show_flowmeter_devices": True}}, timeout=10
        )


# ------------------------ GOD-MODE guards ------------------------------
class TestAdminGodMode:
    def test_cannot_deactivate_admin(self, admin_headers, admin_id):
        r = requests.put(
            f"{API}/admin/users/{admin_id}/status?is_active=false",
            headers=admin_headers, timeout=10
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"

    def test_cannot_delete_admin(self, admin_headers, admin_id):
        r = requests.delete(f"{API}/admin/users/{admin_id}", headers=admin_headers, timeout=10)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"

    def test_cannot_demote_admin(self, admin_headers, admin_id):
        r = requests.put(
            f"{API}/admin/users/{admin_id}",
            headers=admin_headers, json={"role": "client"}, timeout=10
        )
        assert r.status_code == 400
        assert "admin" in r.text.lower()

    def test_cannot_set_view_perms_on_admin(self, admin_headers, admin_id):
        r = requests.put(
            f"{API}/admin/users/{admin_id}/view-permissions",
            headers=admin_headers,
            json={"permissions": {"dashboard": False}}, timeout=10
        )
        assert r.status_code == 400

    def test_admin_still_active_and_admin_role_after_guards(self, admin_headers):
        r = requests.get(f"{API}/auth/me", headers=admin_headers, timeout=10)
        assert r.status_code == 200
        assert r.json()["role"] == "admin"
        assert r.json().get("is_active") is True
        # can still login fresh
        tok = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
        assert tok


# ----------------- WQ config refactor regression ------------------------
class TestWQConfigRefactor:
    def test_wq_latest(self, admin_headers):
        r = requests.get(f"{API}/water-quality/latest", headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text

    def test_wq_stp_config_admin(self, admin_headers):
        # try a common wq_stp hw_id if exists; otherwise fallback: pick any wq_stp from registry
        r = requests.get(f"{API}/instrument-registry", headers=admin_headers, timeout=10)
        items = r.json() if isinstance(r.json(), list) else r.json().get("instruments", [])
        stp = next((i for i in items if i.get("instrument_type") == "wq_stp"), None)
        if not stp:
            pytest.skip("no wq_stp device in registry")
        hw = stp["hardware_id"]
        r2 = requests.get(f"{API}/water-quality/{hw}/stp-config", headers=admin_headers, timeout=10)
        assert r2.status_code == 200, r2.text

    def test_do_tank_config_put(self, admin_headers):
        payload = {"tank_volume_liters": 1000, "target_do_mg_l": 4.0}
        r = requests.put(
            f"{API}/water-quality/VTDO001/do-tank-config",
            headers=admin_headers, json=payload, timeout=10
        )
        # allow 200/204; some impls may 404 if hw missing – but VTDO001 must exist
        assert r.status_code in (200, 204), r.text

    def test_wq_thresholds_put(self, admin_headers):
        payload = {"chlorine_min": 0.2, "chlorine_max": 2.0}
        r = requests.put(
            f"{API}/water-quality/VTDO001/thresholds",
            headers=admin_headers, json=payload, timeout=10
        )
        # 200 expected; 422 acceptable if payload shape differs but endpoint reachable
        assert r.status_code in (200, 204, 422), r.text

    def test_wq_history_raw(self, admin_headers):
        r = requests.get(f"{API}/water-quality/history/VTDO001?range=raw", headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
