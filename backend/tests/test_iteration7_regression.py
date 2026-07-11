"""Iteration-7 full regression sweep.

Covers everything from prior iterations plus the new Dashboard/LocationMap
regression points that are backend-observable:

  * /api/water-quality/latest — presence of stp_derived / gardening_flushing /
    energy fields for admin; sanitized for client.
  * PUT/GET /api/water-quality/{hw}/stp-config — param_ranges + dummy_auto_push
    still round-trip and drive registry.dummy_config.
  * PUT /api/water-quality/{hw}/do-tank-config — admin/client/type gating.
  * POST + DELETE /api/water-quality/{hw}/aeration-video/{tank}.
  * /api/camera-streams/{hw}/upload (admin 200) + client sanitization on
    /api/camera-streams/by-device/{hw}.
  * GET /api/water-quality/{hw}/stp-config returns 403 for client.
  * /api/flowmeter-mgmt/categories reachable (drives Dashboard + WaterQuality
    STP flowmeter card).

At teardown ownership of DO_TEST_001 + STP_TEST_001 is restored to the
default owner (user_52eee1f7927c) exactly as the previous iteration.
"""
from __future__ import annotations

import io
import os
import sys
from pathlib import Path

import pytest
import requests

sys.path.insert(0, "/app/backend")

from dotenv import load_dotenv  # noqa: E402
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


def _find(items, hw):
    return next((it for it in items if it.get("hardware_id") == hw), None)


# --------------------------------------------------------------------------- Latest visibility

class TestWaterQualityLatest:

    def test_admin_sees_devices_and_registry_fields(self, admin_headers):
        r = requests.get(f"{API}/water-quality/latest", headers=admin_headers)
        assert r.status_code == 200, r.text
        body = r.json()
        stp = body.get("stp") or []
        do = body.get("do") or []
        stp_rec = _find(stp, STP_HW)
        do_rec = _find(do, DO_HW)
        assert stp_rec is not None
        assert do_rec is not None
        # STP has plant_capacity_kld and stp_unit_config (admin-only view keeps richness)
        reg = stp_rec.get("_registry") or {}
        assert reg.get("plant_capacity_kld") == 500
        # DO has do_tank_config with both tanks
        do_reg = do_rec.get("_registry") or {}
        cfg = do_reg.get("do_tank_config") or {}
        assert cfg.get("tank_1_kld") == 250
        assert cfg.get("tank_2_kld") == 180
        assert cfg.get("updated_by") == ADMIN_EMAIL
        assert cfg.get("updated_at")

    def test_client_sanitization(self, admin_headers, client_headers, reassign_to_client):
        r = requests.get(f"{API}/water-quality/latest", headers=client_headers)
        assert r.status_code == 200
        body = r.json()
        stp_rec = _find(body.get("stp") or [], STP_HW)
        do_rec = _find(body.get("do") or [], DO_HW)
        assert stp_rec is not None, "client should see reassigned STP"
        assert do_rec is not None, "client should see reassigned DO"

        stp_reg = stp_rec.get("_registry") or {}
        stp_cfg = stp_reg.get("stp_unit_config") or {}
        # gardening_flushing subkeys should be stripped for client
        gf = stp_cfg.get("gardening_flushing") or {}
        for k in ("source", "manual_kld", "linked_fm_id", "linked_flowmeter_hw_id"):
            assert k not in gf, f"gardening_flushing.{k} leaked to client: {gf}"
        # energy block stripped (or at least null-only) for client — the sanitizer
        # pops the key when it's a dict; when it's None (never configured) it may
        # remain as None which is not a data leak but does surface schema shape.
        assert stp_cfg.get("energy") in (None, {}), (
            f"stp_unit_config.energy exposed to client with data: {stp_cfg.get('energy')}"
        )
        # updated_by / updated_at stripped
        assert "updated_by" not in stp_cfg
        assert "updated_at" not in stp_cfg
        # stp_derived reduced
        derived = stp_reg.get("stp_derived") or {}
        assert set(derived.keys()).issubset({"gardening_flushing_kld_today", "energy_kwh_per_day"}), \
            f"unexpected stp_derived keys for client: {derived.keys()}"
        # aeration_videos.*_uploaded_by/_uploaded_at stripped
        av = (do_rec.get("_registry") or {}).get("aeration_videos") or {}
        for k in list(av.keys()):
            assert not k.endswith("_uploaded_by"), f"leaked {k}"
            assert not k.endswith("_uploaded_at"), f"leaked {k}"
        # do_tank_config updated_by/at stripped for client
        do_cfg = (do_rec.get("_registry") or {}).get("do_tank_config") or {}
        assert do_cfg.get("tank_1_kld") == 250
        assert do_cfg.get("tank_2_kld") == 180
        assert "updated_by" not in do_cfg
        assert "updated_at" not in do_cfg


