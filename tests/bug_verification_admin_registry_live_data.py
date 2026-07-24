#!/usr/bin/env python3
"""Focused verification for admin registry/data cleanup/live timestamp bug.
Does not create replacement users; if required testclient is absent, client-flow checks fail.
"""
import json
import sys
from datetime import datetime
from pathlib import Path

import requests
from pymongo import MongoClient

ROOT = Path('/app')

def read_env(path):
    out = {}
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        out[k] = v.strip().strip('"').strip("'")
    return out

BASE = read_env('/app/frontend/.env')['REACT_APP_BACKEND_URL'].rstrip('/')
benv = read_env('/app/backend/.env')
db = MongoClient(benv['MONGO_URL'])[benv['DB_NAME']]

ADMIN_EMAIL = 'admin@envirolytics.com'
ADMIN_PASS = 'Admin@Envirolytics2026'
CLIENT_EMAIL = 'testclient@envirolytics.com'
CLIENT_PASS = 'Client@Test2026'

results = []

def record(name, ok, details=None):
    results.append({'name': name, 'ok': bool(ok), 'details': details or {}})
    print(('PASS' if ok else 'FAIL'), name, json.dumps(details or {}, default=str))


def req(method, path, token=None, **kwargs):
    headers = kwargs.pop('headers', {}) or {}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    return requests.request(method, BASE + path, headers=headers, timeout=30, **kwargs)


def body(resp):
    try:
        return resp.json()
    except Exception:
        return resp.text[:500]


def login(email, password):
    r = req('POST', '/api/auth/login', json={'email': email, 'password': password})
    if r.status_code != 200:
        return None, None, r
    data = r.json()
    return data['access_token'], data['user'], r

# cleanup only our prior interrupted fixtures
for hw in ['BUGVERIFY_FM_260724', 'BUGVERIFY_DWLR_260724', 'BUGVERIFY_CLIENT_BLOCKED']:
    db.instrument_registry.delete_many({'hardware_id': hw})
    db.flowmeter_readings.delete_many({'hardware_id': hw})
    db.flowmeter_latest.delete_many({'hardware_id': hw})
    db.instrument_readings.delete_many({'hardware_id': hw})
    db.instrument_latest.delete_many({'hardware_id': hw})
    db.flowmeter_categories.delete_many({'hardware_id': hw})

admin_token, admin_user, admin_login_resp = login(ADMIN_EMAIL, ADMIN_PASS)
client_token, client_user, client_login_resp = login(CLIENT_EMAIL, CLIENT_PASS)
record('admin login works', admin_token is not None, {'status': admin_login_resp.status_code, 'body': body(admin_login_resp)})
record('required testclient login works', client_token is not None, {'status': client_login_resp.status_code, 'body': body(client_login_resp)})
if not admin_token:
    Path('/app/test_reports/bug_verification_api_results.json').write_text(json.dumps({'base_url': BASE, 'results': results, 'all_ok': False}, indent=2, default=str))
    sys.exit(1)

users = list(db.users.find({}, {'_id': 0, 'email': 1, 'id': 1, 'role': 1, 'is_active': 1}))
user_emails = sorted(u['email'] for u in users)
record('initial exactly admin + testclient users', user_emails == [ADMIN_EMAIL, CLIENT_EMAIL], {'users': users, 'count': len(users)})

r = req('GET', '/api/instrument-registry', admin_token)
record('initial admin registry count zero', r.status_code == 200 and r.json().get('count') == 0, {'status': r.status_code, 'body': body(r)})

r = req('GET', '/api/water-quality/latest', admin_token)
wqb = body(r)
record('initial water-quality latest empty arrays', r.status_code == 200 and wqb.get('stp') == [] and wqb.get('do') == [] and wqb.get('chlorine') == [], {'status': r.status_code, 'body': wqb})

coll_counts = {c: db[c].count_documents({}) for c in ['instrument_readings', 'instrument_latest', 'flowmeter_readings', 'flowmeter_latest']}
record('initial readings/latest collections empty', all(v == 0 for v in coll_counts.values()), coll_counts)

