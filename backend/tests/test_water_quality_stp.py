"""End-to-end tests for STP unit-config and aeration-video upload feature.

Covers:
  * PUT/GET /api/water-quality/{hw}/stp-config (admin write, non-admin 403)
  * Bad flowmeter linkage → 404
  * POST/DELETE /api/water-quality/{hw}/aeration-video/{tank}
  * StaticFiles /api/uploads/aeration/<filename>
  * GET /api/water-quality/latest exposes stp_unit_config / aeration_videos / stp_derived
  * Energy computation correctness (350.2 kWh/day)
  * Gardening manual source (45 KLD)
"""
import os
import time
import uuid
from pathlib import Path

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://envirolytics-hub.preview.emergentagent.com").rstrip("/")

ADMIN_EMAIL = "admin@envirolytics.com"
ADMIN_PASSWORD = "Admin@Envirolytics2026"
STP_HW = "STP_TEST_001"
DO_HW = "DO_TEST_001"

SAMPLE_MP4 = Path("/app/frontend/public/aeration.mp4")


# ─── fixtures ───────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_client(admin_token):
    s = requests.Session()
    s.headers.update({
        "Authorization": f"Bearer {admin_token}",
        "Content-Type": "application/json",
    })
    return s


@pytest.fixture(scope="session")
def client_user(admin_client):
    """Create an ephemeral non-admin client user for 403 checks."""
    email = f"TEST_stpguard_{uuid.uuid4().hex[:6]}@envirolytics.com"
    pw = "ClientPass123"
    r = admin_client.post(
        f"{BASE_URL}/api/admin/users/create",
        json={
            "email": email,
            "password": pw,
            "full_name": "STP Guard Test",
            "role": "client",
        },
    )
    assert r.status_code in (200, 201), f"Client register failed: {r.status_code} {r.text}"
    user_id = r.json().get("user", {}).get("id") or r.json().get("id")

    # login as this client
    lr = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": email, "password": pw},
        timeout=15,
    )
    assert lr.status_code == 200, f"Client login failed: {lr.text}"
    token = lr.json()["access_token"]

    yield {"email": email, "password": pw, "id": user_id, "token": token}

    # teardown
    if user_id:
        admin_client.delete(f"{BASE_URL}/api/admin/users/{user_id}")


@pytest.fixture(scope="session")
def client_session(client_user):
    s = requests.Session()
    s.headers.update({
        "Authorization": f"Bearer {client_user['token']}",
        "Content-Type": "application/json",
    })
    return s


# ─── STP CONFIG PUT / GET ───────────────────────────────────────────────

SEED_CFG = {
    "equalization_tank_kld": 100.0,
    "aeration_tank_kld": 250.0,
    "settling_tank_kld": 100.0,
    "filter_feed_tank_kld": 75.0,
    "treated_water_tank_kld": 200.0,
    "air_blowers": [
        {"label": "Air Blower - 1", "capacity_m3ph": 120.0, "power_kw": 7.5, "running_hours_per_day": 16.0},
        {"label": "Air Blower - 2", "capacity_m3ph": 120.0, "power_kw": 7.5, "running_hours_per_day": 16.0},
        {"label": "Air Blower - 3", "capacity_m3ph": 120.0, "power_kw": 7.5, "running_hours_per_day": 8.0},
    ],
    "filter_feed_pump": {"capacity_kld": 300.0, "power_kw": 3.7, "running_hours_per_day": 10.0},
    "gardening_flushing": {
        "source": "manual",
        "linked_flowmeter_hw_id": None,
        "manual_kld_per_day": 45.0,
        "pump_power_kw": 2.2,
        "running_hours_per_day": 6.0,
    },
    "energy": {"mode": "auto", "manual_kwh_per_day": None},
}


