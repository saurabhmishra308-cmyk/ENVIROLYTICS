#!/usr/bin/env python3
"""Focused verification for Reports DWLR date/frequency/device-label bug.
Creates temporary DWLR + flowmeter fixtures via public APIs and emits JSON evidence.
"""
import csv
import json
import os
import re
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests
from pymongo import MongoClient

BASE = os.environ.get("REACT_APP_BACKEND_URL") or "https://envirolytics-hub.preview.emergentagent.com"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")
ADMIN_EMAIL = "admin@envirolytics.com"
ADMIN_PASSWORD = "Admin@Envirolytics2026"
DWLR_HW = "PIEZO_BUGTEST_01"
DWLR_IMEI = "999000111222333"
FLOW_HW = "FLOW_BUGTEST_01"
FLOW_IMEI = "999000111222334"
OUT = Path("/app/test_reports/bugverify_reports_dwlr_evidence.json")


def die(msg, detail=None):
    result = {"ok": False, "error": msg, "detail": detail}
    OUT.write_text(json.dumps(result, indent=2, default=str))
    print(json.dumps(result, indent=2, default=str))
    sys.exit(1)


def req(session, method, path, **kwargs):
    url = BASE.rstrip("/") + path
    r = session.request(method, url, timeout=30, **kwargs)
    if r.status_code >= 400:
        raise RuntimeError(f"{method} {path} -> {r.status_code}: {r.text[:500]}")
    ctype = r.headers.get("content-type", "")
    if "application/json" in ctype:
        return r.json()
    return r.text


def bucket_key(dt, freq):
    y, m, day = dt.year, dt.month, dt.day
    if freq == "weekly":
        d0 = datetime(y, m, day, tzinfo=timezone.utc)
        monday = d0 - timedelta(days=d0.weekday())
        return monday.date().isoformat()
    if freq == "monthly":
        return f"{y:04d}-{m:02d}"
    if freq == "quarterly":
        return f"{y:04d}-Q{((m - 1) // 3) + 1}"
    if freq == "yearly":
        return f"{y:04d}"
    return f"{y:04d}-{m:02d}-{day:02d}"


def parse_dt(r):
    raw = r.get("timestamp") or r.get("received_at") or (r.get("values") or {}).get("timestamp")
    if not raw:
        return None
    if isinstance(raw, (int, float)):
        return datetime.fromtimestamp(raw if raw < 1e12 else raw / 1000, tz=timezone.utc)
    s = str(raw).replace("Z", "+00:00")
    if "T" not in s and " " in s:
        s = s.replace(" ", "T", 1)
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def frontend_filtered(readings, start_date, end_date, frequency, section):
    s = datetime.combine(start_date.date(), datetime.min.time(), tzinfo=timezone.utc) if start_date else None
    e = datetime.combine(end_date.date(), datetime.max.time(), tzinfo=timezone.utc) if end_date else None
    with_date = []
    for r in readings:
        d = parse_dt(r)
        if d and (not s or d >= s) and (not e or d <= e):
            with_date.append((r, d))
    with_date.sort(key=lambda x: x[1])
    if section == "flowmeter":
        groups = {}
        for r, d in with_date:
            groups.setdefault(bucket_key(d, frequency), []).append((r, d))
        summaries = []
        for key, arr in groups.items():
            first, last = arr[0], arr[-1]
            init = first[0].get("forward_totalizer")
            final = last[0].get("forward_totalizer")
            summaries.append({
                "_bucket_key": key,
                "_bucket_size": len(arr),
                "hardware_id": last[0].get("hardware_id"),
                "timestamp": last[0].get("timestamp") or last[0].get("received_at"),
                "_bucket_start": first[1].isoformat(),
                "_bucket_end": last[1].isoformat(),
                "initial_forward_totalizer": init,
                "final_forward_totalizer": final,
                "forward_consumption": max(0, final - init) if init is not None and final is not None else None,
            })
        return sorted(summaries, key=lambda x: x["_bucket_end"], reverse=True)
    if frequency == "daily":
        return [r for r, _ in reversed(with_date)]
    by_bucket = {}
    for r, d in with_date:
        by_bucket[bucket_key(d, frequency)] = r
    return sorted(by_bucket.values(), key=lambda r: parse_dt(r) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)


def yymmddhhmmss(dt):
    return dt.strftime("%y%m%d%H%M%S")


