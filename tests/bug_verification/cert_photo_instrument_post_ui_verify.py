#!/usr/bin/env python3
"""Post-UI backend checks for iteration 18 focused verification."""
import json
from pathlib import Path

import requests


FIXTURE = Path("/app/test_reports/iteration_18_setup.json")
OUT = Path("/app/test_reports/iteration_18_post_ui_verify.json")


def login(base_url: str, email: str, password: str):
    r = requests.post(f"{base_url}/api/auth/login", json={"email": email, "password": password}, timeout=20)
    r.raise_for_status()
    return r.json()["access_token"]


def main():
    f = json.loads(FIXTURE.read_text())
    base_url = f["base_url"].rstrip("/")
    token = login(base_url, f["admin"]["email"], f["admin"]["password"])
    h = {"Authorization": f"Bearer {token}"}
    r = requests.get(f"{base_url}/api/instrument-registry", headers=h, timeout=20)
    r.raise_for_status()
    hardware = {i.get("hardware_id") for i in r.json().get("instruments", [])}
    bulk_ids = [f["hardware_ids"]["bulk1"], f["hardware_ids"]["bulk2"]]
    photo_id = f["hardware_ids"]["photo"]
    result = {
        "ok": all(hw not in hardware for hw in bulk_ids) and photo_id in hardware,
        "bulk_ids_absent_after_ui_delete": {hw: hw not in hardware for hw in bulk_ids},
        "photo_fixture_still_present_for_cleanup": photo_id in hardware,
    }
    OUT.write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))
    if not result["ok"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()