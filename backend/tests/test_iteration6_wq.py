"""Iteration-6 regression tests.

Covers:
  * PUT /api/water-quality/{hw}/do-tank-config — admin only, do_meter only,
    stores updated_by/updated_at.
  * GET /api/water-quality/latest — do_tank_config visible for admin (with
    fingerprints) and for client (without fingerprints).
  * PUT /api/water-quality/{hw}/stp-config with param_ranges + dummy_auto_push,
    including automatic dummy_config sync (enable/disable via
    auto_from_stp_cfg).
  * _generate_wq_stp respects param_ranges — 5 consecutive readings inside
    the configured band and NOT constant.
"""
import asyncio
import os
import sys
import pytest
import requests

sys.path.insert(0, "/app/backend")

# Load .env files so tests work when invoked directly with pytest.
from dotenv import load_dotenv
load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@envirolytics.com"
ADMIN_PASSWORD = "Admin@Envirolytics2026"
CLIENT_EMAIL = "testclient@envirolytics.com"
CLIENT_PASSWORD = "Client@Test2026"
CLIENT_USER_ID = "user_dd92c46509ff"
DEFAULT_OWNER_USER_ID = "user_52eee1f7927c"

DO_HW = "DO_TEST_001"
STP_HW = "STP_TEST_001"


# --------------------------------------------------------------------------- fixtures

