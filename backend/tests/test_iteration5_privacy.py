"""Iteration-5 tests — client-safe sanitization + camera MP4 upload + integration_config.

Covers:
  * /api/water-quality/latest strips admin-only fields for clients (stp_unit_config.gardening_flushing.source,
    manual_kld_per_day, linked_flowmeter_hw_id, energy.*, updated_by/at, aeration_videos.tank_N_uploaded_*).
    Admin sees them.
  * /api/water-quality/{hw}/stp-config is admin-only (403 for clients).
  * /api/camera-streams/by-device/{hw} strips integration_config/created_by/updated_by/uploaded_by/uploaded_at
    for clients but retains them for admin.
  * POST /api/camera-streams/{hw}/upload — admin only, .txt returns 400, valid mp4 returns success/url/bytes.
  * Uploaded file is retrievable at /api/uploads/camera/<file> (200 + content-length).
  * PUT /api/camera-streams/{hw} accepts integration_config with all fields.

Uses existing STP_TEST_001 + DO_TEST_001 devices. Reassigns ownership to
`user_dd92c46509ff` (testclient) for the client-scope tests, then restores
ownership to `user_52eee1f7927c` in fixture teardown so the main preview
continues to render them for the admin.
"""
import io
import os
import struct
import zlib
import pytest
import requests

def _load_backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    # Fallback: read frontend/.env directly
    env_path = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", ".env")
    try:
        with open(env_path) as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().rstrip("/")
    except OSError:
        pass
    raise RuntimeError("REACT_APP_BACKEND_URL not found")


BASE_URL = _load_backend_url()
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@envirolytics.com"
ADMIN_PASSWORD = "Admin@Envirolytics2026"

CLIENT_EMAIL = "testclient@envirolytics.com"
CLIENT_PASSWORD = "Client@Test2026"
CLIENT_UID = "user_dd92c46509ff"
ORIG_OWNER_UID = "user_52eee1f7927c"

STP_HW = "STP_TEST_001"
DO_HW = "DO_TEST_001"


def _mini_mp4() -> bytes:
    """A syntactically-valid but minimal ISO BMFF box header (won't play but
    passes extension check + size checks). Backend only validates ext + size."""
    # ftyp box: [size][type][major_brand][minor_ver][compat...]
    ftyp = b"\x00\x00\x00\x20ftypisom\x00\x00\x02\x00isomiso2avc1mp41"
    mdat = b"\x00\x00\x00\x10mdat" + (b"\x00" * 8)
    return ftyp + mdat


# ---------------- Fixtures ----------------

@pytest.fixture(scope="module")
def sess():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_hdr(sess):
    r = sess.post(f"{API}/auth/login",
                  json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}",
            "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def client_hdr(sess):
    r = sess.post(f"{API}/auth/login",
                  json={"email": CLIENT_EMAIL, "password": CLIENT_PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}",
            "Content-Type": "application/json"}


@pytest.fixture(scope="module", autouse=True)
def reassign_ownership(sess, admin_hdr):
    """Reassign STP_TEST_001 + DO_TEST_001 to the test client for the run;
    restore to `user_52eee1f7927c` in teardown."""
    for hw in (STP_HW, DO_HW):
        r = sess.put(f"{API}/instrument-registry/{hw}", headers=admin_hdr,
                     json={"owner_user_id": CLIENT_UID})
        assert r.status_code == 200, f"reassign {hw} to client failed: {r.text}"
    yield
    for hw in (STP_HW, DO_HW):
        sess.put(f"{API}/instrument-registry/{hw}", headers=admin_hdr,
                 json={"owner_user_id": ORIG_OWNER_UID})


# ---------------- 1. /water-quality/latest sanitization ----------------

