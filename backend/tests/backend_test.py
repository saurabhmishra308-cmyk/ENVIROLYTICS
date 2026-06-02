"""Envirolytics Monitor — backend regression test suite.

Covers:
- Auth (login, /me, change-password, admin change-user-password, brute-force lockout)
- Admin user CRUD (create, list, status toggle, delete, self-delete guard)
- Site activation (monthly/quarterly/yearly), status, list
- Data export (csv/pdf), Excel import (basic file validation)
- Public flowmeter endpoints (latest, status, history)
- Admin route guard (401 / 403 without admin)
"""
import io
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://process-flow-68.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@envirolytics.com"
ADMIN_PASSWORD = "Admin@Envirolytics2026"


# ============================
# Fixtures
# ============================
@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def admin_token(session):
    resp = session.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert resp.status_code == 200, f"Admin login failed: {resp.status_code} {resp.text}"
    data = resp.json()
    assert "access_token" in data
    assert data["user"]["role"] == "admin"
    return data["access_token"]


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def test_user(session, admin_headers):
    """Create a throwaway client user (used by multiple tests)."""
    email = f"TEST_user_{uuid.uuid4().hex[:6]}@envirolytics.com"
    payload = {"email": email, "password": "ClientPass123", "full_name": "TEST Client", "role": "client"}
    r = session.post(f"{API}/admin/users/create", headers=admin_headers, json=payload)
    assert r.status_code == 200, f"create_user failed: {r.text}"
    user = r.json()["user"]
    yield {"id": user["id"], "email": email, "password": "ClientPass123"}
    # cleanup
    session.delete(f"{API}/admin/users/{user['id']}", headers=admin_headers)


# ============================
# Health
# ============================
class TestHealth:
    def test_api_root(self, session):
        r = session.get(f"{API}/")
        assert r.status_code == 200
        assert "Envirolytics" in r.json().get("message", "")


# ============================
# Auth
# ============================
class TestAuth:
    def test_admin_login_success(self, session):
        r = session.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert r.status_code == 200
        data = r.json()
        assert data["token_type"] == "bearer"
        assert data["user"]["email"] == ADMIN_EMAIL
        assert data["user"]["role"] == "admin"
        assert isinstance(data["access_token"], str) and len(data["access_token"]) > 20

    def test_login_invalid_credentials(self, session):
        r = session.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "WrongPass!!"})
        assert r.status_code == 401

    def test_me_with_token(self, session, admin_headers):
        r = session.get(f"{API}/auth/me", headers=admin_headers)
        assert r.status_code == 200
        u = r.json()
        assert u["email"] == ADMIN_EMAIL
        assert u["role"] == "admin"
        assert "password_hash" not in u

    def test_me_without_token(self, session):
        r = session.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_change_password_wrong_current(self, session, admin_headers):
        r = session.post(
            f"{API}/auth/change-password",
            headers=admin_headers,
            json={"current_password": "wrong", "new_password": "NewPass1234"},
        )
        assert r.status_code == 401

    def test_change_password_then_revert(self, session, admin_headers):
        new_pw = "TempAdminPass!2026"
        r = session.post(
            f"{API}/auth/change-password",
            headers=admin_headers,
            json={"current_password": ADMIN_PASSWORD, "new_password": new_pw},
        )
        assert r.status_code == 200
        # Verify new password works
        r2 = session.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": new_pw})
        assert r2.status_code == 200
        # Revert
        new_token = r2.json()["access_token"]
        r3 = session.post(
            f"{API}/auth/change-password",
            headers={"Authorization": f"Bearer {new_token}", "Content-Type": "application/json"},
            json={"current_password": new_pw, "new_password": ADMIN_PASSWORD},
        )
        assert r3.status_code == 200

    def test_change_password_short(self, session, admin_headers):
        r = session.post(
            f"{API}/auth/change-password",
            headers=admin_headers,
            json={"current_password": ADMIN_PASSWORD, "new_password": "short"},
        )
        assert r.status_code == 400


