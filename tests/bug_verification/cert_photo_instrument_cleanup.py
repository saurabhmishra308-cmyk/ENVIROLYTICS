#!/usr/bin/env python3
"""Cleanup iteration 18 QA fixtures. Safe to re-run."""
import json
from pathlib import Path

import requests


FIXTURE = Path("/app/test_reports/iteration_18_setup.json")
OUT = Path("/app/test_reports/iteration_18_cleanup.json")


def login(base_url: str, email: str, password: str):
    r = requests.post(f"{base_url}/api/auth/login", json={"email": email, "password": password}, timeout=20)
    r.raise_for_status()
    return r.json()["access_token"]


def main():
    if not FIXTURE.exists():
        print("No fixture file; nothing to cleanup")
        return
    f = json.loads(FIXTURE.read_text())
    base_url = f["base_url"].rstrip("/")
    token = login(base_url, f["admin"]["email"], f["admin"]["password"])
    h = {"Authorization": f"Bearer {token}"}
    actions = []
    for cert_id in f.get("created", {}).get("certificate_ids", []):
        r = requests.delete(f"{base_url}/api/certificates/{cert_id}", headers=h, timeout=20)
        actions.append({"type": "certificate", "id": cert_id, "status_code": r.status_code, "ok": r.status_code in (200, 404)})
    for photo_id in f.get("created", {}).get("photo_ids", []):
        r = requests.delete(f"{base_url}/api/instrument-photos/{photo_id}", headers=h, timeout=20)
        actions.append({"type": "photo", "id": photo_id, "status_code": r.status_code, "ok": r.status_code in (200, 404)})
    for hw in f.get("created", {}).get("instrument_ids", []):
        r = requests.delete(f"{base_url}/api/instrument-registry/{hw}", headers=h, timeout=20)
        actions.append({"type": "instrument", "id": hw, "status_code": r.status_code, "ok": r.status_code in (200, 404)})
    for uid in f.get("created", {}).get("user_ids", []):
        r = requests.delete(f"{base_url}/api/admin/users/{uid}", headers=h, timeout=20)
        actions.append({"type": "user", "id": uid, "status_code": r.status_code, "ok": r.status_code in (200, 404)})

    # Verify seeded bulk instruments are absent from backend truth.
    r = requests.get(f"{base_url}/api/instrument-registry", headers=h, timeout=20)
    remaining_hw = {i.get("hardware_id") for i in r.json().get("instruments", [])} if r.ok else set()
    cleanup_ok = all(a["ok"] for a in actions) and not any(hw in remaining_hw for hw in f.get("created", {}).get("instrument_ids", []))
    result = {"ok": cleanup_ok, "actions": actions, "remaining_seed_instruments": sorted(set(f.get("created", {}).get("instrument_ids", [])) & remaining_hw)}
    OUT.write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))
    if not cleanup_ok:
        raise SystemExit(1)


if __name__ == "__main__":
    main()