class TestSTPConfig:

    def test_admin_put_stp_config_returns_derived(self, admin_client):
        r = admin_client.put(
            f"{BASE_URL}/api/water-quality/{STP_HW}/stp-config",
            json=SEED_CFG,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["success"] is True
        assert body["stp_unit_config"]["aeration_tank_kld"] == 250.0
        derived = body["stp_derived"]
        assert derived["energy_mode"] == "auto"
        # 3 blowers (120+120+60) + FFP 37 + gardening pump 13.2 = 350.2
        assert derived["energy_kwh_per_day"] == 350.2, f"expected 350.2, got {derived['energy_kwh_per_day']}"
        assert derived["gardening_flushing_kld_today"] == 45.0
        # Breakdown must include the five loads
        labels = [b["label"] for b in derived["energy_breakdown"]]
        assert "Filter Feed Pump" in labels
        assert "Gardening Pump" in labels
        assert sum(1 for lb in labels if "Blower" in lb) == 3

    def test_admin_get_stp_config_recomputes(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/water-quality/{STP_HW}/stp-config")
        assert r.status_code == 200
        body = r.json()
        assert body["hardware_id"] == STP_HW
        assert body["plant_capacity_kld"] == 500.0
        assert body["stp_derived"]["energy_kwh_per_day"] == 350.2
        assert body["stp_derived"]["gardening_flushing_kld_today"] == 45.0

    def test_client_put_stp_config_forbidden(self, client_session):
        r = client_session.put(
            f"{BASE_URL}/api/water-quality/{STP_HW}/stp-config",
            json=SEED_CFG,
        )
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"

    def test_put_stp_config_bad_flowmeter_linkage(self, admin_client):
        bad = dict(SEED_CFG)
        bad["gardening_flushing"] = {
            "source": "flowmeter",
            "linked_flowmeter_hw_id": f"FM_DOES_NOT_EXIST_{uuid.uuid4().hex[:6]}",
        }
        r = admin_client.put(
            f"{BASE_URL}/api/water-quality/{STP_HW}/stp-config",
            json=bad,
        )
        assert r.status_code == 404, f"expected 404, got {r.status_code}: {r.text}"

        # Restore seed cfg so subsequent tests find 350.2
        rr = admin_client.put(
            f"{BASE_URL}/api/water-quality/{STP_HW}/stp-config",
            json=SEED_CFG,
        )
        assert rr.status_code == 200

    def test_energy_manual_mode_override(self, admin_client):
        cfg = dict(SEED_CFG)
        cfg["energy"] = {"mode": "manual", "manual_kwh_per_day": 275.5}
        r = admin_client.put(f"{BASE_URL}/api/water-quality/{STP_HW}/stp-config", json=cfg)
        assert r.status_code == 200
        derived = r.json()["stp_derived"]
        assert derived["energy_mode"] == "manual"
        assert derived["energy_kwh_per_day"] == 275.5

        # restore
        admin_client.put(f"{BASE_URL}/api/water-quality/{STP_HW}/stp-config", json=SEED_CFG)


# ─── Aeration video upload/delete/serve ─────────────────────────────────

class TestAerationVideoUpload:

    _uploaded_urls = {}

    def test_sample_mp4_exists(self):
        assert SAMPLE_MP4.exists(), f"Sample MP4 missing at {SAMPLE_MP4}"

    def test_upload_tank1_admin(self, admin_token):
        with SAMPLE_MP4.open("rb") as f:
            r = requests.post(
                f"{BASE_URL}/api/water-quality/{DO_HW}/aeration-video/1",
                headers={"Authorization": f"Bearer {admin_token}"},
                files={"file": ("aeration.mp4", f, "video/mp4")},
                timeout=60,
            )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        body = r.json()
        assert body["success"] is True
        assert body["tank_number"] == 1
        assert body["url"].startswith("/api/uploads/aeration/")
        assert body["bytes"] > 0
        TestAerationVideoUpload._uploaded_urls[1] = body["url"]

    def test_upload_tank2_admin(self, admin_token):
        with SAMPLE_MP4.open("rb") as f:
            r = requests.post(
                f"{BASE_URL}/api/water-quality/{DO_HW}/aeration-video/2",
                headers={"Authorization": f"Bearer {admin_token}"},
                files={"file": ("aeration.mp4", f, "video/mp4")},
                timeout=60,
            )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        body = r.json()
        assert body["tank_number"] == 2
        assert body["url"].startswith("/api/uploads/aeration/")
        TestAerationVideoUpload._uploaded_urls[2] = body["url"]

    def test_upload_invalid_tank_number(self, admin_token):
        with SAMPLE_MP4.open("rb") as f:
            r = requests.post(
                f"{BASE_URL}/api/water-quality/{DO_HW}/aeration-video/3",
                headers={"Authorization": f"Bearer {admin_token}"},
                files={"file": ("aeration.mp4", f, "video/mp4")},
            )
        assert r.status_code == 400
        assert "1 or 2" in r.text

    def test_upload_bad_extension(self, admin_token):
        r = requests.post(
            f"{BASE_URL}/api/water-quality/{DO_HW}/aeration-video/1",
            headers={"Authorization": f"Bearer {admin_token}"},
            files={"file": ("junk.txt", b"hello", "text/plain")},
        )
        assert r.status_code == 400
        assert "extension" in r.text.lower()

    def test_upload_non_admin_forbidden(self, client_user):
        with SAMPLE_MP4.open("rb") as f:
            r = requests.post(
                f"{BASE_URL}/api/water-quality/{DO_HW}/aeration-video/1",
                headers={"Authorization": f"Bearer {client_user['token']}"},
                files={"file": ("aeration.mp4", f, "video/mp4")},
            )
        assert r.status_code == 403, f"{r.status_code} {r.text}"

    def test_streamed_url_returns_video_bytes(self, admin_token):
        url = TestAerationVideoUpload._uploaded_urls.get(1)
        assert url, "prior upload test must have populated URL"
        full = f"{BASE_URL}{url}"
        r = requests.get(full, timeout=30)
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        # correct content-length
        assert int(r.headers.get("content-length", 0)) == len(r.content) > 0
        assert r.headers.get("content-type", "").startswith("video/") or r.headers.get("content-type", "").startswith("application/")

    def test_latest_exposes_registry_fields(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/water-quality/latest")
        assert r.status_code == 200
        body = r.json()
        stp = next((x for x in body["stp"] if x.get("hardware_id") == STP_HW), None)
        do = next((x for x in body["do"] if x.get("hardware_id") == DO_HW), None)
        assert stp is not None, "STP_TEST_001 must appear in /latest"
        assert do is not None, "DO_TEST_001 must appear in /latest"
        # STP registry payload
        reg = stp.get("_registry") or {}
        assert reg.get("stp_unit_config", {}).get("aeration_tank_kld") == 250.0
        assert reg.get("stp_derived", {}).get("energy_kwh_per_day") == 350.2
        # DO registry payload — aeration_videos should be present after upload
        do_reg = do.get("_registry") or {}
        avids = do_reg.get("aeration_videos") or {}
        assert avids.get("tank_1", "").startswith("/api/uploads/aeration/")
        assert avids.get("tank_2", "").startswith("/api/uploads/aeration/")

    def test_delete_tank1_admin(self, admin_client):
        r = admin_client.delete(f"{BASE_URL}/api/water-quality/{DO_HW}/aeration-video/1")
        assert r.status_code == 200
        assert r.json()["tank_number"] == 1

        # confirm cleared from registry
        r2 = admin_client.get(f"{BASE_URL}/api/water-quality/latest")
        do = next((x for x in r2.json()["do"] if x.get("hardware_id") == DO_HW), None)
        avids = (do.get("_registry") or {}).get("aeration_videos") or {}
        assert avids.get("tank_1") is None, f"tank_1 should be unset, got {avids}"

    def test_delete_idempotent(self, admin_client):
        # deleting again should still return 200 (no-op)
        r = admin_client.delete(f"{BASE_URL}/api/water-quality/{DO_HW}/aeration-video/1")
        assert r.status_code == 200

    def test_delete_tank2_cleanup(self, admin_client):
        r = admin_client.delete(f"{BASE_URL}/api/water-quality/{DO_HW}/aeration-video/2")
        assert r.status_code == 200
