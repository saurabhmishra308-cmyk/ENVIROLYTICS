#!/usr/bin/env python3
"""Focused verification helper for Reports.jsx time-column bug.

Modes:
  seed        Create one QA DWLR registry entry and deterministic readings.
  api_cleanup Verify clear-history admin/non-admin behavior, then remove QA data.
"""
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import requests
from pymongo import MongoClient

APP = Path('/app')
INFO_PATH = APP / 'test_reports' / 'reports_time_seed_info.json'
BASE_URL = os.environ.get('BACKEND_URL', 'https://envirolytics-hub.preview.emergentagent.com')
ADMIN_EMAIL = 'admin@envirolytics.com'
ADMIN_PASSWORD = 'Admin@Envirolytics2026'
CLIENT_EMAIL = 'testclient@envirolytics.com'
CLIENT_PASSWORD = 'Client@Test2026'
PREFIX = 'QA_DWLR_TIME_BUG_'


def read_env(path: Path):
    vals = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        vals[k] = v.strip().strip('"').strip("'")
    return vals


def db():
    env = read_env(APP / 'backend' / '.env')
    return MongoClient(env['MONGO_URL'])[env['DB_NAME']]


def login(email, password):
    r = requests.post(f'{BASE_URL}/api/auth/login', json={'email': email, 'password': password}, timeout=20)
    if r.status_code != 200:
        raise RuntimeError(f'Login failed for {email}: {r.status_code} {r.text[:300]}')
    data = r.json()
    return data['access_token'], data['user']


def cleanup_existing(database):
    hw_ids = [d['hardware_id'] for d in database.instrument_registry.find({'hardware_id': {'$regex': f'^{PREFIX}'}}, {'hardware_id': 1})]
    queries = [{'hardware_id': {'$regex': f'^{PREFIX}'}}]
    if hw_ids:
        queries.append({'hardware_id': {'$in': hw_ids}})
    removed = {}
    for coll_name in ['instrument_readings', 'instrument_latest', 'instrument_registry', 'flowmeter_readings', 'flowmeter_latest']:
        coll = database[coll_name]
        total = 0
        for q in queries[:1]:
            total += coll.delete_many(q).deleted_count
        removed[coll_name] = total
    database.audit_log.delete_many({'entity_id': {'$regex': f'^{PREFIX}'}})
    return removed


def seed():
    database = db()
    removed = cleanup_existing(database)
    admin_token, admin_user = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    # Prefer assigning to existing test client if present, otherwise admin still keeps it visible.
    owner = database.users.find_one({'email': CLIENT_EMAIL}, {'_id': 0, 'id': 1}) or {'id': admin_user['id']}
    suffix = uuid.uuid4().hex[:8]
    hardware_id = f'{PREFIX}{suffix}'
    imei = f'990{suffix[:6]}2026'
    now_iso = datetime.now(timezone.utc).isoformat()
    registry_doc = {
        'hardware_id': hardware_id,
        'instrument_type': 'dwlr',
        'owner_user_id': owner['id'],
        'label': 'QA Piezometer Basement 2 Time Bug',
        'location_name': 'QA Basement 2',
        'category': 'piezometer',
        'imei': imei,
        'manual_water_temp_c': None,
        'source': 'mqtt',
        'device_key': 'qa-device-key',
        'created_at': now_iso,
        'created_by': admin_user['id'],
    }
    readings = [
        {
            'instrument_type': 'dwlr',
            'hardware_id': hardware_id,
            'imei': imei,
            'timestamp': '2026-07-25T18:34:17',  # exact naive timestamp requested in review
            'received_at': '2026-07-25T13:04:17Z',
            'values': {'LEVEL': 8.21, 'LVL': 8.21, 'WTEMP': 24.5, 'qa_marker': 'requested_naive_timestamp'},
        },
        {
            'instrument_type': 'dwlr',
            'hardware_id': hardware_id,
            'imei': imei,
            # Deliberately conflicting naive timestamp: old Reports code would render 23:04:17 in IST;
            # fixed code must prefer received_at and render 18:34:17.
            'timestamp': '2026-07-25T23:04:17',
            'received_at': '2026-07-25T13:04:17Z',
            'values': {'LEVEL': 8.22, 'LVL': 8.22, 'WTEMP': 24.6, 'qa_marker': 'proves_received_at_preference'},
        },
        {
            'instrument_type': 'dwlr',
            'hardware_id': hardware_id,
            'imei': imei,
            'timestamp': '2026-07-24T18:00:00+00:00',
            'received_at': '2026-07-24T18:00:00+00:00',  # 23:30 IST on 24-Jul
            'values': {'LEVEL': 7.91, 'LVL': 7.91, 'WTEMP': 24.1, 'qa_marker': 'local_day_24_jul'},
        },
        {
            'instrument_type': 'dwlr',
            'hardware_id': hardware_id,
            'imei': imei,
            'timestamp': '2026-07-24T19:00:00+00:00',
            'received_at': '2026-07-24T19:00:00+00:00',  # 00:30 IST on 25-Jul
            'values': {'LEVEL': 7.92, 'LVL': 7.92, 'WTEMP': 24.2, 'qa_marker': 'local_day_25_jul_boundary'},
        },
    ]
    database.instrument_registry.insert_one(registry_doc)
    database.instrument_readings.insert_many([dict(r) for r in readings])
    # Latest cache is not needed for reports, but keep data shape realistic.
    database.instrument_latest.update_one({'instrument_type': 'dwlr', 'hardware_id': hardware_id}, {'$set': readings[0]}, upsert=True)
    info = {
        'base_url': BASE_URL,
        'hardware_id': hardware_id,
        'imei': imei,
        'admin_user_id': admin_user['id'],
        'owner_user_id': owner['id'],
        'seeded_readings': len(readings),
        'removed_before_seed': removed,
        'expected_raw_times_ist_by_level': {'8.21': '18:34:17', '8.22': '18:34:17', '7.91': '23:30:00', '7.92': '00:30:00'},
        'expected_daily_local_dates': ['24 July 2026', '25 July 2026'],
    }
    INFO_PATH.parent.mkdir(parents=True, exist_ok=True)
    INFO_PATH.write_text(json.dumps(info, indent=2))
    print(json.dumps(info, indent=2))


