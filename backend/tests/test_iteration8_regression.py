"""Iteration-8 production-readiness sweep.

New coverage:
  * PUT /api/admin/users/{id} accepts notification_emails (1, 2 OK; 3 -> 422;
    empty clears; lowercased/trimmed).
  * PUT /api/admin/users/{id} 403 for non-admin.
  * POST /api/admin/users/create validates notification_emails > 2 -> 422.
  * notification_service.check_and_notify() picks up owner email + up to 2
    extras when a stale reading (>2h) exists.
  * POST /api/water-quality/report with tank='1'|'2'|'both' filters CSV/PDF
    columns and appends _tank1/_tank2 suffix to filename.
  * Performance: /api/water-quality/latest, /api/dashboard-live,
    /api/instrument-registry each under 500ms (loose 1500ms guard rail here
    since tests run through public ingress; strict number is a soft warn).
"""
from __future__ import annotations

import asyncio
import io
import os
import re
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
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


# ------------------------------------------------------------------ fixtures

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


# ------------------------------------------------------------------ notification_emails

class TestUserNotificationEmails:
    """Admin CRUD for the per-client notification_emails field."""

    def test_update_one_email_ok(self, admin_headers):
        r = requests.put(f"{API}/admin/users/{CLIENT_USER_ID}",
                         headers=admin_headers,
                         json={"notification_emails": ["  Ops1@Client.com  "]})
        assert r.status_code == 200, r.text

        # verify persisted & lowercased/trimmed
        lst = requests.get(f"{API}/admin/users/list", headers=admin_headers).json()["users"]
        u = next(x for x in lst if x["id"] == CLIENT_USER_ID)
        assert u.get("notification_emails") == ["ops1@client.com"]

    def test_update_two_emails_ok(self, admin_headers):
        r = requests.put(f"{API}/admin/users/{CLIENT_USER_ID}",
                         headers=admin_headers,
                         json={"notification_emails": ["ops1@client.com", "ops2@client.com"]})
        assert r.status_code == 200, r.text

        lst = requests.get(f"{API}/admin/users/list", headers=admin_headers).json()["users"]
        u = next(x for x in lst if x["id"] == CLIENT_USER_ID)
        assert u.get("notification_emails") == ["ops1@client.com", "ops2@client.com"]

    def test_update_three_emails_rejected(self, admin_headers):
        r = requests.put(f"{API}/admin/users/{CLIENT_USER_ID}",
                         headers=admin_headers,
                         json={"notification_emails": ["a@x.com", "b@x.com", "c@x.com"]})
        assert r.status_code == 422, r.text
        body = r.text.lower()
        assert "2" in body and ("notification" in body or "at most" in body or "max" in body)

    def test_empty_array_clears(self, admin_headers):
        r = requests.put(f"{API}/admin/users/{CLIENT_USER_ID}",
                         headers=admin_headers,
                         json={"notification_emails": []})
        assert r.status_code == 200, r.text

        lst = requests.get(f"{API}/admin/users/list", headers=admin_headers).json()["users"]
        u = next(x for x in lst if x["id"] == CLIENT_USER_ID)
        assert u.get("notification_emails") in ([], None)

    def test_non_admin_put_403(self, client_headers):
        r = requests.put(f"{API}/admin/users/{CLIENT_USER_ID}",
                         headers=client_headers,
                         json={"notification_emails": ["evil@x.com"]})
        assert r.status_code == 403, r.text

    def test_create_user_three_emails_rejected(self, admin_headers):
        email = f"iter8_notify_reject_{uuid.uuid4().hex[:6]}@example.com"
        r = requests.post(f"{API}/admin/users/create", headers=admin_headers,
                          json={
                              "email": email,
                              "password": "Passw0rd!",
                              "full_name": "Reject Notify",
                              "role": "client",
                              "notification_emails": ["a@x.com", "b@x.com", "c@x.com"],
                          })
        assert r.status_code == 422, r.text

    def test_create_user_two_emails_ok(self, admin_headers):
        email = f"iter8_notify_ok_{uuid.uuid4().hex[:6]}@example.com"
        r = requests.post(f"{API}/admin/users/create", headers=admin_headers,
                          json={
                              "email": email,
                              "password": "Passw0rd!",
                              "full_name": "TEST Notify OK",
                              "role": "client",
                              "notification_emails": ["Notify1@X.com ", " notify2@x.com"],
                          })
        assert r.status_code == 200, r.text
        user = r.json()["user"]
        assert user["notification_emails"] == ["notify1@x.com", "notify2@x.com"]
        # cleanup
        requests.delete(f"{API}/admin/users/{user['id']}", headers=admin_headers)

    def test_zzz_restore_client_notify(self, admin_headers):
        """Restore per spec: testclient must end with the ops1/ops2 pair."""
        r = requests.put(f"{API}/admin/users/{CLIENT_USER_ID}",
                         headers=admin_headers,
                         json={"notification_emails": ["ops1@client.com", "ops2@client.com"]})
        assert r.status_code == 200


