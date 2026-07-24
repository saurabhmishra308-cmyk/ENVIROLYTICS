import os, json, requests
from pymongo import MongoClient
BACKEND_URL = os.environ.get('BACKEND_URL') or 'https://envirolytics-hub.preview.emergentagent.com'
ADMIN_EMAIL='admin@envirolytics.com'; ADMIN_PASSWORD='Admin@Envirolytics2026'; CLIENT_EMAIL='testclient@envirolytics.com'
MONGO_URL='mongodb://localhost:27017'; DB_NAME='test_database'

def api(path): return BACKEND_URL.rstrip()+path

def j(r):
    try: return r.json()
    except Exception: return {'text': r.text[:300]}

def main():
    r=requests.post(api('/api/auth/login'), json={'email':ADMIN_EMAIL,'password':ADMIN_PASSWORD}, timeout=20)
    body=j(r); h={'Authorization':f"Bearer {body.get('access_token')}"}
    reg=j(requests.get(api('/api/instrument-registry'), headers=h, timeout=20))
    hws=[it.get('hardware_id') for it in reg.get('instruments',[]) if str(it.get('hardware_id','')).startswith('BUGVERIFY_')]
    cleanup={}
    for hw in hws:
        dr=requests.delete(api(f'/api/instrument-registry/{hw}'), headers=h, timeout=20)
        cleanup[hw]={'status':dr.status_code,'body':j(dr)}
    client=MongoClient(MONGO_URL)[DB_NAME]
    collections=['instrument_registry','flowmeter_readings','flowmeter_latest','flowmeter_categories','instrument_readings','instrument_latest']
    counts={c: client[c].count_documents({'hardware_id': {'$regex':'^BUGVERIFY_'}}) for c in collections}
    users={email: bool(client.users.find_one({'email':email},{'_id':1})) for email in (ADMIN_EMAIL,CLIENT_EMAIL)}
    out={'deleted':hws,'cleanup':cleanup,'bugverify_counts':counts,'required_users_exist':users}
    with open('/app/test_reports/bugverify_cleanup.json','w') as f: json.dump(out,f,indent=2,default=str)
    print(json.dumps(out,indent=2,default=str))
    if any(counts.values()) or not all(users.values()):
        raise SystemExit(1)
if __name__=='__main__': main()