# Admin-owned flowmeter fixture verifies create/duplicate/ingest/delete cascade even when testclient is absent.
fm_hw = 'BUGVERIFY_FM_260724'
fm_payload = {
    'hardware_id': fm_hw,
    'instrument_type': 'flowmeter',
    'owner_user_id': admin_user['id'],
    'label': 'BugVerify Real Flowmeter',
    'location_name': 'BugVerify Live Site',
    'category': 'groundwater_abstraction',
    'imei': 'BUGVERIFYIMEIFM260724',
}
r = req('POST', '/api/instrument-registry', admin_token, json=fm_payload)
created_fm = r.status_code == 200 and body(r).get('success') is True
fm_device_key = body(r).get('instrument', {}).get('device_key') if r.status_code == 200 else None
record('admin can register real flowmeter', created_fm, {'status': r.status_code, 'body': body(r)})

r_dup = req('POST', '/api/instrument-registry', admin_token, json=fm_payload)
record('duplicate hardware_id POST returns 409', r_dup.status_code == 409, {'status': r_dup.status_code, 'body': body(r_dup)})

if fm_device_key:
    r_ing = req('POST', '/api/devices/ingest', headers={'X-Hardware-Id': fm_hw, 'X-Device-Key': fm_device_key}, json={'TIME': '260703135219', 'IMEI': fm_payload['imei'], 'SIGNAL': 22, 'FLOW': 3600, 'TOT1': 10, 'TOT2': 0, 'RTOT1': 1, 'RTOT2': 0, 'UNT': 2, 'POW': 1, 'TEMPER': 27.5, 'VER': 'QA'})
    counts_after_ingest = {'flowmeter_readings': db.flowmeter_readings.count_documents({'hardware_id': fm_hw}), 'flowmeter_latest': db.flowmeter_latest.count_documents({'hardware_id': fm_hw})}
    latest_flow = db.flowmeter_latest.find_one({'hardware_id': fm_hw}, {'_id': 0})
    record('flowmeter live ingest stores vendor TIME ISO UTC and creates latest', r_ing.status_code == 200 and counts_after_ingest['flowmeter_readings'] >= 1 and counts_after_ingest['flowmeter_latest'] == 1 and latest_flow and latest_flow.get('timestamp') == '2026-07-03T13:52:19+00:00', {'status': r_ing.status_code, 'body': body(r_ing), 'counts': counts_after_ingest, 'timestamp': latest_flow.get('timestamp') if latest_flow else None})

r_del = req('DELETE', f'/api/instrument-registry/{fm_hw}', admin_token)
post_delete_counts = {'registry': db.instrument_registry.count_documents({'hardware_id': fm_hw}), 'flowmeter_readings': db.flowmeter_readings.count_documents({'hardware_id': fm_hw}), 'flowmeter_latest': db.flowmeter_latest.count_documents({'hardware_id': fm_hw}), 'flowmeter_categories': db.flowmeter_categories.count_documents({'hardware_id': fm_hw})}
record('admin delete flowmeter cascades registry/readings/latest/categories', r_del.status_code == 200 and all(v == 0 for v in post_delete_counts.values()), {'status': r_del.status_code, 'body': body(r_del), 'counts': post_delete_counts})

# DWLR timestamp + unknown IMEI.
dwlr_hw = 'BUGVERIFY_DWLR_260724'
dwlr_payload = {'hardware_id': dwlr_hw, 'instrument_type': 'dwlr', 'owner_user_id': admin_user['id'], 'label': 'BugVerify DWLR', 'location_name': 'BugVerify Admin Site', 'imei': 'BUGVERIFYIMEIDWLR260724', 'manual_water_temp_c': 24.2}
r = req('POST', '/api/instrument-registry', admin_token, json=dwlr_payload)
record('admin can register DWLR', r.status_code == 200 and body(r).get('success') is True, {'status': r.status_code, 'body': body(r)})

sim_payload = {'TIME': '260703135219', 'IMEI': dwlr_payload['imei'], 'LVL': '4.56', 'SIGNAL': '21', 'WTEMP': '22.1', 'ATEMP': '28.5', 'BVOLT': '5.01'}
r_sim = req('POST', '/api/devices/mqtt-simulate', admin_token, json={'topic': 'PBUGVERIFY/0', 'payload': sim_payload})
latest = db.instrument_latest.find_one({'hardware_id': dwlr_hw, 'instrument_type': 'dwlr'}, {'_id': 0})
ts = latest.get('timestamp') if latest else None
parseable = False
try:
    parseable = datetime.fromisoformat((ts or '').replace('Z', '+00:00')).tzinfo is not None
except Exception:
    pass
record('DWLR MQTT simulation stores vendor TIME as ISO UTC timestamp', r_sim.status_code == 200 and body(r_sim).get('dispatched') is True and ts == '2026-07-03T13:52:19+00:00' and parseable, {'status': r_sim.status_code, 'body': body(r_sim), 'stored_timestamp': ts})