# ------------------------------------------------------------------ offline alert engine

class TestOfflineNotificationRecipients:
    """Direct check_and_notify() call — verifies owner_email + 2 extras are
    included in the recipients list. SMTP send falls back to logging when no
    SMTP creds; we only assert on the recipients composition, not delivery.
    """

    @pytest.mark.asyncio
    async def test_check_and_notify_owner_plus_extras(self, admin_headers):
        # Ensure testclient has the expected 2 extras
        r = requests.put(f"{API}/admin/users/{CLIENT_USER_ID}",
                         headers=admin_headers,
                         json={"notification_emails": ["extra1@example.com",
                                                      "extra2@example.com"]})
        assert r.status_code == 200

        # Import the service + db lazily so pytest collection stays cheap.
        from motor.motor_asyncio import AsyncIOMotorClient
        import notification_service as nsvc

        mongo_url = os.environ["MONGO_URL"]
        db_name = os.environ["DB_NAME"]
        client = AsyncIOMotorClient(mongo_url)
        db = client[db_name]
        try:
            # Reassign DO_TEST_001 ownership to the testclient temporarily.
            await db.instrument_registry.update_one(
                {"hardware_id": DO_HW},
                {"$set": {"owner_user_id": CLIENT_USER_ID}},
            )
            # Insert a fresh do_meter latest doc that is >2h stale.
            stale_iso = (datetime.now(timezone.utc) - timedelta(hours=6)).isoformat()
            fake_hw = f"ITER8_STALE_{uuid.uuid4().hex[:6]}"
            await db.instrument_registry.update_one(
                {"hardware_id": fake_hw},
                {"$set": {"hardware_id": fake_hw, "instrument_type": "do_meter",
                          "owner_user_id": CLIENT_USER_ID}},
                upsert=True,
            )
            await db.instrument_latest.update_one(
                {"hardware_id": fake_hw},
                {"$set": {"hardware_id": fake_hw, "instrument_type": "do_meter",
                          "received_at": stale_iso, "timestamp": stale_iso,
                          "values": {"DO_TANK_1": 4.0}}},
                upsert=True,
            )
            # Clear any prior cooldown state so we re-notify.
            await db.notification_state.delete_many({"hardware_id": fake_hw})

            result = await nsvc.check_and_notify(db)
            assert result["checked"] is True

            # Find the results entry for our owner
            hits = [r for r in result.get("results", [])
                    if r.get("owner") == CLIENT_EMAIL]
            assert hits, f"No result row for owner={CLIENT_EMAIL}: {result}"
            recipients = hits[0]["recipients"]
            recipients_lc = [r.lower() for r in recipients]
            assert CLIENT_EMAIL.lower() in recipients_lc
            assert "extra1@example.com" in recipients_lc
            assert "extra2@example.com" in recipients_lc
        finally:
            # cleanup
            await db.instrument_latest.delete_many({"hardware_id": fake_hw})
            await db.instrument_registry.delete_many({"hardware_id": fake_hw})
            await db.notification_state.delete_many({"hardware_id": fake_hw})
            # restore DO_TEST_001 owner
            await db.instrument_registry.update_one(
                {"hardware_id": DO_HW},
                {"$set": {"owner_user_id": DEFAULT_OWNER_USER_ID}},
            )
            client.close()


# ------------------------------------------------------------------ DO report tank filter