# ============================
# Admin user management
# ============================
class TestAdminUsers:
    def test_list_users_requires_admin(self, session):
        r = session.get(f"{API}/admin/users/list")
        assert r.status_code in (401, 403)

    def test_list_users_admin(self, session, admin_headers):
        r = session.get(f"{API}/admin/users/list", headers=admin_headers)
        assert r.status_code == 200
        body = r.json()
        assert "users" in body and "count" in body
        assert any(u["email"] == ADMIN_EMAIL for u in body["users"])

    def test_create_duplicate_email(self, session, admin_headers, test_user):
        r = session.post(
            f"{API}/admin/users/create",
            headers=admin_headers,
            json={"email": test_user["email"], "password": "AnotherPass1", "full_name": "Dup", "role": "client"},
        )
        assert r.status_code == 400

    def test_create_short_password(self, session, admin_headers):
        r = session.post(
            f"{API}/admin/users/create",
            headers=admin_headers,
            json={"email": f"TEST_short_{uuid.uuid4().hex[:4]}@x.com", "password": "abc", "full_name": "X"},
        )
        assert r.status_code == 400

    def test_toggle_user_status(self, session, admin_headers, test_user):
        r = session.put(f"{API}/admin/users/{test_user['id']}/status?is_active=false", headers=admin_headers)
        assert r.status_code == 200
        assert r.json()["is_active"] is False
        # Deactivated user cannot log in
        r2 = session.post(f"{API}/auth/login", json={"email": test_user["email"], "password": test_user["password"]})
        assert r2.status_code in (401, 403)
        # Re-activate
        r3 = session.put(f"{API}/admin/users/{test_user['id']}/status?is_active=true", headers=admin_headers)
        assert r3.status_code == 200

    def test_admin_change_user_password(self, session, admin_headers, test_user):
        new_pw = "ResetByAdmin1!"
        r = session.post(
            f"{API}/auth/admin/change-user-password",
            headers=admin_headers,
            json={"user_id": test_user["id"], "new_password": new_pw},
        )
        assert r.status_code == 200
        # Login with new
        r2 = session.post(f"{API}/auth/login", json={"email": test_user["email"], "password": new_pw})
        assert r2.status_code == 200
        test_user["password"] = new_pw  # keep updated

    def test_non_admin_cannot_admin_change_password(self, session, test_user):
        # Login as client
        r = session.post(f"{API}/auth/login", json={"email": test_user["email"], "password": test_user["password"]})
        assert r.status_code == 200
        client_token = r.json()["access_token"]
        r2 = session.post(
            f"{API}/auth/admin/change-user-password",
            headers={"Authorization": f"Bearer {client_token}", "Content-Type": "application/json"},
            json={"user_id": test_user["id"], "new_password": "NoPermission1"},
        )
        assert r2.status_code == 403

    def test_cannot_delete_self(self, session, admin_headers):
        # Need admin id
        me = session.get(f"{API}/auth/me", headers=admin_headers).json()
        r = session.delete(f"{API}/admin/users/{me['id']}", headers=admin_headers)
        assert r.status_code == 400


