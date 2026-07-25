#!/usr/bin/env python3
"""Seed focused fixtures for iteration 18 bug verification.

Creates one disposable client, one instrument with an instrument photograph,
and two additional instruments for the UI bulk-delete test.
"""
import json
import os
import time
from pathlib import Path

import requests


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://envirolytics-hub.preview.emergentagent.com").rstrip("/")
OUT = Path("/app/test_reports/iteration_18_setup.json")
ADMIN_EMAIL = "admin@envirolytics.com"
ADMIN_PASSWORD = "Admin@Envirolytics2026"
CLIENT_PASSWORD = "Client@Test2026"


def api(path: str) -> str:
    return f"{BASE_URL}{path}"


def login(email: str, password: str) -> tuple[str, dict]:
    r = requests.post(api("/api/auth/login"), json={"email": email, "password": password}, timeout=20)
    r.raise_for_status()
    data = r.json()
    return data["access_token"], data["user"]


def main():
    run_id = f"it18{int(time.time())}"
    admin_token, admin_user = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    client_email = f"{run_id}@qa.envirolytics.com"
    client_payload = {
        "email": client_email,
        "password": CLIENT_PASSWORD,
        "full_name": f"Iteration 18 QA Client {run_id}",
        "role": "client",
        "company_name": f"QA Company {run_id}",
        "location_name": "QA Preview Site",
        "latitude": 28.6139,
        "longitude": 77.2090,
    }
    r = requests.post(api("/api/admin/users/create"), headers=admin_headers, json=client_payload, timeout=20)
    r.raise_for_status()
    client = r.json()["user"]

    hardware_ids = {
        "photo": f"QAIPH{run_id.upper()}",
        "bulk1": f"QABULK1{run_id.upper()}",
        "bulk2": f"QABULK2{run_id.upper()}",
    }
    created_instruments = []
    for key, hw in hardware_ids.items():
        payload = {
            "hardware_id": hw,
            "instrument_type": "flowmeter" if key != "bulk2" else "dwlr",
            "owner_user_id": client["id"],
            "label": f"{key} fixture {run_id}",
            "location_name": f"QA {key} location",
            "latitude": 28.61,
            "longitude": 77.20,
            "category": "groundwater_abstraction",
        }
        r = requests.post(api("/api/instrument-registry"), headers=admin_headers, json=payload, timeout=20)
        r.raise_for_status()
        created_instruments.append(r.json()["instrument"])

    # Small valid JPEG (1x1 pixel) for the photograph gallery.
    jpeg_bytes = bytes.fromhex(
        "ffd8ffe000104a46494600010101006000600000ffdb004300"
        "0302020302020303030304030304050805050404050a07070608"
        "0c0a0c0c0b0a0b0b0d0e12100d0e110e0b0b101610111314151515"
        "0c0f171816141812141514ffdb0043010304040504050905050914"
        "0d0b0d141414141414141414141414141414141414141414141414"
        "1414141414141414141414141414141414141414141414141414ffc0"
        "0011080001000103012200021101031101ffc4001400010000000000"
        "00000000000000000000000008ffc400141001000000000000000000"
        "000000000000000000ffda000c03010002110311003f00b2c001ffd9"
    )
    files = {"file": ("qa-photo.jpg", jpeg_bytes, "image/jpeg")}
    data = {
        "hardware_id": hardware_ids["photo"],
        "location_name": "QA Photo Location",
        "latitude": "28.610001",
        "longitude": "77.200001",
        "landmark": "QA landmark",
        "caption": f"QA lightbox photo {run_id}",
    }
    r = requests.post(api("/api/instrument-photos"), headers=admin_headers, data=data, files=files, timeout=20)
    r.raise_for_status()
    photo = r.json()

    fixture = {
        "base_url": BASE_URL,
        "run_id": run_id,
        "admin": {"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD, "id": admin_user["id"]},
        "client": {"id": client["id"], "email": client_email, "password": CLIENT_PASSWORD},
        "hardware_ids": hardware_ids,
        "photo_id": photo["id"],
        "certificate_note": f"iteration18 certificate owner proof {run_id}",
        "certificate_filename": f"iteration18-cert-{run_id}.pdf",
        "created": {
            "user_ids": [client["id"]],
            "instrument_ids": list(hardware_ids.values()),
            "photo_ids": [photo["id"]],
            "certificate_ids": [],
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(fixture, indent=2))
    print(json.dumps({"ok": True, "fixture": fixture}, indent=2))


if __name__ == "__main__":
    main()