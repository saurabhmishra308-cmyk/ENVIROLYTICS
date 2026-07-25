#!/usr/bin/env python3
import json
from pathlib import Path
import requests
from pymongo import MongoClient

def parse_env(path):
    d = {}
    for line in Path(path).read_text().splitlines():
        line=line.strip()
        if not line or line.startswith('#') or '=' not in line: continue
        k,v=line.split('=',1); d[k]=v.strip().strip('"').strip("'")
    return d

front = parse_env('/app/frontend/.env')
back = parse_env('/app/backend/.env')
BASE = front['REACT_APP_BACKEND_URL'].rstrip('/')
HWS = ['BUGVERIFY_20260725_FM','BUGVERIFY_20260725_DWLR']
summary = {'deleted_via_api': {}, 'db_cleanup': {}}
s = requests.Session()
r = s.post(BASE + '/api/auth/login', json={'email':'admin@envirolytics.com','password':'Admin@Envirolytics2026'}, timeout=20)
r.raise_for_status()
s.headers.update({'Authorization': 'Bearer ' + r.json()['access_token']})
for hw in HWS:
    rr = s.delete(BASE + f'/api/instrument-registry/{hw}', timeout=20)
    summary['deleted_via_api'][hw] = {'status': rr.status_code, 'body': rr.text[:500]}

client = MongoClient(back['MONGO_URL'])
db = client[back['DB_NAME']]
for coll in ['instrument_registry','flowmeter_readings','flowmeter_latest','flowmeter_categories','instrument_readings','instrument_latest']:
    res = db[coll].delete_many({'hardware_id': {'$in': HWS}})
    summary['db_cleanup'][coll] = res.deleted_count
out = Path('/app/test_reports/bugverify_cleanup_result.json')
out.write_text(json.dumps(summary, indent=2))
print(json.dumps(summary, indent=2))
