#!/usr/bin/env python3
"""Edge check: clear-history should delete QA rows even if stored received_at uses Z."""
import json, os, uuid
from datetime import datetime, timezone
from pathlib import Path
import requests
from pymongo import MongoClient
APP=Path('/app')
BASE=os.environ.get('BACKEND_URL','https://envirolytics-hub.preview.emergentagent.com')
OUT=APP/'test_reports'/'reports_time_clear_history_z_bound_result.json'
PREFIX='QA_CLEAR_Z_BOUND_'

def read_env(path):
    vals={}
    for line in Path(path).read_text().splitlines():
        line=line.strip()
        if not line or line.startswith('#') or '=' not in line: continue
        k,v=line.split('=',1); vals[k]=v.strip().strip('"').strip("'")
    return vals

def db():
    env=read_env(APP/'backend/.env')
    return MongoClient(env['MONGO_URL'])[env['DB_NAME']]

def login():
    r=requests.post(BASE+'/api/auth/login',json={'email':'admin@envirolytics.com','password':'Admin@Envirolytics2026'},timeout=20)
    r.raise_for_status(); return r.json()

database=db()
for c in ['instrument_readings','instrument_latest','instrument_registry','flowmeter_readings','flowmeter_latest']:
    database[c].delete_many({'hardware_id': {'$regex': '^'+PREFIX}})
admin=login(); token=admin['access_token']; uid=admin['user']['id']
hw=PREFIX+uuid.uuid4().hex[:8]
reg={'hardware_id':hw,'instrument_type':'dwlr','owner_user_id':uid,'label':'QA Z Bound Clear','location_name':'QA','category':'piezometer','imei':'991'+uuid.uuid4().hex[:8],'manual_water_temp_c':None,'source':'mqtt','device_key':'qa','created_at':datetime.now(timezone.utc).isoformat(),'created_by':uid}
row={'instrument_type':'dwlr','hardware_id':hw,'timestamp':'2026-07-24T18:34:17Z','received_at':'2026-07-24T18:34:17Z','values':{'LEVEL':8.21,'WTEMP':24.5,'qa_marker':'z_bound'}}
database.instrument_registry.insert_one(reg); database.instrument_readings.insert_one(row)
headers={'Authorization':'Bearer '+token}
before=database.instrument_readings.count_documents({'hardware_id':hw})
r=requests.post(f'{BASE}/api/instrument-registry/{hw}/clear-history',headers=headers,json={'to_ts':'2026-07-24T18:34:17Z'},timeout=20)
after=database.instrument_readings.count_documents({'hardware_id':hw})
body=r.text[:500]
# cleanup leftovers
deleted={}
for c in ['instrument_readings','instrument_latest','instrument_registry','flowmeter_readings','flowmeter_latest']:
    deleted[c]=database[c].delete_many({'hardware_id':hw}).deleted_count
result={'hardware_id':hw,'status':r.status_code,'body':body,'before_count':before,'after_count':after,'deleted_by_endpoint': before-after, 'direct_cleanup_deleted':deleted}
OUT.write_text(json.dumps(result,indent=2)); print(json.dumps(result,indent=2))
