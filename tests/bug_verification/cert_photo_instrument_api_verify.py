#!/usr/bin/env python3
"""Backend/API assertions for iteration 18 bug verification."""
import json
import os
from pathlib import Path

import requests


FIXTURE = Path("/app/test_reports/iteration_18_setup.json")
OUT = Path("/app/test_reports/iteration_18_api_verify.json")


def login(base_url: str, email: str, password: str):
    r = requests.post(f"{base_url}/api/auth/login", json={"email": email, "password": password}, timeout=20)
    r.raise_for_status()
    return r.json()["access_token"], r.json()["user"]


def main():
    f = json.loads(FIXTURE.read_text())
    base_url = f["base_url"].rstrip("/")
    admin_token, _ = login(base_url, f["admin"]["email"], f["admin"]["password"])
    client_token, client_user = login(base_url, f["client"]["email"], f["client"]["password"])
    ah = {"Authorization": f"Bearer {admin_token}"}
    ch = {"Authorization": f"Bearer {client_token}"}

    results = []
    cert_id = None
    pdf_bytes = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
    upload_data = {
        "cert_type": "installation",
        "year": "2026",
        "client_id": f["client"]["id"],
        "notes": f["certificate_note"],
        "instrument_id": f["hardware_ids"]["photo"],
        "instrument_type": "flowmeter",
    }
    files = {"file": (f["certificate_filename"], pdf_bytes, "application/pdf")}
    r = requests.post(f"{base_url}/api/certificates/upload", headers=ah, data=upload_data, files=files, timeout=20)
    results.append({"name": "admin_upload_certificate_for_client", "status_code": r.status_code, "ok": r.ok, "body": r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text[:200]})
    r.raise_for_status()
    cert = r.json()["certificate"]
    cert_id = cert["id"]
    f["created"].setdefault("certificate_ids", []).append(cert_id)
    FIXTURE.write_text(json.dumps(f, indent=2))

    r = requests.get(f"{base_url}/api/certificates/list", headers=ch, params={"cert_type": "installation"}, timeout=20)
    client_certs = r.json().get("certificates", []) if r.ok else []
    results.append({
        "name": "client_can_list_attached_certificate",
        "status_code": r.status_code,
        "ok": r.ok and any(c.get("id") == cert_id and c.get("client_id") == f["client"]["id"] for c in client_certs),
        "matching_ids": [c.get("id") for c in client_certs if c.get("id") == cert_id],
    })

    r = requests.get(f"{base_url}/api/certificates/list", headers=ah, params={"cert_type": "installation"}, timeout=20)
    admin_certs = r.json().get("certificates", []) if r.ok else []
    results.append({
        "name": "admin_can_list_attached_certificate",
        "status_code": r.status_code,
        "ok": r.ok and any(c.get("id") == cert_id and c.get("client_id") == f["client"]["id"] for c in admin_certs),
        "matching_ids": [c.get("id") for c in admin_certs if c.get("id") == cert_id],
    })

    r = requests.get(f"{base_url}/api/instrument-registry", headers=ch, timeout=20)
    client_hw = {i.get("hardware_id") for i in r.json().get("instruments", [])} if r.ok else set()
    results.append({
        "name": "client_registry_contains_seeded_owned_instruments",
        "status_code": r.status_code,
        "ok": r.ok and set(f["hardware_ids"].values()).issubset(client_hw),
        "seeded": f["hardware_ids"],
    })

    r = requests.get(f"{base_url}/api/instrument-photos", headers=ch, timeout=20)
    client_photos = r.json().get("photos", []) if r.ok else []
    results.append({
        "name": "client_can_list_owned_instrument_photo",
        "status_code": r.status_code,
        "ok": r.ok and any(p.get("id") == f["photo_id"] and p.get("owner_user_id") == f["client"]["id"] for p in client_photos),
        "matching_ids": [p.get("id") for p in client_photos if p.get("id") == f["photo_id"]],
    })

    overall = all(x.get("ok") for x in results)
    OUT.write_text(json.dumps({"ok": overall, "results": results, "fixture": f}, indent=2))
    print(json.dumps({"ok": overall, "results": results}, indent=2))
    if not overall:
        raise SystemExit(1)


if __name__ == "__main__":
    main()