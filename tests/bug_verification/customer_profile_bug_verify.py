#!/usr/bin/env python3
"""Focused verification for admin/customer profile default selection bug.
Creates/restores only Customer Profile fields used for the test.
"""
import json
import os
import sys
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional

import requests

BASE = os.environ.get("TEST_BACKEND_URL", "http://localhost:8001").rstrip("/")
ADMIN_EMAIL = "admin@envirolytics.com"
ADMIN_PASSWORD = "Admin@Envirolytics2026"
CLIENT_EMAIL = "testclient@envirolytics.com"
CLIENT_PASSWORD = "Client@Test2026"

PROFILE_FIELDS = [
    "customer_name", "site_name", "unit_name", "address", "representative_name",
    "representative_designation", "representative_email", "representative_phone",
    "noc_mode", "noc_number", "noc_issue_date", "noc_validity_years", "noc_expiry_date",
    "cto_number", "cto_issue_date", "cto_expiry_date", "boreholes_permitted",
    "abstraction_borewells_count", "permitted_daily_kl", "permitted_yearly_kl",
    "piezometers_count", "rwh_structure_count", "rwh_catchment_area_sqm", "notes",
    "borewell_nocs",
]

@dataclass
class Auth:
    token: str
    user: Dict[str, Any]


def req(method: str, path: str, token: Optional[str] = None, **kwargs) -> requests.Response:
    headers = kwargs.pop("headers", {}) or {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    url = f"{BASE}{path}"
    return requests.request(method, url, headers=headers, timeout=20, **kwargs)


def login(email: str, password: str) -> Auth:
    r = req("POST", "/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    data = r.json()
    assert data.get("access_token"), f"missing access_token for {email}: {data}"
    assert data.get("user", {}).get("email") == email, f"wrong login user for {email}: {data}"
    return Auth(data["access_token"], data["user"])


def profile_subset(profile: Dict[str, Any]) -> Dict[str, Any]:
    return {k: profile.get(k) for k in PROFILE_FIELDS if k in profile}


def put_profile(token: str, uid: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    r = req("PUT", f"/api/customer-profile/{uid}", token=token, json=payload)
    assert r.status_code == 200, f"PUT profile {uid} failed: {r.status_code} {r.text}"
    return r.json()


def main() -> int:
    evidence: Dict[str, Any] = {"base": BASE, "checks": []}
    admin_auth = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    assert admin_auth.user.get("role") == "admin", admin_auth.user
    admin_id = admin_auth.user.get("id")
    evidence["admin_login"] = {"id": admin_id, "email": admin_auth.user.get("email"), "role": admin_auth.user.get("role")}

    # Auth/me sanity from auth checklist.
    me_r = req("GET", "/api/auth/me", token=admin_auth.token)
    assert me_r.status_code == 200, f"/auth/me admin failed: {me_r.status_code} {me_r.text}"
    assert me_r.json().get("id") == admin_id
    evidence["checks"].append("admin /api/auth/me returns same id")

    list_r = req("GET", "/api/customer-profile/list", token=admin_auth.token)
    assert list_r.status_code == 200, f"list failed: {list_r.status_code} {list_r.text}"
    users = list_r.json().get("users") or []
    assert users, "profile list is empty"
    first = users[0]
    assert first.get("id") == admin_id, f"first profile list row is not admin: first={first}, admin_id={admin_id}"
    assert first.get("role") == "admin", f"first profile row role is not admin: {first}"
    clients = [u for u in users if u.get("role") != "admin"]
    assert clients, f"no client rows in list; users={users}"
    evidence["profile_list"] = {
        "count": len(users),
        "first": {k: first.get(k) for k in ("id", "email", "role", "full_name", "customer_name", "site_name")},
        "clients": [{k: u.get(k) for k in ("id", "email", "role", "full_name", "customer_name", "site_name")} for u in clients],
    }
    evidence["checks"].append("GET /api/customer-profile/list returns admin first and client(s) after")

    client_from_list = clients[0]
    client_id = client_from_list["id"]

    # Admin default profile endpoint should be admin profile; chosen client should be different.
    admin_profile_r = req("GET", f"/api/customer-profile/{admin_id}", token=admin_auth.token)
    client_profile_r = req("GET", f"/api/customer-profile/{client_id}", token=admin_auth.token)
    assert admin_profile_r.status_code == 200, admin_profile_r.text
    assert client_profile_r.status_code == 200, client_profile_r.text
    admin_profile = admin_profile_r.json()
    client_profile = client_profile_r.json()
    assert admin_profile.get("id") == admin_id and admin_profile.get("role") == "admin"
    assert client_profile.get("id") == client_id and client_profile.get("id") != admin_id
    client_display = client_profile.get("customer_name") or client_profile.get("full_name") or client_profile.get("email")
    evidence["direct_profiles"] = {
        "admin": {k: admin_profile.get(k) for k in ("id", "email", "role", "full_name", "customer_name", "site_name", "notes")},
        "client": {k: client_profile.get(k) for k in ("id", "email", "role", "full_name", "customer_name", "site_name", "notes")},
        "client_display": client_display,
    }
    evidence["checks"].append("admin and client profile records are distinct")

    # Persistence/isolation: save admin note, verify client unchanged, then restore.
    original_admin_subset = profile_subset(admin_profile)
    original_client_subset = profile_subset(client_profile)
    marker = f"bugverify-admin-own-record-{int(time.time())}"
    try:
        payload = dict(original_admin_subset)
        payload["notes"] = marker
        updated_admin = put_profile(admin_auth.token, admin_id, payload)
        assert updated_admin.get("notes") == marker, f"admin save did not persist marker: {updated_admin.get('notes')}"
        reread_admin = req("GET", f"/api/customer-profile/{admin_id}", token=admin_auth.token).json()
        reread_client = req("GET", f"/api/customer-profile/{client_id}", token=admin_auth.token).json()
        assert reread_admin.get("notes") == marker, "admin marker missing after reread"
        assert reread_client.get("notes") == original_client_subset.get("notes"), (
            f"client notes changed while saving admin; before={original_client_subset.get('notes')!r}, after={reread_client.get('notes')!r}"
        )
        evidence["admin_save_isolation"] = {
            "admin_id": admin_id,
            "client_id_checked": client_id,
            "marker_persisted": marker,
            "client_notes_unchanged": True,
        }
        evidence["checks"].append("admin profile PUT persists to admin id and does not affect selected client")
    finally:
        try:
            put_profile(admin_auth.token, admin_id, original_admin_subset)
        except Exception as e:
            evidence["restore_error"] = repr(e)

    # Client login regression: no list access and /customer-profile is own id.
    client_auth = login(CLIENT_EMAIL, CLIENT_PASSWORD)
    assert client_auth.user.get("role") == "client", client_auth.user
    client_me = req("GET", "/api/customer-profile", token=client_auth.token)
    assert client_me.status_code == 200, f"client own profile failed: {client_me.status_code} {client_me.text}"
    assert client_me.json().get("id") == client_auth.user.get("id"), "client /customer-profile did not return own profile"
    client_list = req("GET", "/api/customer-profile/list", token=client_auth.token)
    assert client_list.status_code == 403, f"client should not access picker list; got {client_list.status_code} {client_list.text}"
    evidence["client_regression_api"] = {
        "client_login": {"id": client_auth.user.get("id"), "email": client_auth.user.get("email"), "role": client_auth.user.get("role")},
        "own_profile_id": client_me.json().get("id"),
        "list_status": client_list.status_code,
    }
    evidence["checks"].append("client receives only own profile via API and cannot access admin picker list")

    print(json.dumps(evidence, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AssertionError as e:
        print(json.dumps({"base": BASE, "error": str(e)}, indent=2), file=sys.stderr)
        raise SystemExit(1)