# --------------------------------------------------------------------------- STP config

class TestStpConfig:
    PAYLOAD = {
        "param_ranges": {
            "COD": {"min": 30, "max": 250},
            "BOD": {"min": 5,  "max": 30},
            "TSS": {"min": 10, "max": 100},
            "PH":  {"min": 6.5, "max": 8.5},
        },
        "dummy_auto_push": {"enabled": True, "interval_seconds": 86400},
    }

    def test_put_saves_param_ranges_and_toggles_dummy_on(self, admin_headers):
        r = requests.put(f"{API}/water-quality/{STP_HW}/stp-config",
                         headers=admin_headers, json=self.PAYLOAD)
        assert r.status_code == 200, r.text
        cfg = (r.json() or {}).get("stp_unit_config") or {}
        assert (cfg.get("param_ranges") or {}).get("COD") == {"min": 30, "max": 250}
        assert (cfg.get("dummy_auto_push") or {}).get("enabled") is True
        # registry dummy_config synced
        r2 = requests.get(f"{API}/instrument-registry/{STP_HW}/dummy", headers=admin_headers)
        assert r2.status_code == 200, r2.text
        dcfg = (r2.json() or {}).get("dummy_config") or {}
        assert dcfg.get("enabled") is True
        assert dcfg.get("auto_from_stp_cfg") is True

    def test_toggle_off_flips_registry_off(self, admin_headers):
        off = {**self.PAYLOAD,
               "dummy_auto_push": {"enabled": False, "interval_seconds": 86400}}
        r = requests.put(f"{API}/water-quality/{STP_HW}/stp-config",
                         headers=admin_headers, json=off)
        assert r.status_code == 200
        d = requests.get(f"{API}/instrument-registry/{STP_HW}/dummy",
                         headers=admin_headers).json()
        assert (d.get("dummy_config") or {}).get("enabled") is False
        # Re-enable
        requests.put(f"{API}/water-quality/{STP_HW}/stp-config",
                     headers=admin_headers, json=self.PAYLOAD)

    def test_client_get_stp_config_403(self, client_headers):
        r = requests.get(f"{API}/water-quality/{STP_HW}/stp-config",
                         headers=client_headers)
        assert r.status_code == 403

    def test_client_put_stp_config_403(self, client_headers):
        r = requests.put(f"{API}/water-quality/{STP_HW}/stp-config",
                         headers=client_headers, json=self.PAYLOAD)
        assert r.status_code == 403


# --------------------------------------------------------------------------- DO tank config

class TestDoTankConfig:
    def test_admin_saves_ok(self, admin_headers):
        r = requests.put(f"{API}/water-quality/{DO_HW}/do-tank-config",
                         headers=admin_headers,
                         json={"tank_1_kld": 250, "tank_2_kld": 180})
        assert r.status_code == 200
        cfg = (r.json() or {}).get("do_tank_config") or {}
        assert cfg.get("tank_1_kld") == 250
        assert cfg.get("tank_2_kld") == 180

    def test_stp_type_400(self, admin_headers):
        r = requests.put(f"{API}/water-quality/{STP_HW}/do-tank-config",
                         headers=admin_headers,
                         json={"tank_1_kld": 100, "tank_2_kld": 100})
        assert r.status_code == 400

    def test_client_403(self, client_headers):
        r = requests.put(f"{API}/water-quality/{DO_HW}/do-tank-config",
                         headers=client_headers,
                         json={"tank_1_kld": 999, "tank_2_kld": 999})
        assert r.status_code == 403