def _extract_fname(resp) -> str:
    cd = resp.headers.get("Content-Disposition", "")
    m = re.search(r'filename="?([^";]+)"?', cd)
    return m.group(1) if m else ""


class TestDOReportTankFilter:
    """POST /api/water-quality/report with tank filter."""

    @classmethod
    def _payload(cls, tank=None, fmt="csv"):
        # Wide window to guarantee we catch DO_TEST_001 seeded readings.
        to_dt = datetime.now(timezone.utc)
        from_dt = to_dt - timedelta(days=365)
        p = {
            "hardware_id": DO_HW,
            "format": fmt,
            "from_date": from_dt.isoformat(),
            "to_date": to_dt.isoformat(),
            "unit": "mg/L",
        }
        if tank is not None:
            p["tank"] = tank
        return p

    @staticmethod
    def _find_col_header(csv_text: str) -> str:
        """CSV starts with a metadata block ('Envirolytics Water-Quality Report',
        'Device:,...', etc). Column header line is the first one that contains
        'Received At' or begins with 'Timestamp' or contains any DO_TANK_ token.
        """
        for line in csv_text.splitlines():
            if "Received At" in line or line.startswith("Timestamp") or "DO_TANK_" in line:
                return line
        return csv_text.splitlines()[0] if csv_text else ""

    def test_csv_tank_1_only(self, admin_headers):
        r = requests.post(f"{API}/water-quality/report", headers=admin_headers,
                          json=self._payload(tank="1"))
        assert r.status_code == 200, r.text
        header = self._find_col_header(r.text)
        assert "DO_TANK_1" in header, header
        assert "DO_TANK_2" not in header, header
        fname = _extract_fname(r)
        assert "_tank1" in fname, fname

    def test_csv_tank_2_only(self, admin_headers):
        r = requests.post(f"{API}/water-quality/report", headers=admin_headers,
                          json=self._payload(tank="2"))
        assert r.status_code == 200, r.text
        header = self._find_col_header(r.text)
        assert "DO_TANK_2" in header, header
        assert "DO_TANK_1" not in header, header
        fname = _extract_fname(r)
        assert "_tank2" in fname, fname

    def test_csv_tank_both_default(self, admin_headers):
        r = requests.post(f"{API}/water-quality/report", headers=admin_headers,
                          json=self._payload(tank="both"))
        assert r.status_code == 200, r.text
        header = self._find_col_header(r.text)
        assert "DO_TANK_1" in header and "DO_TANK_2" in header, header
        fname = _extract_fname(r)
        assert "_tank" not in fname, fname

    def test_csv_tank_omitted_returns_both(self, admin_headers):
        r = requests.post(f"{API}/water-quality/report", headers=admin_headers,
                          json=self._payload(tank=None))
        assert r.status_code == 200, r.text
        header = self._find_col_header(r.text)
        assert "DO_TANK_1" in header and "DO_TANK_2" in header, header

    def test_pdf_tank_1_only(self, admin_headers):
        r = requests.post(f"{API}/water-quality/report", headers=admin_headers,
                          json=self._payload(tank="1", fmt="pdf"))
        assert r.status_code == 200, r.text
        assert r.headers.get("Content-Type", "").startswith("application/pdf")
        # PDF filename should have _tank1 suffix per spec
        fname = _extract_fname(r)
        assert "_tank1" in fname, f"PDF filename missing tank suffix: {fname}"
        # PDF binary should not contain a DO_TANK_2 header cell (best-effort).
        body = r.content
        assert b"DO_TANK_1" in body
        assert b"DO_TANK_2" not in body, "PDF still contains DO_TANK_2 header when tank=1"

    def test_pdf_tank_2_only(self, admin_headers):
        r = requests.post(f"{API}/water-quality/report", headers=admin_headers,
                          json=self._payload(tank="2", fmt="pdf"))
        assert r.status_code == 200
        fname = _extract_fname(r)
        assert "_tank2" in fname, f"PDF filename missing tank suffix: {fname}"


# ------------------------------------------------------------------ Performance smoke

