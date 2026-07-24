import requests
from pathlib import Path

def env(path):
    out={}
    for line in Path(path).read_text().splitlines():
        line=line.strip()
        if line and not line.startswith('#') and '=' in line:
            k,v=line.split('=',1); out[k]=v.strip().strip('"').strip("'")
    return out
BASE=env('/app/frontend/.env')['REACT_APP_BACKEND_URL'].rstrip('/')
r=requests.post(BASE+'/api/auth/login', json={'email':'admin@envirolytics.com','password':'Admin@Envirolytics2026'}, timeout=30)
r.raise_for_status()
tok=r.json()['access_token']; admin_id=r.json()['user']['id']
h={'Authorization':f'Bearer {tok}'}
hw='BUGVERIFY_UI_FM_260724'
requests.delete(BASE+f'/api/instrument-registry/{hw}', headers=h, timeout=30)
r=requests.post(BASE+'/api/instrument-registry', headers=h, json={'hardware_id':hw,'instrument_type':'flowmeter','owner_user_id':admin_id,'label':'BugVerify UI Flowmeter','location_name':'BugVerify UI Site','category':'groundwater_abstraction','imei':'BUGVERIFYUIIMEI260724'}, timeout=30)
print(r.status_code, r.text[:500])
r.raise_for_status()