# --------------------------------------------------------------------------- Aeration video upload/delete

class TestAerationVideo:
    def _tiny_mp4_bytes(self) -> bytes:
        # 1-KB placeholder — endpoint only validates content-type + size cap.
        return b"\x00\x00\x00\x18ftypmp42" + os.urandom(1000)

    def test_upload_and_delete_tank_1(self, admin_headers):
        payload = self._tiny_mp4_bytes()
        files = {"file": ("test_aeration.mp4", io.BytesIO(payload), "video/mp4")}
        r = requests.post(f"{API}/water-quality/{DO_HW}/aeration-video/1",
                          headers=admin_headers, files=files)
        # Endpoint may return 200 or 201
        assert r.status_code in (200, 201), r.text
        body = r.json()
        # Registry should now expose aeration_videos.tank_1
        latest = requests.get(f"{API}/water-quality/latest",
                              headers=admin_headers).json()
        rec = _find(latest.get("do") or [], DO_HW)
        av = (rec.get("_registry") or {}).get("aeration_videos") or {}
        assert av.get("tank_1"), f"tank_1 not populated: {av}"

        # DELETE
        r2 = requests.delete(f"{API}/water-quality/{DO_HW}/aeration-video/1",
                             headers=admin_headers)
        assert r2.status_code in (200, 204), r2.text
        latest2 = requests.get(f"{API}/water-quality/latest",
                               headers=admin_headers).json()
        rec2 = _find(latest2.get("do") or [], DO_HW)
        av2 = (rec2.get("_registry") or {}).get("aeration_videos") or {}
        assert not av2.get("tank_1"), f"tank_1 still set after delete: {av2}"


# --------------------------------------------------------------------------- Camera streams: upload + client sanitization

class TestCameraStreams:
    HW = STP_HW  # any real device with a stream config; STP works too

    def test_admin_upload_returns_200(self, admin_headers):
        # Endpoint accepts only video extensions (m4v/mov/mp4/webm) — it stores
        # a short "snapshot" clip for the operator UI.
        mp4 = b"\x00\x00\x00\x18ftypmp42" + os.urandom(800)
        files = {"file": ("snap.mp4", io.BytesIO(mp4), "video/mp4")}
        r = requests.post(f"{API}/camera-streams/{self.HW}/upload",
                          headers=admin_headers, files=files)
        if r.status_code == 404:
            pytest.skip("no camera stream configured for device — smoke skipped")
        assert r.status_code in (200, 201), r.text

    def test_client_sanitized_by_device(self, admin_headers, client_headers, reassign_to_client):
        r = requests.get(f"{API}/camera-streams/by-device/{self.HW}",
                         headers=client_headers)
        if r.status_code == 404:
            pytest.skip("no camera stream for reassigned device — skipping sanitization check")
        assert r.status_code == 200, r.text
        body = r.json()
        # A missing stream returns null body — treat as pass, nothing to leak.
        if body is None:
            pytest.skip("stream is null for reassigned device — no fields to check")
        forbidden = ("integration_config", "created_by", "updated_by",
                     "uploaded_by", "uploaded_at")
        for k in forbidden:
            assert k not in body, f"client should not see {k}: {body}"


# --------------------------------------------------------------------------- Flowmeter categories reachable

class TestFlowmeterCategories:
    def test_admin_get_categories(self, admin_headers):
        r = requests.get(f"{API}/flowmeter-mgmt/categories", headers=admin_headers)
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body.get("categories") or body.get("items") or [], list)


# --------------------------------------------------------------------------- Ownership restore

def test_zzz_restore_ownership(admin_headers):
    for hw in (DO_HW, STP_HW):
        r = requests.put(f"{API}/instrument-registry/{hw}",
                         headers=admin_headers,
                         json={"owner_user_id": DEFAULT_OWNER_USER_ID})
        assert r.status_code == 200
