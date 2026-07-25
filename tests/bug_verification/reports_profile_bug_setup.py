#!/usr/bin/env python3
import json, os, re, sys, time
from pathlib import Path
from datetime import datetime, timezone
import requests
from pymongo import MongoClient

APP = Path('/app')
FRONT_ENV = APP/'frontend/.env'
BACK_ENV = APP/'backend/.env'
OUT = APP/'test_reports/bugverify_seed_state.json'

def parse_env(path):
    d = {}
    for line in path.read_text().splitlines():
        line=line.strip()
        if not line or line.startswith('#') or '=' not in line: continue
        k,v=line.split('=',1); v=v.strip().strip('"').strip("'")
        d[k]=v
    return d

front = parse_env(FRONT_ENV); back = parse_env(BACK_ENV)
BASE = front['REACT_APP_BACKEND_URL'].rstrip('/')
MONGO_URL = back['MONGO_URL']; DB_NAME = back['DB_NAME']
ADMIN_EMAIL='admin@envirolytics.com'; ADMIN_PASSWORD='Admin@Envirolytics2026'
PREFIX = 'BUGVERIFY_20260725_'
FM = PREFIX + 'FM'
DWLR = PREFIX + 'DWLR'
STATE = {'base_url': BASE, 'hardware_ids': [FM, DWLR], 'created': [], 'errors': []}

s = requests.Session()
r = s.post(BASE+'/api/auth/login', json={'email': ADMIN_EMAIL, 'password': ADMIN_PASSWORD}, timeout=20)
r.raise_for_status()
token = r.json()['access_token']; user = r.json()['user']
s.headers.update({'Authorization': f'Bearer {token}'})
STATE['admin_user'] = user

# cleanup any prior failed seed through API first
for hw in [FM, DWLR]:
    try:
        s.delete(BASE+f'/api/instrument-registry/{hw}', timeout=20)
    except Exception as e:
        STATE['errors'].append(f'precleanup {hw}: {e}')

plist = s.get(BASE+'/api/customer-profile/list', timeout=20)
plist.raise_for_status()
users = plist.json()['users']
STATE['profile_list_first'] = users[0] if users else None
client = next((u for u in users if u.get('role') != 'admin'), None)
if not client:
    raise RuntimeError('No client user available to assign seeded instruments')
STATE['client_user'] = client
owner = client['id']

# Create registered devices so Reports dropdown + Customer Profile applicability use real backend data.
for payload in [
    {'hardware_id': FM, 'instrument_type': 'flowmeter', 'owner_user_id': owner, 'label': 'Bugverify Flowmeter Reports', 'location_name': 'Bugverify Site', 'category': 'groundwater_abstraction', 'imei': 'BUGVERIFYFM20260725'},
    {'hardware_id': DWLR, 'instrument_type': 'dwlr', 'owner_user_id': owner, 'label': 'Bugverify DWLR Local Days', 'location_name': 'Bugverify Site', 'imei': 'BUGVERIFYDWLR20260725', 'manual_water_temp_c': 22.5},
]:
    rr = s.post(BASE+'/api/instrument-registry', json=payload, timeout=20)
    if rr.status_code not in (200,201):
        raise RuntimeError(f'create instrument failed {payload["hardware_id"]}: {rr.status_code} {rr.text}')
    STATE['created'].append(payload['hardware_id'])

# Insert deterministic historical readings directly. Timestamps are chosen for Asia/Kolkata:
# 2026-07-24T17:30Z -> 24 Jul 23:00 IST; 2026-07-24T18:30Z -> 25 Jul 00:00 IST.
client_m = MongoClient(MONGO_URL)
db = client_m[DB_NAME]
for coll in ['flowmeter_readings','flowmeter_latest','instrument_readings','instrument_latest']:
    db[coll].delete_many({'hardware_id': {'$in': [FM, DWLR]}})

flow_rows = [
    ('2026-07-20T04:30:00Z', 1000.0, 0.0, 100.0),  # 20 Jul 10:00 IST, start of week/month baseline
    ('2026-07-24T17:30:00Z', 1500.0, 0.0, 110.0),  # 24 Jul 23:00 IST
    ('2026-07-24T18:30:00Z', 1750.0, 0.0, 120.0),  # 25 Jul 00:00 IST
    ('2026-08-01T04:30:00Z', 2250.0, 0.0, 130.0),  # 01 Aug 10:00 IST
]
for idx, (ts, fwd, rev, flow) in enumerate(flow_rows):
    db.flowmeter_readings.insert_one({
        'hardware_id': FM, 'imei': 'BUGVERIFYFM20260725', 'timestamp': ts,
        'received_at': f'2026-08-01T10:0{idx}:00Z',
        'flow_rate_lph': flow, 'flow_rate_lpm': flow/60.0,
        'forward_totalizer': fwd, 'reverse_totalizer': rev,
        'temperature': 25.0, 'unit_code': 2, 'unit_name': 'L', '_bugverify': True,
    })
db.flowmeter_latest.update_one({'hardware_id': FM}, {'$set': {
    'hardware_id': FM, 'timestamp': flow_rows[-1][0], 'received_at': '2026-08-01T10:04:00Z',
    'flow_rate_lph': flow_rows[-1][3], 'flow_rate_lpm': flow_rows[-1][3]/60.0,
    'forward_totalizer': flow_rows[-1][1], 'reverse_totalizer': 0.0, 'temperature': 25.0,
    'unit_code': 2, 'unit_name': 'L', '_bugverify': True,
}}, upsert=True)

dwlr_rows = [
    ('2026-07-24T17:30:00Z', 10.10),  # 24 Jul IST; same UTC date as next reading
    ('2026-07-24T18:30:00Z', 10.20),  # 25 Jul IST; old UTC bucket logic would collapse with above
]
for idx, (ts, level) in enumerate(dwlr_rows):
    doc = {
        'instrument_type': 'dwlr', 'hardware_id': DWLR, 'imei': 'BUGVERIFYDWLR20260725',
        'values': {'LEVEL': level, 'LVL': level, 'WTEMP': 21.0, 'TIME': ts},
        'timestamp': ts, 'received_at': f'2026-07-25T00:0{idx}:00Z', '_bugverify': True,
    }
    db.instrument_readings.insert_one(doc)
db.instrument_latest.update_one({'instrument_type': 'dwlr', 'hardware_id': DWLR}, {'$set': {
    'instrument_type': 'dwlr', 'hardware_id': DWLR, 'imei': 'BUGVERIFYDWLR20260725',
    'values': {'LEVEL': 10.20, 'LVL': 10.20, 'WTEMP': 21.0, 'TIME': dwlr_rows[-1][0]},
    'timestamp': dwlr_rows[-1][0], 'received_at': '2026-07-25T00:01:00Z', '_bugverify': True,
}}, upsert=True)

# API sanity checks that frontend will call.
fm_hist = s.get(BASE+f'/api/flowmeter/history/{FM}?limit=20', timeout=20); fm_hist.raise_for_status()
dwlr_hist = s.get(BASE+f'/api/instruments/dwlr/{DWLR}/history?limit=20', timeout=20); dwlr_hist.raise_for_status()
STATE['api_counts'] = {'flowmeter_history': fm_hist.json().get('count'), 'dwlr_history': dwlr_hist.json().get('count')}
OUT.write_text(json.dumps(STATE, indent=2, default=str))
print(json.dumps(STATE, indent=2, default=str))