unknown_imei = 'BUGVERIFY_UNKNOWN_IMEI_260724'
r_unk = req('POST', '/api/devices/mqtt-simulate', admin_token, json={'topic': 'PUNKNOWN/0', 'payload': {'TIME': '260703135219', 'IMEI': unknown_imei, 'LVL': 9.99}})
record('unknown IMEI dropped and not auto-registered', r_unk.status_code == 200 and body(r_unk).get('dispatched') is False and db.instrument_registry.count_documents({'imei': unknown_imei}) == 0 and db.instrument_readings.count_documents({'imei': unknown_imei}) == 0 and db.flowmeter_readings.count_documents({'imei': unknown_imei}) == 0, {'status': r_unk.status_code, 'body': body(r_unk)})

# Client-dependent checks intentionally fail if required testclient missing.
if client_token and client_user:
    r_put = req('PUT', f'/api/instrument-registry/{dwlr_hw}', admin_token, json={'owner_user_id': client_user['id']})
    reg_after = db.instrument_registry.find_one({'hardware_id': dwlr_hw}, {'_id': 0})
    r_client_after = req('GET', '/api/instrument-registry', client_token)
    client_sees_after = any(x.get('hardware_id') == dwlr_hw for x in r_client_after.json().get('instruments', [])) if r_client_after.status_code == 200 else False
    record('admin reassignment to testclient works and client sees device', r_put.status_code == 200 and reg_after.get('owner_user_id') == client_user['id'] and client_sees_after, {'put_status': r_put.status_code, 'owner_after': reg_after.get('owner_user_id'), 'client_status': r_client_after.status_code})
    blocked_payload = {'hardware_id': 'BUGVERIFY_CLIENT_BLOCKED', 'instrument_type': 'flowmeter', 'owner_user_id': client_user['id']}
    r_post_client = req('POST', '/api/instrument-registry', client_token, json=blocked_payload)
    r_put_client = req('PUT', f'/api/instrument-registry/{dwlr_hw}', client_token, json={'label': 'bad'})
    r_del_client = req('DELETE', f'/api/instrument-registry/{dwlr_hw}', client_token)
    record('client registry writes POST/PUT/DELETE forbidden', r_post_client.status_code == 403 and r_put_client.status_code == 403 and r_del_client.status_code == 403, {'post': r_post_client.status_code, 'put': r_put_client.status_code, 'delete': r_del_client.status_code})
else:
    record('admin reassignment to testclient works and client sees device', False, {'blocked_by': 'required testclient missing or cannot login'})
    record('client registry writes POST/PUT/DELETE forbidden', False, {'blocked_by': 'required testclient missing or cannot login'})

r_del_dwlr = req('DELETE', f'/api/instrument-registry/{dwlr_hw}', admin_token)
dwlr_counts = {'registry': db.instrument_registry.count_documents({'hardware_id': dwlr_hw}), 'instrument_readings': db.instrument_readings.count_documents({'hardware_id': dwlr_hw}), 'instrument_latest': db.instrument_latest.count_documents({'hardware_id': dwlr_hw})}
record('admin delete DWLR cascades instrument readings/latest', r_del_dwlr.status_code == 200 and all(v == 0 for v in dwlr_counts.values()), {'status': r_del_dwlr.status_code, 'body': body(r_del_dwlr), 'counts': dwlr_counts})

final_fixture_counts = {hw: db.instrument_registry.count_documents({'hardware_id': hw}) + db.flowmeter_readings.count_documents({'hardware_id': hw}) + db.flowmeter_latest.count_documents({'hardware_id': hw}) + db.instrument_readings.count_documents({'hardware_id': hw}) + db.instrument_latest.count_documents({'hardware_id': hw}) for hw in [fm_hw, dwlr_hw, 'BUGVERIFY_CLIENT_BLOCKED']}
record('test fixture cleanup complete', all(v == 0 for v in final_fixture_counts.values()), final_fixture_counts)

summary = {'base_url': BASE, 'db': benv['DB_NAME'], 'results': results, 'all_ok': all(x['ok'] for x in results)}
Path('/app/test_reports/bug_verification_api_results.json').write_text(json.dumps(summary, indent=2, default=str))
print('RESULT_JSON /app/test_reports/bug_verification_api_results.json')
sys.exit(0 if summary['all_ok'] else 1)
