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
