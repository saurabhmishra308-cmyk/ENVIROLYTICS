"""Iteration-2 smoke test — verify backend endpoints still return 2xx with admin bearer
after the frontend visual polish iteration (no backend changes expected)."""
import os
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://carbon-track-24.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@envirolytics.com"
ADMIN_PASSWORD = "Admin@Envirolytics2026"


def _login():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                      timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


def test_smoke_endpoints():
    token = _login()
    h = {"Authorization": f"Bearer {token}"}
    endpoints = [
        "/api/auth/me",
        "/api/flowmeter/latest",
        "/api/flowmeter/status",
        "/api/flowmeter-mgmt/categories",
        "/api/instruments/all/latest",
        "/api/admin/users/locations",
    ]
    fails = []
    for ep in endpoints:
        r = requests.get(f"{BASE_URL}{ep}", headers=h, timeout=30)
        if not (200 <= r.status_code < 300):
            fails.append((ep, r.status_code, r.text[:120]))
    assert not fails, f"Failures: {fails}"


def test_change_password_wrong_current_returns_401():
    token = _login()
    r = requests.post(f"{BASE_URL}/api/auth/change-password",
                      headers={"Authorization": f"Bearer {token}"},
                      json={"current_password": "WrongPwd!123", "new_password": "Whatever@2026"},
                      timeout=30)
    assert r.status_code in (400, 401), f"expected 401/400 got {r.status_code} {r.text}"
