"""Iteration 6 supplemental backend tests.

Targets endpoints called out explicitly in the iteration_6 review request that
were not already covered by backend_test.py:
- /api/auth/me returns permissions map with 6 keys
- /api/notifications/emails GET
- POST /api/notifications/test (sent=0 with empty RESEND_API_KEY)
- /api/alerts/offline
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://carbon-track-24.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@envirolytics.com"
ADMIN_PASSWORD = "Admin@Envirolytics2026"

EXPECTED_PERM_KEYS = {"dashboard", "reports", "analysis", "certificates", "audit", "limits"}


@pytest.fixture(scope="module")
def admin_headers():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"admin login failed: {r.text}"
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


class TestAuthMePermissions:
    def test_me_has_permissions_six_keys(self, admin_headers):
        r = requests.get(f"{API}/auth/me", headers=admin_headers)
        assert r.status_code == 200
        u = r.json()
        assert "permissions" in u, f"permissions missing from /auth/me: {u}"
        perms = u["permissions"]
        assert isinstance(perms, dict)
        assert set(perms.keys()) >= EXPECTED_PERM_KEYS, f"missing keys: {EXPECTED_PERM_KEYS - set(perms.keys())}"
        # admin should have all True implicitly
        for k in EXPECTED_PERM_KEYS:
            assert perms[k] is True, f"admin perm {k} not True: {perms[k]}"


class TestNotifications:
    def test_emails_list_admin(self, admin_headers):
        r = requests.get(f"{API}/notifications/emails", headers=admin_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        # Accept either {emails:[...]} or a plain list
        if isinstance(data, dict):
            assert "emails" in data or "items" in data or "data" in data, f"unexpected shape: {data}"
        else:
            assert isinstance(data, list)

    def test_emails_requires_auth(self):
        r = requests.get(f"{API}/notifications/emails")
        assert r.status_code in (401, 403)

    def test_post_test_notification_returns_json(self, admin_headers):
        r = requests.post(f"{API}/notifications/test", headers=admin_headers, json={})
        assert r.status_code == 200, r.text
        data = r.json()
        # Either {sent:false} or {sent:0} acceptable since RESEND_API_KEY is empty
        assert ("sent" in data) or ("ok" in data) or ("message" in data), f"unexpected response: {data}"
        if "sent" in data:
            assert data["sent"] in (False, 0, "false")


class TestAlertsOffline:
    def test_alerts_offline_no_auth(self):
        # alerts/offline is public per dashboard usage
        r = requests.get(f"{API}/alerts/offline")
        assert r.status_code in (200, 401), r.text
        if r.status_code == 200:
            data = r.json()
            assert isinstance(data, (list, dict))

    def test_alerts_offline_with_auth(self, admin_headers):
        r = requests.get(f"{API}/alerts/offline", headers=admin_headers)
        assert r.status_code == 200
        data = r.json()
        # Should contain offline instruments list or similar
        assert isinstance(data, (list, dict))


class TestSubUserPermissionsShape:
    def test_subuser_login_permissions_keys(self):
        s = requests.Session()
        r = s.post(f"{API}/auth/login", json={"email": "viewer@envirolytics.com", "password": "Viewer@123456"})
        if r.status_code != 200:
            pytest.skip(f"viewer sub-user login not available: {r.status_code} {r.text}")
        data = r.json()
        perms = data["user"].get("permissions", {})
        assert set(perms.keys()) >= EXPECTED_PERM_KEYS, f"missing perm keys: {perms}"
        # viewer should have dashboard + reports True
        assert perms.get("dashboard") is True
        assert perms.get("reports") is True
        # analysis should be False (sub-user)
        assert perms.get("analysis") is False, f"viewer should NOT have analysis perm: {perms}"
