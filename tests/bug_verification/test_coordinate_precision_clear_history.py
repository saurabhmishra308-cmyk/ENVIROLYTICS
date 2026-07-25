#!/usr/bin/env python3
"""
Focused bug-verification helper for coordinate precision and clear-history ISO variants.
Creates a client/instrument through real API, verifies coordinate precision round-trip,
seeds two readings with Z/+00:00 received_at, verifies clear-history deletes both,
and cleans up seeded data.
"""
import json
import os
import sys
import time
from datetime import datetime, timezone

import requests
from pymongo import MongoClient

BACKEND = os.environ.get("REACT_APP_BACKEND_URL", "https://envirolytics-hub.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@envirolytics.com"
ADMIN_PASSWORD = "Admin@Envirolytics2026"
HW = f"QA_COORD_{int(time.time())}"
IMEI = str(990000000000000 + int(time.time()) % 100000)
CLIENT_EMAIL = f"qa-coord-{int(time.time())}@example.com"
CLIENT_PASSWORD = "Client@Test2026"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

summary = {"backend": BACKEND, "hardware_id": HW, "client_email": CLIENT_EMAIL, "steps": []}

def step(name, ok, detail=None):
    summary["steps"].append({"name": name, "ok": bool(ok), "detail": detail})
    print(f"[{'PASS' if ok else 'FAIL'}] {name}: {detail if detail is not None else ''}")
    if not ok:
        raise AssertionError(f"{name}: {detail}")

sess = requests.Session()
headers = {}
client = MongoClient(MONGO_URL)
db = client[DB_NAME]
client_id = None
try:
    r = sess.post(f"{BACKEND}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    step("admin login", r.status_code == 200, {"status": r.status_code, "body": r.text[:200]})
    token = r.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Ensure a client owner exists. Prefer API if exposed; fallback to existing test client.
    users = sess.get(f"{BACKEND}/api/admin/users/list", headers=headers, timeout=30)
    step("list users", users.status_code == 200, {"status": users.status_code})
    existing_clients = [u for u in users.json().get("users", []) if u.get("role") == "client"]
    if existing_clients:
        client_id = existing_clients[0]["id"]
        summary["owner_source"] = "existing_client"
    else:
        # Inspect common create-user shape by trying admin users endpoint.
        payload = {"email": CLIENT_EMAIL, "password": CLIENT_PASSWORD, "full_name": "QA Coordinate Client", "role": "client", "is_active": True}
        cr = sess.post(f"{BACKEND}/api/admin/users", headers=headers, json=payload, timeout=30)
        step("create fallback client", cr.status_code in (200, 201), {"status": cr.status_code, "body": cr.text[:300]})
        data = cr.json()
        client_id = data.get("user", data).get("id")
        summary["owner_source"] = "created_client"
    step("client owner selected", bool(client_id), {"client_id": client_id})

    create_payload = {
        "hardware_id": HW,
        "instrument_type": "flowmeter",
        "owner_user_id": client_id,
        "label": "QA Precision Flowmeter",
        "location_name": "QA GPS Precision Point",
        "latitude": 28.6448723,
        "longitude": 77.2166534,
        "category": "groundwater_abstraction",
        "imei": IMEI,
    }
    cr = sess.post(f"{BACKEND}/api/instrument-registry", headers=headers, json=create_payload, timeout=30)
    step("create instrument with 7 decimal coordinates", cr.status_code == 200, {"status": cr.status_code, "body": cr.text[:300]})
    cinst = cr.json().get("instrument", {})
    step("create response preserves coordinate precision", abs(cinst.get("latitude") - 28.6448723) < 1e-10 and abs(cinst.get("longitude") - 77.2166534) < 1e-10, {"latitude": cinst.get("latitude"), "longitude": cinst.get("longitude")})

    lr = sess.get(f"{BACKEND}/api/instrument-registry", headers=headers, timeout=30)
    step("list instruments after create", lr.status_code == 200, {"status": lr.status_code})
    item = next((i for i in lr.json().get("instruments", []) if i.get("hardware_id") == HW), None)
    step("created instrument appears in list", bool(item), item)
    step("list round-trips >=6 decimal precision", abs(item.get("latitude") - 28.6448723) < 1e-10 and abs(item.get("longitude") - 77.2166534) < 1e-10, {"latitude": item.get("latitude"), "longitude": item.get("longitude")})

    upd_payload = {"latitude": 28.644999, "longitude": 77.216999, "location_name": "QA GPS Precision Edited"}
    ur = sess.put(f"{BACKEND}/api/instrument-registry/{HW}", headers=headers, json=upd_payload, timeout=30)
    step("edit instrument coordinates to 6 decimals", ur.status_code == 200, {"status": ur.status_code, "body": ur.text[:300]})
    lr2 = sess.get(f"{BACKEND}/api/instrument-registry", headers=headers, timeout=30)
    item2 = next((i for i in lr2.json().get("instruments", []) if i.get("hardware_id") == HW), None)
    step("edited coordinates persist to 6 decimals", bool(item2) and abs(item2.get("latitude") - 28.644999) < 1e-10 and abs(item2.get("longitude") - 77.216999) < 1e-10, {"latitude": item2.get("latitude") if item2 else None, "longitude": item2.get("longitude") if item2 else None})

    # Seed clear-history regression rows in both collections to prove both formats match.
    for coll_name in ["flowmeter_readings", "instrument_readings"]:
        db[coll_name].insert_many([
            {"hardware_id": HW, "received_at": "2026-07-24T18:34:17Z", "timestamp": "2026-07-24T18:34:17Z", "qa_seed": True, "value": 1},
            {"hardware_id": HW, "received_at": "2026-07-24T18:34:17+00:00", "timestamp": "2026-07-24T18:34:17+00:00", "qa_seed": True, "value": 2},
        ])
    before_counts = {c: db[c].count_documents({"hardware_id": HW, "qa_seed": True}) for c in ["flowmeter_readings", "instrument_readings"]}
    step("seeded Z and +00:00 readings", before_counts == {"flowmeter_readings": 2, "instrument_readings": 2}, before_counts)
    clr = sess.post(f"{BACKEND}/api/instrument-registry/{HW}/clear-history", headers=headers, json={"to_ts": "2026-07-24T18:34:17"}, timeout=30)
    step("clear-history API returns success", clr.status_code == 200 and clr.json().get("success"), {"status": clr.status_code, "body": clr.text[:500]})
    after_counts = {c: db[c].count_documents({"hardware_id": HW, "qa_seed": True}) for c in ["flowmeter_readings", "instrument_readings"]}
    step("clear-history deleted both ISO variants from both reading collections", after_counts == {"flowmeter_readings": 0, "instrument_readings": 0}, {"before": before_counts, "after": after_counts, "api": clr.json()})

    summary["verdict"] = "passed"
except Exception as e:
    summary["verdict"] = "failed"
    summary["error"] = str(e)
    raise
finally:
    # cleanup seeded data and instrument; do not fail the run on cleanup errors
    cleanup = {}
    try:
        if headers:
            dr = sess.delete(f"{BACKEND}/api/instrument-registry/{HW}", headers=headers, timeout=30)
            cleanup["delete_instrument_status"] = dr.status_code
            cleanup["delete_instrument_body"] = dr.text[:300]
    except Exception as ce:
        cleanup["delete_instrument_error"] = str(ce)
    try:
        for coll_name in ["flowmeter_readings", "instrument_readings", "flowmeter_latest", "instrument_latest", "flowmeter_categories"]:
            cleanup[coll_name] = db[coll_name].delete_many({"hardware_id": HW}).deleted_count
    except Exception as ce:
        cleanup["mongo_cleanup_error"] = str(ce)
    summary["cleanup"] = cleanup
    out = "/app/test_reports/coordinate_precision_clear_history_backend.json"
    with open(out, "w") as f:
        json.dump(summary, f, indent=2, default=str)
    print(json.dumps(summary, indent=2, default=str))