class TestLatestSanitization:
    def _find_reg(self, body, hw, kind):
        for r in body.get(kind, []):
            if r.get("hardware_id") == hw:
                return r.get("_registry") or {}
        return None

    def test_admin_sees_full_stp_config_and_energy_mode(self, sess, admin_hdr):
        r = sess.get(f"{API}/water-quality/latest", headers=admin_hdr)
        assert r.status_code == 200, r.text
        reg = self._find_reg(r.json(), STP_HW, "stp")
        assert reg is not None, "admin should see STP_TEST_001 in /latest"
        cfg = reg.get("stp_unit_config") or {}
        # admin bookkeeping present
        assert "updated_by" in cfg, "admin must see updated_by"
        assert "updated_at" in cfg, "admin must see updated_at"
        # gardening_flushing.source visible to admin
        gf = cfg.get("gardening_flushing") or {}
        assert "source" in gf, "admin must see gardening_flushing.source"
        # energy block visible to admin
        assert "energy" in cfg, "admin must see energy block"
        # stp_derived carries energy_mode + energy_breakdown for admin
        d = reg.get("stp_derived") or {}
        assert "energy_mode" in d
        assert "energy_breakdown" in d
        assert d.get("energy_kwh_per_day") is not None

    def test_admin_sees_aeration_uploaded_by_at(self, sess, admin_hdr):
        # Only meaningful if there is currently a tank_1 uploaded video; the
        # main-agent context guarantees at least one exists at start-of-run.
        r = sess.get(f"{API}/water-quality/latest", headers=admin_hdr)
        assert r.status_code == 200
        reg = self._find_reg(r.json(), DO_HW, "do") or {}
        av = reg.get("aeration_videos") or {}
        # We're only asserting the *keys are permitted* for admin — main agent
        # said the previous run left aeration_videos possibly clean, so this
        # test is soft: if tank_1 present, uploaded_at must also be present.
        if av.get("tank_1"):
            assert "tank_1_uploaded_at" in av, "admin must see tank_1_uploaded_at"
            assert "tank_1_uploaded_by" in av, "admin must see tank_1_uploaded_by"

    def test_client_stp_config_stripped(self, sess, client_hdr):
        r = sess.get(f"{API}/water-quality/latest", headers=client_hdr)
        assert r.status_code == 200, r.text
        reg = self._find_reg(r.json(), STP_HW, "stp")
        assert reg is not None, "client should see reassigned STP_TEST_001"
        cfg = reg.get("stp_unit_config") or {}
        # NO admin bookkeeping
        assert "updated_by" not in cfg
        assert "updated_at" not in cfg
        # NO energy block (any)
        assert "energy" not in cfg, f"energy leaked to client: {cfg.get('energy')}"
        # gardening_flushing must not contain source / manual_kld / linked_hw
        gf = cfg.get("gardening_flushing") or {}
        assert "source" not in gf
        assert "manual_kld_per_day" not in gf
        assert "linked_flowmeter_hw_id" not in gf

    def test_client_stp_derived_minimal(self, sess, client_hdr):
        r = sess.get(f"{API}/water-quality/latest", headers=client_hdr)
        reg = self._find_reg(r.json(), STP_HW, "stp") or {}
        d = reg.get("stp_derived") or {}
        # only two keys expected
        assert set(d.keys()) == {"gardening_flushing_kld_today", "energy_kwh_per_day"}, (
            f"stp_derived leaked keys to client: {list(d.keys())}"
        )

    def test_client_aeration_uploaded_meta_stripped(self, sess, client_hdr):
        r = sess.get(f"{API}/water-quality/latest", headers=client_hdr)
        reg = self._find_reg(r.json(), DO_HW, "do") or {}
        av = reg.get("aeration_videos") or {}
        leaked = [k for k in av.keys() if k.endswith("_uploaded_at") or k.endswith("_uploaded_by")]
        assert leaked == [], f"upload metadata leaked to client: {leaked}"


# ---------------- 2. GET /stp-config admin-only ----------------

class TestStpConfigAdminOnly:
    def test_client_forbidden(self, sess, client_hdr):
        r = sess.get(f"{API}/water-quality/{STP_HW}/stp-config", headers=client_hdr)
        assert r.status_code == 403, f"expected 403, got {r.status_code} — {r.text[:200]}"

    def test_admin_ok(self, sess, admin_hdr):
        r = sess.get(f"{API}/water-quality/{STP_HW}/stp-config", headers=admin_hdr)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("hardware_id") == STP_HW
        assert "stp_unit_config" in body
        assert "stp_derived" in body


# ---------------- 3. Camera streams: admin fields hidden from client ----------------

