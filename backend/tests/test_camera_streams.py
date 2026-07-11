"""Camera Streams API — regression tests for the Live Video widget feature.

Covers:
  * POST /api/camera-streams (auto-detect stream_type, upsert on hardware_id, admin-only)
  * GET  /api/camera-streams/by-device/{hw} (null when absent, 403 for non-owner client)
  * PUT  /api/camera-streams/{hw} (admin update; type re-detected)
  * DELETE /api/camera-streams/{hw} (admin-only)
  * GET  /api/camera-streams (admin sees all, client sees only owned)
  * GET  /api/water-quality/latest returns placeholder for registered do_meter with no readings.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://envirolytics-hub.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@envirolytics.com"
ADMIN_PASSWORD = "Admin@Envirolytics2026"

DO_TEST_HW = "DO_TEST_001"  # primary demo device — do NOT delete


# ---------------- Fixtures ----------------

@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="module")
def admin_headers(s):
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def client_ctx(s, admin_headers):
    """Create a fresh client user + a do_meter owned by them."""
    email = f"TEST_cam_{uuid.uuid4().hex[:6]}@envirolytics.com"
    r = s.post(
        f"{API}/admin/users/create",
        headers=admin_headers,
        json={
            "email": email, "password": "ClientPass123", "full_name": "TEST Cam",
            "role": "client",
            # grant water-quality view so /water-quality/latest doesn't 403
            "permissions": ["view_water_quality"],
        },
    )
    assert r.status_code == 200, r.text
    uid = r.json()["user"]["id"]

    # give the WQ permission explicitly (in case create doesn't set it)
    s.put(f"{API}/water-quality/permissions/{uid}", headers=admin_headers,
          json={"view_water_quality": True})

    hw_own = f"TEST_DOOWN_{uuid.uuid4().hex[:6]}"
    r = s.post(f"{API}/instrument-registry", headers=admin_headers, json={
        "hardware_id": hw_own,
        "instrument_type": "do_meter",
        "label": "Client-Owned DO",
        "owner_user_id": uid,
    })
    assert r.status_code == 200, r.text

    # login as the client
    lg = s.post(f"{API}/auth/login", json={"email": email, "password": "ClientPass123"})
    assert lg.status_code == 200, lg.text
    ctok = lg.json()["access_token"]
    client_hdr = {"Authorization": f"Bearer {ctok}", "Content-Type": "application/json"}

    yield {"user_id": uid, "hw_own": hw_own, "client_hdr": client_hdr}

    # Cleanup
    s.delete(f"{API}/camera-streams/{hw_own}", headers=admin_headers)
    s.delete(f"{API}/instrument-registry/{hw_own}", headers=admin_headers)
    s.delete(f"{API}/admin/users/{uid}", headers=admin_headers)


@pytest.fixture(scope="module")
def admin_id(s, admin_headers):
    r = s.get(f"{API}/auth/me", headers=admin_headers)
    assert r.status_code == 200
    return r.json()["id"]


@pytest.fixture(scope="module")
def spare_do_device(s, admin_headers, admin_id):
    """Extra DO device not owned by any client — used for admin CRUD without touching DO_TEST_001."""
    hw = f"TEST_DOSPARE_{uuid.uuid4().hex[:6]}"
    r = s.post(f"{API}/instrument-registry", headers=admin_headers, json={
        "hardware_id": hw,
        "instrument_type": "do_meter",
        "label": "Spare DO",
        "owner_user_id": admin_id,
    })
    assert r.status_code == 200, r.text
    yield hw
    # Cleanup
    s.delete(f"{API}/camera-streams/{hw}", headers=admin_headers)
    s.delete(f"{API}/instrument-registry/{hw}", headers=admin_headers)


# ---------------- POST create/upsert ----------------

class TestCreate:
    def test_requires_admin(self, s, client_ctx):
        r = s.post(f"{API}/camera-streams", headers=client_ctx["client_hdr"], json={
            "hardware_id": client_ctx["hw_own"],
            "stream_url": "https://youtube.com/watch?v=abcdef1234",
        })
        assert r.status_code == 403

    def test_youtube_url_autodetect_and_embed(self, s, admin_headers, spare_do_device):
        hw = spare_do_device
        r = s.post(f"{API}/camera-streams", headers=admin_headers, json={
            "hardware_id": hw,
            "stream_url": "https://www.youtube.com/shorts/N2kmXzYdQ50",
            "label": "YT Shorts",
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["hardware_id"] == hw
        assert body["stream_type"] == "youtube"
        assert body["embed_url"].startswith("https://www.youtube.com/embed/N2kmXzYdQ50")
        # No mongo _id leaked
        assert "_id" not in body

    def test_mp4_url_autodetect(self, s, admin_headers, spare_do_device):
        hw = spare_do_device
        r = s.post(f"{API}/camera-streams", headers=admin_headers, json={
            "hardware_id": hw,
            "stream_url": "https://cdn.example.com/live/stream.mp4",
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["stream_type"] == "mp4"
        # embed_url equals raw URL for non-YT
        assert body["embed_url"] == "https://cdn.example.com/live/stream.mp4"

    def test_upsert_on_same_hardware_id(self, s, admin_headers, spare_do_device):
        hw = spare_do_device
        first_url = "https://youtu.be/dQw4w9WgXcQ"
        s.post(f"{API}/camera-streams", headers=admin_headers, json={
            "hardware_id": hw, "stream_url": first_url,
        })
        # Second POST should update, not duplicate
        r = s.post(f"{API}/camera-streams", headers=admin_headers, json={
            "hardware_id": hw,
            "stream_url": "https://www.youtube.com/watch?v=xxxxxxxxx",
        })
        assert r.status_code == 200
        # Verify only one document exists via list endpoint
        lr = s.get(f"{API}/camera-streams", headers=admin_headers)
        assert lr.status_code == 200
        cams = [c for c in lr.json() if c["hardware_id"] == hw]
        assert len(cams) == 1
        assert "xxxxxxxxx" in cams[0]["stream_url"]

    def test_unknown_hardware_id_404(self, s, admin_headers):
        r = s.post(f"{API}/camera-streams", headers=admin_headers, json={
            "hardware_id": f"NEVER_EXISTS_{uuid.uuid4().hex[:6]}",
            "stream_url": "https://cdn.example.com/x.mp4",
        })
        assert r.status_code == 404


# ---------------- GET by-device ----------------

class TestGetByDevice:
    def test_null_when_no_camera(self, s, admin_headers, spare_do_device):
        # Ensure clean
        s.delete(f"{API}/camera-streams/{spare_do_device}", headers=admin_headers)
        r = s.get(f"{API}/camera-streams/by-device/{spare_do_device}", headers=admin_headers)
        assert r.status_code == 200
        assert r.json() is None

    def test_returns_camera_when_configured(self, s, admin_headers, spare_do_device):
        s.post(f"{API}/camera-streams", headers=admin_headers, json={
            "hardware_id": spare_do_device,
            "stream_url": "https://www.youtube.com/watch?v=aaaaaaaaa",
        })
        r = s.get(f"{API}/camera-streams/by-device/{spare_do_device}", headers=admin_headers)
        assert r.status_code == 200
        body = r.json()
        assert body["hardware_id"] == spare_do_device
        assert body["stream_type"] == "youtube"
        assert "embed_url" in body

    def test_non_owner_client_gets_403(self, s, admin_headers, client_ctx, spare_do_device):
        # spare_do_device is not owned by client_ctx user
        r = s.get(
            f"{API}/camera-streams/by-device/{spare_do_device}",
            headers=client_ctx["client_hdr"],
        )
        assert r.status_code == 403


# ---------------- PUT update ----------------

class TestUpdate:
    def test_admin_update_re_detects_type(self, s, admin_headers, spare_do_device):
        # Ensure a camera exists first
        s.post(f"{API}/camera-streams", headers=admin_headers, json={
            "hardware_id": spare_do_device,
            "stream_url": "https://cdn.example.com/a.mp4",
        })
        r = s.put(f"{API}/camera-streams/{spare_do_device}", headers=admin_headers, json={
            "stream_url": "https://www.youtube.com/watch?v=zzzzzzzzz",
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["stream_type"] == "youtube"
        assert "zzzzzzzzz" in body["stream_url"]

    def test_non_admin_forbidden(self, s, client_ctx):
        r = s.put(
            f"{API}/camera-streams/{client_ctx['hw_own']}",
            headers=client_ctx["client_hdr"],
            json={"stream_url": "https://x.com/y.mp4"},
        )
        assert r.status_code == 403

    def test_update_missing_camera_404(self, s, admin_headers):
        r = s.put(f"{API}/camera-streams/NEVER_EXISTS_XYZ", headers=admin_headers,
                  json={"stream_url": "https://x.com/y.mp4"})
        assert r.status_code == 404


# ---------------- DELETE ----------------

class TestDelete:
    def test_non_admin_forbidden(self, s, admin_headers, client_ctx):
        # Setup camera as admin for the client-owned device
        s.post(f"{API}/camera-streams", headers=admin_headers, json={
            "hardware_id": client_ctx["hw_own"],
            "stream_url": "https://cdn.example.com/x.mp4",
        })
        r = s.delete(
            f"{API}/camera-streams/{client_ctx['hw_own']}",
            headers=client_ctx["client_hdr"],
        )
        assert r.status_code == 403

    def test_admin_can_delete(self, s, admin_headers, spare_do_device):
        s.post(f"{API}/camera-streams", headers=admin_headers, json={
            "hardware_id": spare_do_device,
            "stream_url": "https://cdn.example.com/x.mp4",
        })
        r = s.delete(f"{API}/camera-streams/{spare_do_device}", headers=admin_headers)
        assert r.status_code == 200
        # Now GET returns null
        r2 = s.get(f"{API}/camera-streams/by-device/{spare_do_device}", headers=admin_headers)
        assert r2.status_code == 200
        assert r2.json() is None

    def test_delete_missing_returns_404(self, s, admin_headers):
        r = s.delete(f"{API}/camera-streams/NEVER_EXISTS_ABC", headers=admin_headers)
        assert r.status_code == 404


# ---------------- List scoping ----------------

class TestListScoping:
    def test_admin_sees_all(self, s, admin_headers, client_ctx, spare_do_device):
        # Create cameras for both client_ctx device and spare
        s.post(f"{API}/camera-streams", headers=admin_headers, json={
            "hardware_id": client_ctx["hw_own"], "stream_url": "https://y.com/a.mp4"})
        s.post(f"{API}/camera-streams", headers=admin_headers, json={
            "hardware_id": spare_do_device, "stream_url": "https://y.com/b.mp4"})

        r = s.get(f"{API}/camera-streams", headers=admin_headers)
        assert r.status_code == 200
        hw_ids = {c["hardware_id"] for c in r.json()}
        assert client_ctx["hw_own"] in hw_ids
        assert spare_do_device in hw_ids

    def test_client_sees_only_owned(self, s, admin_headers, client_ctx, spare_do_device):
        # Ensure both cameras exist
        s.post(f"{API}/camera-streams", headers=admin_headers, json={
            "hardware_id": client_ctx["hw_own"], "stream_url": "https://y.com/a.mp4"})
        s.post(f"{API}/camera-streams", headers=admin_headers, json={
            "hardware_id": spare_do_device, "stream_url": "https://y.com/b.mp4"})

        r = s.get(f"{API}/camera-streams", headers=client_ctx["client_hdr"])
        assert r.status_code == 200
        hw_ids = {c["hardware_id"] for c in r.json()}
        assert client_ctx["hw_own"] in hw_ids
        assert spare_do_device not in hw_ids


# ---------------- water-quality/latest placeholder inclusion ----------------

class TestWaterQualityLatestPlaceholder:
    def test_do_test_001_appears(self, s, admin_headers):
        r = s.get(f"{API}/water-quality/latest", headers=admin_headers)
        assert r.status_code == 200
        body = r.json()
        do_hw_ids = [d.get("hardware_id") for d in body.get("do", [])]
        assert DO_TEST_HW in do_hw_ids, f"DO_TEST_001 not found; got {do_hw_ids}"

    def test_placeholder_for_registered_but_unreported_device(self, s, admin_headers, spare_do_device):
        # spare_do_device was just registered without any ingested readings
        r = s.get(f"{API}/water-quality/latest", headers=admin_headers)
        assert r.status_code == 200
        body = r.json()
        matches = [d for d in body.get("do", []) if d.get("hardware_id") == spare_do_device]
        assert len(matches) == 1, "Registered do_meter should appear as placeholder"
        # It should have _registry meta (label)
        assert matches[0].get("_registry", {}).get("label") == "Spare DO"
