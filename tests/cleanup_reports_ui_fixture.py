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
tok=r.json()['access_token']
r=requests.delete(BASE+'/api/instrument-registry/BUGVERIFY_UI_FM_260724', headers={'Authorization':f'Bearer {tok}'}, timeout=30)
print(r.status_code, r.text[:500])