class TestCameraStreamClientView:
    def test_client_gets_stream_without_admin_fields(self, sess, client_hdr):
        r = sess.get(f"{API}/camera-streams/by-device/{DO_HW}", headers=client_hdr)
        assert r.status_code == 200, r.text
        body = r.json()
        if body is None:
            pytest.skip("No camera configured on DO_TEST_001 at test time")
        for admin_only in ("integration_config", "created_by", "updated_by",
                            "uploaded_by", "uploaded_at"):
            assert admin_only not in body, f"{admin_only} leaked to client: {body}"

    def test_admin_gets_full_stream(self, sess, admin_hdr):
        r = sess.get(f"{API}/camera-streams/by-device/{DO_HW}", headers=admin_hdr)
        assert r.status_code == 200
        body = r.json()
        if body is None:
            pytest.skip("No camera configured on DO_TEST_001")
        # At least one admin bookkeeping field should be present
        admin_keys = {"integration_config", "created_by", "updated_by",
                       "uploaded_by", "uploaded_at"}
        assert admin_keys & set(body.keys()), (
            f"admin view missing all bookkeeping keys: {list(body.keys())}"
        )


# ---------------- 4. POST camera upload ----------------

class TestCameraUpload:
    def test_client_forbidden(self, client_hdr):
        files = {"file": ("aeration.mp4", _mini_mp4(), "video/mp4")}
        r = requests.post(f"{API}/camera-streams/{DO_HW}/upload",
                          headers={"Authorization": client_hdr["Authorization"]},
                          files=files)
        assert r.status_code == 403

    def test_bad_extension_400(self, admin_hdr):
        files = {"file": ("evil.txt", b"not a video", "text/plain")}
        r = requests.post(f"{API}/camera-streams/{DO_HW}/upload",
                          headers={"Authorization": admin_hdr["Authorization"]},
                          files=files)
        assert r.status_code == 400, r.text
        assert "extension" in r.text.lower() or "unsupported" in r.text.lower()

    def test_admin_upload_success(self, admin_hdr, sess):
        payload = _mini_mp4()
        files = {"file": ("aeration.mp4", payload, "video/mp4")}
        r = requests.post(f"{API}/camera-streams/{DO_HW}/upload",
                          headers={"Authorization": admin_hdr["Authorization"]},
                          files=files)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("success") is True
        assert body.get("bytes") == len(payload)
        url = body.get("url", "")
        assert url.startswith("/api/uploads/camera/"), url

        # Subsequent GET reflects upload
        r2 = sess.get(f"{API}/camera-streams/by-device/{DO_HW}", headers=admin_hdr)
        assert r2.status_code == 200
        b2 = r2.json()
        assert b2["stream_type"] == "upload"
        assert b2["stream_url"] == url

        # And the file is retrievable at the static route
        r3 = sess.get(f"{BASE_URL}{url}")
        assert r3.status_code == 200, f"static file 404: {r3.status_code}"
        cl = r3.headers.get("Content-Length")
        # Some proxies chunk; treat missing Content-Length as acceptable but
        # if present it must match payload size.
        if cl is not None:
            assert int(cl) == len(payload), f"content-length mismatch: {cl} vs {len(payload)}"
        assert r3.content == payload, "file bytes do not match uploaded payload"


# ---------------- 5. PUT integration_config ----------------

class TestIntegrationConfig:
    def test_admin_can_set_integration_fields(self, sess, admin_hdr):
        ic = {
            "protocol": "rtsp",
            "port": 554,
            "api_endpoint": "rtsp://cam.local/Streaming/Channels/101",
            "camera_ip": "192.168.1.64",
            "device_model": "Hikvision DS-2CD2043G0",
            "username": "admin",
            "password": "secret123",
            "notes": "Roof-mounted, PoE switch port 4",
        }
        r = sess.put(f"{API}/camera-streams/{DO_HW}", headers=admin_hdr,
                     json={"integration_config": ic})
        assert r.status_code == 200, r.text
        got = r.json().get("integration_config") or {}
        for k, v in ic.items():
            assert got.get(k) == v, f"integration_config.{k} lost: got {got.get(k)}, want {v}"

    def test_client_does_not_see_integration_config(self, sess, client_hdr):
        r = sess.get(f"{API}/camera-streams/by-device/{DO_HW}", headers=client_hdr)
        assert r.status_code == 200
        body = r.json() or {}
        assert "integration_config" not in body, "integration_config leaked to client"
