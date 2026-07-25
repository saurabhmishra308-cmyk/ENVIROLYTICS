#!/usr/bin/env python3
"""Cleanup admin notes marker left by UI bug verification."""
import requests
BASE = "http://localhost:8001"
ADMIN_EMAIL = "admin@envirolytics.com"
ADMIN_PASSWORD = "Admin@Envirolytics2026"
PROFILE_FIELDS = [
    "customer_name", "site_name", "unit_name", "address", "representative_name",
    "representative_designation", "representative_email", "representative_phone",
    "noc_mode", "noc_number", "noc_issue_date", "noc_validity_years", "noc_expiry_date",
    "cto_number", "cto_issue_date", "cto_expiry_date", "boreholes_permitted",
    "abstraction_borewells_count", "permitted_daily_kl", "permitted_yearly_kl",
    "piezometers_count", "rwh_structure_count", "rwh_catchment_area_sqm", "notes",
    "borewell_nocs",
]
login = requests.post(f"{BASE}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=20)
login.raise_for_status()
data = login.json()
token = data["access_token"]
uid = data["user"]["id"]
headers = {"Authorization": f"Bearer {token}"}
profile = requests.get(f"{BASE}/api/customer-profile/{uid}", headers=headers, timeout=20)
profile.raise_for_status()
payload = {k: profile.json().get(k) for k in PROFILE_FIELDS if k in profile.json()}
if isinstance(payload.get("notes"), str) and payload["notes"].startswith("ui-bugverify-admin-own-record-"):
    payload["notes"] = None
    updated = requests.put(f"{BASE}/api/customer-profile/{uid}", headers=headers, json=payload, timeout=20)
    updated.raise_for_status()
    print(f"Restored admin notes marker for {uid} to null")
else:
    print(f"No UI marker cleanup needed for {uid}; notes={payload.get('notes')!r}")
