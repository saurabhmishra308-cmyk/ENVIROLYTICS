#!/usr/bin/env python3
"""Seed/delete one instrument for UI coordinate precision verification."""
import json, os, sys, time, requests
from pymongo import MongoClient
BACKEND = os.environ.get('REACT_APP_BACKEND_URL','https://envirolytics-hub.preview.emergentagent.com').rstrip('/')
MONGO_URL = os.environ.get('MONGO_URL','mongodb://localhost:27017')
DB_NAME = os.environ.get('DB_NAME','test_database')
HW = os.environ.get('QA_HW','QA_UI_COORD_MARKER')
IMEI = os.environ.get('QA_IMEI','990000123456789')
MODE = sys.argv[1] if len(sys.argv)>1 else 'seed'
client = MongoClient(MONGO_URL)
db = client[DB_NAME]

def login():
    r=requests.post(BACKEND+'/api/auth/login',json={'email':'admin@envirolytics.com','password':'Admin@Envirolytics2026'},timeout=30)
    r.raise_for_status()
    return {'Authorization':'Bearer '+r.json()['access_token']}
headers=login()
if MODE == 'delete':
    try:
        dr=requests.delete(f'{BACKEND}/api/instrument-registry/{HW}',headers=headers,timeout=30)
        print(json.dumps({'delete_status':dr.status_code,'delete_body':dr.text[:300]}))
    finally:
        removed={}
        for c in ['flowmeter_readings','instrument_readings','flowmeter_latest','instrument_latest','flowmeter_categories']:
            removed[c]=db[c].delete_many({'hardware_id':HW}).deleted_count
        print(json.dumps({'mongo_removed':removed}))
    sys.exit(0)
# seed mode
users=requests.get(BACKEND+'/api/admin/users/list',headers=headers,timeout=30)
users.raise_for_status()
clients=[u for u in users.json().get('users',[]) if u.get('role')=='client']
if not clients:
    raise SystemExit('No client user available to own instrument')
owner=clients[0]['id']
# idempotent cleanup first
requests.delete(f'{BACKEND}/api/instrument-registry/{HW}',headers=headers,timeout=30)
for c in ['flowmeter_readings','instrument_readings','flowmeter_latest','instrument_latest','flowmeter_categories']:
    db[c].delete_many({'hardware_id':HW})
payload={'hardware_id':HW,'instrument_type':'flowmeter','owner_user_id':owner,'label':'QA UI Precision Marker','location_name':'QA Exact GPS Point','latitude':28.6448723,'longitude':77.2166534,'category':'groundwater_abstraction','imei':IMEI}
r=requests.post(BACKEND+'/api/instrument-registry',headers=headers,json=payload,timeout=30)
print(json.dumps({'status':r.status_code,'body':r.json() if r.headers.get('content-type','').startswith('application/json') else r.text}, default=str, indent=2))
r.raise_for_status()