@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def client_headers():
    r = requests.post(f"{API}/auth/login",
                      json={"email": CLIENT_EMAIL, "password": CLIENT_PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
def reassign_to_client(admin_headers):
    """Temporarily reassign STP + DO test devices to the client, then revert."""
    for hw in (DO_HW, STP_HW):
        r = requests.put(f"{API}/instrument-registry/{hw}",
                          headers=admin_headers,
                          json={"owner_user_id": CLIENT_USER_ID})
        assert r.status_code == 200, r.text
    yield
    for hw in (DO_HW, STP_HW):
        requests.put(f"{API}/instrument-registry/{hw}",
                     headers=admin_headers,
                     json={"owner_user_id": DEFAULT_OWNER_USER_ID})


# --------------------------------------------------------------------------- DO tank config

class TestDoTankConfigEndpoint:
    """PUT /api/water-quality/{hw}/do-tank-config"""

    def test_admin_can_save(self, admin_headers):
        r = requests.put(f"{API}/water-quality/{DO_HW}/do-tank-config",
                          headers=admin_headers,
                          json={"tank_1_kld": 250, "tank_2_kld": 180})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("success") is True
        cfg = body.get("do_tank_config") or {}
        assert cfg.get("tank_1_kld") == 250
        assert cfg.get("tank_2_kld") == 180
        assert cfg.get("updated_by") == ADMIN_EMAIL
        assert isinstance(cfg.get("updated_at"), str) and len(cfg["updated_at"]) > 0

    def test_stp_device_rejected(self, admin_headers):
        r = requests.put(f"{API}/water-quality/{STP_HW}/do-tank-config",
                          headers=admin_headers,
                          json={"tank_1_kld": 100, "tank_2_kld": 100})
        assert r.status_code == 400, r.text
        assert "do_meter" in (r.json().get("detail") or "").lower()

    def test_client_forbidden(self, client_headers):
        r = requests.put(f"{API}/water-quality/{DO_HW}/do-tank-config",
                          headers=client_headers,
                          json={"tank_1_kld": 999, "tank_2_kld": 999})
        assert r.status_code == 403, r.text

    def test_unknown_device_404(self, admin_headers):
        r = requests.put(f"{API}/water-quality/NOPE_XYZ/do-tank-config",
                          headers=admin_headers,
                          json={"tank_1_kld": 250, "tank_2_kld": 180})
        assert r.status_code == 404


# --------------------------------------------------------------------------- /latest visibility

class TestLatestDoTankConfigVisibility:

    def _find(self, items, hw):
        return next((it for it in items if it.get("hardware_id") == hw), None)

    def test_admin_sees_full_config(self, admin_headers):
        # ensure config exists
        requests.put(f"{API}/water-quality/{DO_HW}/do-tank-config",
                     headers=admin_headers,
                     json={"tank_1_kld": 250, "tank_2_kld": 180})
        r = requests.get(f"{API}/water-quality/latest", headers=admin_headers)
        assert r.status_code == 200
        do_items = r.json().get("do") or []
        rec = self._find(do_items, DO_HW)
        assert rec is not None, f"DO device missing from /latest response"
        cfg = (rec.get("_registry") or {}).get("do_tank_config") or {}
        assert cfg.get("tank_1_kld") == 250
        assert cfg.get("tank_2_kld") == 180
        assert cfg.get("updated_by") == ADMIN_EMAIL
        assert cfg.get("updated_at")

    def test_client_sees_sanitized_config(self, admin_headers, client_headers, reassign_to_client):
        r = requests.get(f"{API}/water-quality/latest", headers=client_headers)
        assert r.status_code == 200
        do_items = r.json().get("do") or []
        rec = self._find(do_items, DO_HW)
        assert rec is not None, "reassigned DO device missing from client /latest"
        cfg = (rec.get("_registry") or {}).get("do_tank_config") or {}
        assert cfg.get("tank_1_kld") == 250
        assert cfg.get("tank_2_kld") == 180
        assert "updated_by" not in cfg, f"client should NOT see updated_by: {cfg}"
        assert "updated_at" not in cfg, f"client should NOT see updated_at: {cfg}"


# --------------------------------------------------------------------------- STP config: param_ranges + dummy_auto_push

class TestStpConfigParamRanges:

    RANGES_PAYLOAD = {
        "param_ranges": {
            "COD": {"min": 30, "max": 250},
            "BOD": {"min": 5,  "max": 30},
            "TSS": {"min": 10, "max": 100},
            "PH":  {"min": 6.5, "max": 8.5},
        },
        "dummy_auto_push": {"enabled": True, "interval_seconds": 86400},
    }

    def test_admin_can_save_ranges_and_toggle_on(self, admin_headers):
        r = requests.put(f"{API}/water-quality/{STP_HW}/stp-config",
                          headers=admin_headers,
                          json=self.RANGES_PAYLOAD)
        assert r.status_code == 200, r.text
        body = r.json()
        cfg = body.get("stp_unit_config") or {}
        pr = cfg.get("param_ranges") or {}
        assert pr.get("COD") == {"min": 30, "max": 250}
        assert pr.get("BOD") == {"min": 5,  "max": 30}
        assert pr.get("TSS") == {"min": 10, "max": 100}
        assert pr.get("PH") == {"min": 6.5, "max": 8.5}
        dap = cfg.get("dummy_auto_push") or {}
        assert dap.get("enabled") is True
        assert dap.get("interval_seconds") == 86400

    def test_registry_dummy_config_synced_on(self, admin_headers):
        # After saving with enabled=True the registry's dummy_config should reflect it.
        r = requests.get(f"{API}/instrument-registry/{STP_HW}/dummy", headers=admin_headers)
        assert r.status_code == 200, r.text
        dcfg = (r.json() or {}).get("dummy_config") or {}
        assert dcfg.get("enabled") is True
        assert dcfg.get("auto_from_stp_cfg") is True
        assert dcfg.get("interval_seconds") == 86400
        # min = 5 (lowest — BOD.min), max = 250 (highest — COD.max)
        assert float(dcfg.get("min_value")) == 5.0
        assert float(dcfg.get("max_value")) == 250.0

    def test_toggle_off_flips_dummy_config_off(self, admin_headers):
        payload = {**self.RANGES_PAYLOAD,
                   "dummy_auto_push": {"enabled": False, "interval_seconds": 86400}}
        r = requests.put(f"{API}/water-quality/{STP_HW}/stp-config",
                          headers=admin_headers,
                          json=payload)
        assert r.status_code == 200, r.text
        # Registry dummy_config.enabled should now be False (auto_from_stp_cfg was True)
        r2 = requests.get(f"{API}/instrument-registry/{STP_HW}/dummy", headers=admin_headers)
        assert r2.status_code == 200
        dcfg = (r2.json() or {}).get("dummy_config") or {}
        assert dcfg.get("enabled") is False, f"expected disabled; got {dcfg}"

        # Re-enable for downstream tests / preserved state
        requests.put(f"{API}/water-quality/{STP_HW}/stp-config",
                     headers=admin_headers,
                     json=self.RANGES_PAYLOAD)

    def test_client_forbidden(self, client_headers):
        r = requests.put(f"{API}/water-quality/{STP_HW}/stp-config",
                          headers=client_headers,
                          json=self.RANGES_PAYLOAD)
        assert r.status_code == 403


# --------------------------------------------------------------------------- Dummy generator respects param_ranges

class TestDummyGeneratorRespectsRanges:
    """Programmatically invoke _generate_wq_stp with a param_ranges'd registry
    and confirm 5 consecutive readings stay inside the bands and vary."""

    def test_five_readings_within_bands(self):
        # Import inside test so path insert above has taken effect.
        from dummy_data_service import _generate_wq_stp
        from motor.motor_asyncio import AsyncIOMotorClient

        mongo_url = os.environ["MONGO_URL"]
        db_name = os.environ["DB_NAME"]
        # Use a throw-away hardware_id so we don't touch real data.
        fake_hw = "TEST_DUMMY_STP_ITER6"
        reg = {
            "hardware_id": fake_hw,
            "instrument_type": "wq_stp",
            "imei": "TESTIMEI",
            "stp_unit_config": {
                "param_ranges": {
                    "COD": {"min": 30, "max": 250},
                    "BOD": {"min": 5,  "max": 30},
                    "TSS": {"min": 10, "max": 100},
                    "PH":  {"min": 6.5, "max": 8.5},
                }
            },
        }
        cfg = {"min_value": 0, "max_value": 500}

        async def _run():
            client = AsyncIOMotorClient(mongo_url)
            db = client[db_name]
            try:
                # Wipe any prior test data
                await db.instrument_latest.delete_many({"hardware_id": fake_hw})
                await db.instrument_readings.delete_many({"hardware_id": fake_hw})
                out = []
                for _ in range(5):
                    r = await _generate_wq_stp(db, reg, cfg)
                    out.append(r["values"])
                # cleanup
                await db.instrument_latest.delete_many({"hardware_id": fake_hw})
                await db.instrument_readings.delete_many({"hardware_id": fake_hw})
                return out
            finally:
                client.close()

        readings = asyncio.get_event_loop().run_until_complete(_run()) if False else asyncio.new_event_loop().run_until_complete(_run())

        assert len(readings) == 5
        cods = [float(r["COD"]) for r in readings]
        bods = [float(r["BOD"]) for r in readings]
        tsss = [float(r["TSS"]) for r in readings]
        phs  = [float(r["PH"])  for r in readings]

        for v in cods: assert 30.0 <= v <= 250.0, f"COD out of range: {v}"
        for v in bods: assert  5.0 <= v <=  30.0, f"BOD out of range: {v}"
        for v in tsss: assert 10.0 <= v <= 100.0, f"TSS out of range: {v}"
        for v in phs:  assert 6.5  <= v <=  8.5,  f"PH out of range: {v}"

        # Variation check — no two consecutive readings should ever be identical
        # across ALL four params. At minimum the set of unique COD values > 1.
        assert len(set(cods)) > 1, f"COD values constant across 5 reads: {cods}"


# --------------------------------------------------------------------------- Ownership restore safety net

def test_restore_ownership_before_exit(admin_headers):
    """Ensure ownership is reverted to default owner even if a prior test
    aborted midway. Runs last alphabetically inside the file (Test... vs test_)"""
    for hw in (DO_HW, STP_HW):
        r = requests.put(f"{API}/instrument-registry/{hw}",
                          headers=admin_headers,
                          json={"owner_user_id": DEFAULT_OWNER_USER_ID})
        assert r.status_code == 200