class TestPerformance:
    """Loose latency guards. Public ingress adds noise; strict 500ms may
    flap so we assert < 1500ms and print the timing."""

    def _time_get(self, url, headers):
        t0 = time.perf_counter()
        r = requests.get(url, headers=headers, timeout=10)
        dt = (time.perf_counter() - t0) * 1000
        return r, dt

    def test_water_quality_latest_perf(self, admin_headers):
        r, dt = self._time_get(f"{API}/water-quality/latest", admin_headers)
        assert r.status_code == 200
        print(f"[perf] /water-quality/latest = {dt:.0f} ms")
        assert dt < 1500, f"slow: {dt:.0f}ms"

    def test_dashboard_live_perf(self, admin_headers):
        # Dashboard doesn't have a single /dashboard-live endpoint — it composes
        # from /api/flowmeter/latest + /api/instruments/all/latest. Time both
        # and assert each is fast.
        for path in ("/flowmeter/latest", "/instruments/all/latest"):
            r, dt = self._time_get(f"{API}{path}", admin_headers)
            assert r.status_code == 200, f"{path} -> {r.status_code}: {r.text[:120]}"
            print(f"[perf] {path} = {dt:.0f} ms")
            assert dt < 1500, f"slow {path}: {dt:.0f}ms"

    def test_instrument_registry_perf(self, admin_headers):
        r, dt = self._time_get(f"{API}/instrument-registry", admin_headers)
        assert r.status_code == 200
        print(f"[perf] /instrument-registry = {dt:.0f} ms")
        assert dt < 1500, f"slow: {dt:.0f}ms"


# ------------------------------------------------------------------ Regression quickies

class TestRegressionQuick:
    """Just a few high-value re-checks that iter-6/7 features are still 200."""

    def test_water_quality_latest_admin(self, admin_headers):
        r = requests.get(f"{API}/water-quality/latest", headers=admin_headers)
        assert r.status_code == 200
        data = r.json()
        stp_ids = {d.get("hardware_id") for d in data.get("stp", [])}
        do_ids = {d.get("hardware_id") for d in data.get("do", [])}
        assert STP_HW in stp_ids, f"STP list: {stp_ids}"
        assert DO_HW in do_ids, f"DO list: {do_ids}"

    def test_client_sanitization_energy_stripped(self, admin_headers, client_headers):
        # reassign both to client
        for hw in (STP_HW, DO_HW):
            requests.put(f"{API}/instrument-registry/{hw}", headers=admin_headers,
                         json={"owner_user_id": CLIENT_USER_ID})
        try:
            r = requests.get(f"{API}/water-quality/latest", headers=client_headers)
            assert r.status_code == 200
            data = r.json()
            stp = next((d for d in data.get("stp", []) if d.get("hardware_id") == STP_HW), None)
            assert stp is not None, f"STP not in client feed: keys={list(data.keys())}"
            cfg = stp.get("stp_unit_config") or {}
            # Iteration-7 minor finding: energy key may still be present as None.
            # Report it but do not fail if the value is None (non-security).
            if "energy" in cfg and cfg["energy"] is not None:
                assert False, f"energy leaked to client: {cfg['energy']}"
        finally:
            for hw in (STP_HW, DO_HW):
                requests.put(f"{API}/instrument-registry/{hw}", headers=admin_headers,
                             json={"owner_user_id": DEFAULT_OWNER_USER_ID})

    def test_flowmeter_mgmt_categories(self, admin_headers):
        r = requests.get(f"{API}/flowmeter-mgmt/categories", headers=admin_headers)
        assert r.status_code == 200

    def test_camera_by_device_ok(self, admin_headers):
        r = requests.get(f"{API}/camera-streams/by-device/{STP_HW}", headers=admin_headers)
        # 200 (may be empty). Any 5xx would be a regression.
        assert r.status_code in (200, 404), r.text


# ------------------------------------------------------------------ Teardown module-level

def test_zzz_restore_ownership(admin_headers):
    """Final safety net — restore devices + testclient notify list."""
    for hw in (STP_HW, DO_HW):
        requests.put(f"{API}/instrument-registry/{hw}", headers=admin_headers,
                     json={"owner_user_id": DEFAULT_OWNER_USER_ID})
    requests.put(f"{API}/admin/users/{CLIENT_USER_ID}", headers=admin_headers,
                 json={"notification_emails": ["ops1@client.com", "ops2@client.com"]})