# ============================
# Site activation
# ============================
class TestSiteActivation:
    @pytest.mark.parametrize("sub_type,expected_days", [("monthly", 30), ("quarterly", 90), ("yearly", 365)])
    def test_activate_site(self, session, admin_headers, test_user, sub_type, expected_days):
        r = session.post(
            f"{API}/admin/site/activate",
            headers=admin_headers,
            json={"user_id": test_user["id"], "subscription_type": sub_type},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["success"] is True
        act = body["activation"]
        assert act["subscription_type"] == sub_type
        # Validate the day offset roughly matches
        from datetime import datetime
        start = datetime.fromisoformat(act["start_date"])
        end = datetime.fromisoformat(act["end_date"])
        assert abs((end - start).days - expected_days) <= 1

    def test_status_active(self, session, admin_headers, test_user):
        # Ensure an active subscription exists
        session.post(
            f"{API}/admin/site/activate",
            headers=admin_headers,
            json={"user_id": test_user["id"], "subscription_type": "yearly"},
        )
        r = session.get(f"{API}/admin/site/status/{test_user['id']}")
        assert r.status_code == 200
        assert r.json()["status"] == "active"

    def test_status_inactive_for_unknown_user(self, session):
        r = session.get(f"{API}/admin/site/status/nonexistent_user_xyz")
        assert r.status_code == 200
        assert r.json()["status"] == "inactive"

    def test_list_activations(self, session, admin_headers):
        r = session.get(f"{API}/admin/site/activations", headers=admin_headers)
        assert r.status_code == 200
        assert "activations" in r.json()


# ============================
# Data export & import
# ============================
class TestDataExport:
    def test_csv_export_requires_admin(self, session):
        r = session.get(f"{API}/admin/data/export?format=csv")
        assert r.status_code in (401, 403)

    def test_csv_export(self, session, admin_headers):
        r = session.get(f"{API}/admin/data/export?format=csv", headers=admin_headers)
        assert r.status_code == 200
        assert "text/csv" in r.headers.get("content-type", "")
        assert "attachment" in r.headers.get("content-disposition", "").lower()

    def test_pdf_export(self, session, admin_headers):
        r = session.get(f"{API}/admin/data/export?format=pdf", headers=admin_headers)
        assert r.status_code == 200
        assert "application/pdf" in r.headers.get("content-type", "")
        assert r.content[:4] == b"%PDF"

    def test_export_invalid_format(self, session, admin_headers):
        r = session.get(f"{API}/admin/data/export?format=xml", headers=admin_headers)
        assert r.status_code in (400, 422)

    def test_import_rejects_non_excel(self, session, admin_token):
        files = {"file": ("test.txt", io.BytesIO(b"hello"), "text/plain")}
        r = requests.post(
            f"{API}/admin/data/import",
            headers={"Authorization": f"Bearer {admin_token}"},
            files=files,
        )
        assert r.status_code == 400


# ============================
# Public flowmeter endpoints
# ============================
class TestFlowmeterPublic:
    def test_status_public(self, session):
        r = session.get(f"{API}/flowmeter/status")
        assert r.status_code == 200
        assert "connected" in r.json()

    def test_latest_public(self, session):
        r = session.get(f"{API}/flowmeter/latest")
        assert r.status_code == 200
        body = r.json()
        assert "flowmeters" in body and "count" in body

    def test_history_public(self, session):
        r = session.get(f"{API}/flowmeter/history/UNKNOWN_HW")
        assert r.status_code == 200
        body = r.json()
        assert "readings" in body and "count" in body


# ============================
# Admin route guard
# ============================
class TestAdminGuard:
    @pytest.mark.parametrize("path", [
        "/admin/users/list",
        "/admin/site/activations",
        "/admin/data/export?format=csv",
    ])
    def test_no_token_blocked(self, session, path):
        r = session.get(f"{API}{path}")
        assert r.status_code in (401, 403)


# ============================
# Brute force lockout (run last)
# ============================
class TestBruteForce:
    def test_lockout_after_5_failures(self):
        # Use a fresh email that won't lock other tests' identifier
        fake_email = f"bruteforce_{uuid.uuid4().hex[:6]}@envirolytics.com"
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        codes = []
        for _ in range(6):
            r = s.post(f"{API}/auth/login", json={"email": fake_email, "password": "WrongPw!!"})
            codes.append(r.status_code)
        # After 5 failures, at least one 429 is expected
        assert 429 in codes, f"Expected 429 after 5 failures, got {codes}"



# ============================
# Instruments API (generic — dwlr / ph / tds / conductivity only, no bod/cod/tss)
# ============================
class TestInstruments:
    def test_types_only_supported(self, session):
        r = session.get(f"{API}/instruments/types")
        assert r.status_code == 200
        types = r.json()["types"]
        assert sorted(types) == ["conductivity", "dwlr", "ph", "tds"]
        for forbidden in ("bod", "cod", "tss"):
            assert forbidden not in types

    def test_all_latest_no_auth(self, session):
        r = session.get(f"{API}/instruments/all/latest")
        assert r.status_code == 200
        body = r.json()
        assert "by_type" in body and "total" in body
        assert isinstance(body["by_type"], dict)

    def test_ingest_dwlr_and_visible(self, session, admin_headers):
        hw = f"TEST_DWLR_{uuid.uuid4().hex[:6]}"
        payload = {"hardware_id": hw, "values": {"LEVEL": 15.8, "TEMPER": 24.1, "BATTERY": 87}, "location": "TestSite"}
        r = session.post(f"{API}/instruments/ingest?instrument_type=dwlr", headers=admin_headers, json=payload)
        assert r.status_code == 200, r.text
        assert r.json()["success"] is True
        # Should now appear in latest
        r2 = session.get(f"{API}/instruments/dwlr/latest")
        assert r2.status_code == 200
        hws = [x["hardware_id"] for x in r2.json()["readings"]]
        assert hw in hws

    def test_ingest_unsupported_type_400(self, session, admin_headers):
        payload = {"hardware_id": "X", "values": {"BOD": 5}}
        r = session.post(f"{API}/instruments/ingest?instrument_type=bod", headers=admin_headers, json=payload)
        assert r.status_code == 400

    def test_ingest_requires_admin(self, session):
        r = session.post(f"{API}/instruments/ingest?instrument_type=dwlr", json={"hardware_id": "X", "values": {}})
        assert r.status_code in (401, 403)


# ============================
# Admin user location create + update
# ============================
class TestUserLocations:
    def test_create_user_with_location(self, session, admin_headers):
        email = f"TEST_loc_{uuid.uuid4().hex[:6]}@envirolytics.com"
        payload = {
            "email": email, "password": "ClientPass123", "full_name": "Loc User",
            "role": "client", "company_name": "Acme", "phone": "9999",
            "location_name": "Mumbai HQ", "latitude": 19.076, "longitude": 72.877,
        }
        r = session.post(f"{API}/admin/users/create", headers=admin_headers, json=payload)
        assert r.status_code == 200, r.text
        user = r.json()["user"]
        assert user["latitude"] == 19.076
        assert user["longitude"] == 72.877
        assert user["location_name"] == "Mumbai HQ"
        # Verify persistence via list
        r2 = session.get(f"{API}/admin/users/list", headers=admin_headers)
        assert r2.status_code == 200
        match = [u for u in r2.json()["users"] if u["id"] == user["id"]]
        assert len(match) == 1
        assert match[0]["latitude"] == 19.076
        # Cleanup
        session.delete(f"{API}/admin/users/{user['id']}", headers=admin_headers)

    def test_admin_seeded_with_lucknow(self, session, admin_headers):
        r = session.get(f"{API}/admin/users/list", headers=admin_headers)
        assert r.status_code == 200
        admin = [u for u in r.json()["users"] if u["email"] == ADMIN_EMAIL]
        assert len(admin) == 1
        a = admin[0]
        assert abs(a.get("latitude", 0) - 26.8467) < 0.01
        assert abs(a.get("longitude", 0) - 80.9462) < 0.01
        assert a.get("location_name") == "Lucknow HQ"

    def test_locations_endpoint_admin(self, session, admin_headers):
        r = session.get(f"{API}/admin/users/locations", headers=admin_headers)
        assert r.status_code == 200
        locs = r.json()["locations"]
        # All returned items must have lat+long
        for l in locs:
            assert l.get("latitude") is not None
            assert l.get("longitude") is not None

    def test_locations_endpoint_client(self, session, admin_headers):
        # Create a client and ensure it can see locations
        email = f"TEST_locclient_{uuid.uuid4().hex[:6]}@envirolytics.com"
        payload = {"email": email, "password": "ClientPass123", "full_name": "C", "role": "client",
                   "latitude": 12.97, "longitude": 77.59, "location_name": "BLR"}
        cr = session.post(f"{API}/admin/users/create", headers=admin_headers, json=payload)
        assert cr.status_code == 200
        uid = cr.json()["user"]["id"]
        login = session.post(f"{API}/auth/login", json={"email": email, "password": "ClientPass123"})
        assert login.status_code == 200
        tok = login.json()["access_token"]
        r = session.get(f"{API}/admin/users/locations", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200, r.text
        assert r.json()["count"] >= 1
        session.delete(f"{API}/admin/users/{uid}", headers=admin_headers)

    def test_update_user_fields(self, session, admin_headers, test_user):
        new_payload = {
            "full_name": "Updated Name", "company_name": "NewCo", "phone": "1234",
            "location_name": "Delhi", "latitude": 28.6, "longitude": 77.2, "role": "client"
        }
        r = session.put(f"{API}/admin/users/{test_user['id']}", headers=admin_headers, json=new_payload)
        assert r.status_code == 200, r.text
        # Verify via list
        rl = session.get(f"{API}/admin/users/list", headers=admin_headers)
        m = [u for u in rl.json()["users"] if u["id"] == test_user["id"]][0]
        assert m["full_name"] == "Updated Name"
        assert m["location_name"] == "Delhi"
        assert m["latitude"] == 28.6
        assert m["longitude"] == 77.2

    def test_update_user_invalid_role(self, session, admin_headers, test_user):
        r = session.put(f"{API}/admin/users/{test_user['id']}", headers=admin_headers, json={"role": "superuser"})
        assert r.status_code == 400


# ============================
# Certificates API
# ============================
def _tiny_pdf_bytes():
    # Minimal valid PDF
    return (b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
            b"2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n"
            b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]>>endobj\n"
            b"xref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n"
            b"0000000050 00000 n\n0000000090 00000 n\ntrailer<</Size 4/Root 1 0 R>>\n"
            b"startxref\n140\n%%EOF\n")


class TestCertificates:
    def test_types_endpoint(self, session, admin_headers):
        r = session.get(f"{API}/certificates/types", headers=admin_headers)
        assert r.status_code == 200
        keys = [t["key"] for t in r.json()["types"]]
        assert sorted(keys) == ["calibration", "installation", "water_post", "water_pre"]

    def test_upload_requires_admin(self, session):
        files = {"file": ("a.pdf", _tiny_pdf_bytes(), "application/pdf")}
        data = {"cert_type": "installation", "year": 2026}
        # No content-type header for multipart
        s = requests.Session()
        r = s.post(f"{API}/certificates/upload", files=files, data=data)
        assert r.status_code in (401, 403)

    def test_upload_and_list_and_download_and_delete(self, admin_token):
        s = requests.Session()
        hdr = {"Authorization": f"Bearer {admin_token}"}
        files = {"file": ("install.pdf", _tiny_pdf_bytes(), "application/pdf")}
        data = {"cert_type": "installation", "year": 2026, "notes": "test"}
        r = s.post(f"{API}/certificates/upload", headers=hdr, files=files, data=data)
        assert r.status_code == 200, r.text
        cert = r.json()["certificate"]
        cert_id = cert["id"]
        assert cert["original_filename"] == "install.pdf"
        assert cert["size_bytes"] > 0
        # list filter
        rl = s.get(f"{API}/certificates/list?cert_type=installation&year=2026", headers=hdr)
        assert rl.status_code == 200
        ids = [c["id"] for c in rl.json()["certificates"]]
        assert cert_id in ids
        # download
        rd = s.get(f"{API}/certificates/download/{cert_id}", headers=hdr)
        assert rd.status_code == 200
        assert rd.content.startswith(b"%PDF")
        # delete
        rdel = s.delete(f"{API}/certificates/{cert_id}", headers=hdr)
        assert rdel.status_code == 200
        # confirm gone
        rd2 = s.get(f"{API}/certificates/download/{cert_id}", headers=hdr)
        assert rd2.status_code == 404

    def test_upload_rejects_exe(self, admin_token):
        s = requests.Session()
        hdr = {"Authorization": f"Bearer {admin_token}"}
        files = {"file": ("malware.exe", b"MZ\x00\x00", "application/octet-stream")}
        data = {"cert_type": "installation", "year": 2026}
        r = s.post(f"{API}/certificates/upload", headers=hdr, files=files, data=data)
        assert r.status_code == 400

    def test_upload_rejects_large_file(self, admin_token):
        s = requests.Session()
        hdr = {"Authorization": f"Bearer {admin_token}"}
        big = b"%PDF-1.4\n" + b"A" * (10 * 1024 * 1024 + 100)
        files = {"file": ("big.pdf", big, "application/pdf")}
        data = {"cert_type": "installation", "year": 2026}
        r = s.post(f"{API}/certificates/upload", headers=hdr, files=files, data=data)
        assert r.status_code == 413

    def test_client_only_sees_own(self, session, admin_headers, admin_token):
        # Create client
        email = f"TEST_cc_{uuid.uuid4().hex[:6]}@envirolytics.com"
        cr = session.post(f"{API}/admin/users/create", headers=admin_headers,
                          json={"email": email, "password": "ClientPass123", "full_name": "CC", "role": "client"})
        client_id = cr.json()["user"]["id"]
        # admin uploads with client_id
        s = requests.Session()
        adm_hdr = {"Authorization": f"Bearer {admin_token}"}
        files = {"file": ("c.pdf", _tiny_pdf_bytes(), "application/pdf")}
        data = {"cert_type": "calibration", "year": 2026, "client_id": client_id}
        r = s.post(f"{API}/certificates/upload", headers=adm_hdr, files=files, data=data)
        assert r.status_code == 200
        cert_id = r.json()["certificate"]["id"]
        # client logs in
        login = session.post(f"{API}/auth/login", json={"email": email, "password": "ClientPass123"})
        client_tok = login.json()["access_token"]
        client_hdr = {"Authorization": f"Bearer {client_tok}"}
        rl = s.get(f"{API}/certificates/list", headers=client_hdr)
        assert rl.status_code == 200
        ids = [c["id"] for c in rl.json()["certificates"]]
        # All listed certs should belong to this client
        for c in rl.json()["certificates"]:
            assert c.get("client_id") == client_id
        assert cert_id in ids
        # cleanup
        s.delete(f"{API}/certificates/{cert_id}", headers=adm_hdr)
        session.delete(f"{API}/admin/users/{client_id}", headers=admin_headers)