def cleanup(session, db):
    for hw in (DWLR_HW, FLOW_HW):
        try:
            session.delete(BASE.rstrip("/") + f"/api/instrument-registry/{hw}", timeout=20)
        except Exception:
            pass
    # hard cleanup in case API delete failed or fixture partially created
    db.instrument_registry.delete_many({"hardware_id": {"$in": [DWLR_HW, FLOW_HW]}})
    db.instrument_readings.delete_many({"hardware_id": {"$in": [DWLR_HW, FLOW_HW]}})
    db.instrument_latest.delete_many({"hardware_id": {"$in": [DWLR_HW, FLOW_HW]}})
    db.flowmeter_readings.delete_many({"hardware_id": {"$in": [DWLR_HW, FLOW_HW]}})
    db.flowmeter_latest.delete_many({"hardware_id": {"$in": [DWLR_HW, FLOW_HW]}})
    db.flowmeter_categories.delete_many({"hardware_id": {"$in": [DWLR_HW, FLOW_HW]}})


def main():
    session = requests.Session()
    login = req(session, "POST", "/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    token = login["access_token"]
    session.headers.update({"Authorization": f"Bearer {token}"})
    admin_user_id = login["user"]["id"]

    db = MongoClient(MONGO_URL)[DB_NAME]
    cleanup(session, db)

    result = {
        "base_url": BASE,
        "skill_lookup": "No relevant testing skill found.",
        "test_plan": [
            "Seed DWLR labeled Piezometer Test with 30 readings at 15-minute intervals today.",
            "Confirm API history returns all 30 readings; emulate Reports.jsx filtering for Daily, Weekly, Monthly.",
            "Drive Reports UI as admin: DWLR tab, select fixture, date range covering today, Daily/Weekly/Monthly Filter; inspect table label, columns, row counts, order.",
            "Download professional CSV from UI and verify Device column values match friendly label only.",
            "Seed flowmeter fixture and confirm Daily/Weekly UI aggregation still produces period rows with initial/final/consumption.",
            "Cleanup PIEZO/FLOW_BUGTEST fixtures.",
        ],
        "code_review": {
            "git_status": None,
            "reports_fix": "Reports.jsx uses label||hardware_id for UI/CSV device label; non-flowmeter daily returns raw readings reversed; weekly+ buckets latest per period.",
        },
        "api_evidence": {},
        "ui_evidence": {},
        "cleanup": {},
    }

    # Create instruments
    req(session, "POST", "/api/instrument-registry", json={
        "hardware_id": DWLR_HW,
        "instrument_type": "dwlr",
        "owner_user_id": admin_user_id,
        "label": "Piezometer Test",
        "location_name": "Piezometer (Basement 2)",
        "imei": DWLR_IMEI,
        "manual_water_temp_c": 26.5,
    })
    req(session, "POST", "/api/instrument-registry", json={
        "hardware_id": FLOW_HW,
        "instrument_type": "flowmeter",
        "owner_user_id": admin_user_id,
        "label": "Flowmeter Bugtest",
        "location_name": "Flow Test Location",
        "category": "groundwater_abstraction",
        "imei": FLOW_IMEI,
    })

    # Directly seed DB with device timestamps to avoid sleeps and to test Reports history truth.
    now = datetime.now(timezone.utc)
    # keep safely within today, starting no earlier than 00:15 and ending before now
    start = now.replace(hour=8, minute=0, second=0, microsecond=0)
    if now.hour < 16:
        start = now.replace(hour=0, minute=15, second=0, microsecond=0)
    dwlr_docs = []
    for i in range(30):
        ts = start + timedelta(minutes=15 * i)
        vals = {
            "IMEI": DWLR_IMEI,
            "TIME": yymmddhhmmss(ts),
            "LEVEL": round(10.0 + i * 0.05, 3),
            "LVL": round(10.0 + i * 0.05, 3),
            "WTEMP": 0,
            "ATEMP": 25.0 + (i % 5) / 10,
            "SIGNAL": 25 + i % 4,
        }
        dwlr_docs.append({
            "instrument_type": "dwlr",
            "hardware_id": DWLR_HW,
            "imei": DWLR_IMEI,
            "values": vals,
            "timestamp": ts.isoformat(),
            "received_at": (ts + timedelta(seconds=2)).isoformat(),
        })
    db.instrument_readings.insert_many(dwlr_docs)
    db.instrument_latest.update_one({"instrument_type": "dwlr", "hardware_id": DWLR_HW}, {"$set": dwlr_docs[-1]}, upsert=True)

    flow_docs = []
    flow_start = start
    for i in range(4):
        ts = flow_start + timedelta(hours=i * 2)
        flow_docs.append({
            "hardware_id": FLOW_HW,
            "imei": FLOW_IMEI,
            "timestamp": ts.isoformat(),
            "received_at": (ts + timedelta(seconds=3)).isoformat(),
            "flow_rate_lph": 1000.0 + i * 100,
            "flow_rate_lpm": (1000.0 + i * 100) / 60,
            "forward_totalizer": 10000.0 + i * 500.0,
            "reverse_totalizer": 0.0,
            "temperature": 25.0,
            "unit_code": 2,
            "unit_name": "L",
        })
    db.flowmeter_readings.insert_many(flow_docs)
    db.flowmeter_latest.update_one({"hardware_id": FLOW_HW}, {"$set": flow_docs[-1]}, upsert=True)

    # API history evidence
    hist = req(session, "GET", f"/api/instruments/dwlr/{DWLR_HW}/history?limit=1000")
    flow_hist = req(session, "GET", f"/api/flowmeter/history/{FLOW_HW}?limit=1000")
    start_date, end_date = start, start + timedelta(minutes=15 * 29)
    result["api_evidence"].update({
        "dwlr_history_count": hist.get("count"),
        "dwlr_first_newest_timestamp": hist["readings"][0]["timestamp"] if hist.get("readings") else None,
        "dwlr_last_oldest_timestamp": hist["readings"][-1]["timestamp"] if hist.get("readings") else None,
        "dwlr_daily_filtered_count_expected_30": len(frontend_filtered(hist["readings"], start_date, end_date, "daily", "dwlr")),
        "dwlr_weekly_filtered_count_expected_1": len(frontend_filtered(hist["readings"], start_date, end_date, "weekly", "dwlr")),
        "dwlr_monthly_filtered_count_expected_1": len(frontend_filtered(hist["readings"], start_date, end_date, "monthly", "dwlr")),
        "flow_history_count": flow_hist.get("count"),
        "flow_daily_bucket_count_expected_1": len(frontend_filtered(flow_hist["readings"], start_date, end_date, "daily", "flowmeter")),
        "flow_weekly_bucket_count_expected_1": len(frontend_filtered(flow_hist["readings"], start_date, end_date, "weekly", "flowmeter")),
        "flow_daily_summary": frontend_filtered(flow_hist["readings"], start_date, end_date, "daily", "flowmeter"),
    })

    OUT.write_text(json.dumps(result, indent=2, default=str))
    print(json.dumps(result, indent=2, default=str))

    # Leave cleanup to finally after UI run? This script only API/data seeds. UI automation will cleanup by rerunning with --cleanup.


if __name__ == "__main__":
    if "--cleanup" in sys.argv:
        s = requests.Session()
        try:
            login = requests.post(BASE.rstrip("/") + "/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30).json()
            s.headers.update({"Authorization": f"Bearer {login['access_token']}"})
        except Exception:
            pass
        cleanup(s, MongoClient(MONGO_URL)[DB_NAME])
        counts = {
            "registry": MongoClient(MONGO_URL)[DB_NAME].instrument_registry.count_documents({"hardware_id": {"$in": [DWLR_HW, FLOW_HW]}}),
            "instrument_readings": MongoClient(MONGO_URL)[DB_NAME].instrument_readings.count_documents({"hardware_id": {"$in": [DWLR_HW, FLOW_HW]}}),
            "instrument_latest": MongoClient(MONGO_URL)[DB_NAME].instrument_latest.count_documents({"hardware_id": {"$in": [DWLR_HW, FLOW_HW]}}),
            "flowmeter_readings": MongoClient(MONGO_URL)[DB_NAME].flowmeter_readings.count_documents({"hardware_id": {"$in": [DWLR_HW, FLOW_HW]}}),
            "flowmeter_latest": MongoClient(MONGO_URL)[DB_NAME].flowmeter_latest.count_documents({"hardware_id": {"$in": [DWLR_HW, FLOW_HW]}}),
        }
        print(json.dumps({"cleanup_counts": counts}, indent=2))
    else:
        main()