def api_cleanup():
    if not INFO_PATH.exists():
        raise RuntimeError(f'Missing seed info: {INFO_PATH}')
    info = json.loads(INFO_PATH.read_text())
    hardware_id = info['hardware_id']
    admin_token, _ = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    headers_admin = {'Authorization': f'Bearer {admin_token}'}
    client_status = None
    client_body = ''
    try:
        client_token, _ = login(CLIENT_EMAIL, CLIENT_PASSWORD)
        r_client = requests.post(
            f'{BASE_URL}/api/instrument-registry/{hardware_id}/clear-history',
            headers={'Authorization': f'Bearer {client_token}'},
            json={'to_ts': '2026-07-24T18:34:17Z'},
            timeout=20,
        )
        client_status, client_body = r_client.status_code, r_client.text[:300]
    except Exception as e:
        client_status, client_body = 'login_or_request_failed', str(e)

    before = requests.get(f'{BASE_URL}/api/instruments/dwlr/{hardware_id}/history?limit=20', headers=headers_admin, timeout=20)
    before_count = len(before.json().get('readings', [])) if before.status_code == 200 else None
    r_admin = requests.post(
        f'{BASE_URL}/api/instrument-registry/{hardware_id}/clear-history',
        headers=headers_admin,
        json={'to_ts': '2026-07-24T18:34:17Z'},
        timeout=20,
    )
    after = requests.get(f'{BASE_URL}/api/instruments/dwlr/{hardware_id}/history?limit=20', headers=headers_admin, timeout=20)
    after_count = len(after.json().get('readings', [])) if after.status_code == 200 else None
    api_result = {
        'non_admin_clear_history_status': client_status,
        'non_admin_clear_history_body': client_body,
        'admin_clear_history_status': r_admin.status_code,
        'admin_clear_history_body': r_admin.text[:1000],
        'history_count_before_admin_clear': before_count,
        'history_count_after_admin_clear': after_count,
    }
    database = db()
    cleanup = cleanup_existing(database)
    api_result['direct_cleanup_deleted'] = cleanup
    out = APP / 'test_reports' / 'reports_time_api_cleanup_result.json'
    out.write_text(json.dumps(api_result, indent=2))
    print(json.dumps(api_result, indent=2))


if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'seed'
    if mode == 'seed':
        seed()
    elif mode == 'api_cleanup':
        api_cleanup()
    else:
        raise SystemExit(f'Unknown mode: {mode}')
