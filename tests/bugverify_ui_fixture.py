import os, json, requests
BACKEND_URL = os.environ.get('BACKEND_URL') or 'https://envirolytics-hub.preview.emergentagent.com'
ADMIN_EMAIL='admin@envirolytics.com'; ADMIN_PASSWORD='Admin@Envirolytics2026'
CLIENT_EMAIL='testclient@envirolytics.com'
CLIENT_HW='BUGVERIFY_UI_CLIENT'
ADMIN_HW='BUGVERIFY_UI_ADMIN'

def api(path): return BACKEND_URL.rstrip()+path

def j(r):
    try: return r.json()
    except Exception: return {'text': r.text[:300]}

def main():
    login = requests.post(api('/api/auth/login'), json={'email':ADMIN_EMAIL,'password':ADMIN_PASSWORD}, timeout=20)
    body = j(login); token = body.get('access_token')
    if login.status_code != 200 or not token:
        raise SystemExit(f'admin login failed {login.status_code} {body}')
    h={'Authorization':f'Bearer {token}'}
    users = j(requests.get(api('/api/admin/users/list'), headers=h, timeout=20)).get('users', [])
    admin = next(u for u in users if u.get('email') == ADMIN_EMAIL)
    client = next(u for u in users if u.get('email') == CLIENT_EMAIL)
    # Delete stale exact UI fixtures only.
    for hw in (CLIENT_HW, ADMIN_HW):
        requests.delete(api(f'/api/instrument-registry/{hw}'), headers=h, timeout=20)
    created=[]
    for hw, owner, label, loc in [
        (CLIENT_HW, client['id'], 'BUGVERIFY UI Client Flowmeter', 'BUGVERIFY UI Client Site'),
        (ADMIN_HW, admin['id'], 'BUGVERIFY UI Admin Private Flowmeter', 'BUGVERIFY UI Admin Site'),
    ]:
        payload={'hardware_id':hw,'instrument_type':'flowmeter','owner_user_id':owner,'label':label,'location_name':loc,'category':'groundwater_abstraction','source':'mqtt'}
        r=requests.post(api('/api/instrument-registry'), headers=h, json=payload, timeout=20)
        if r.status_code != 200:
            raise SystemExit(f'create {hw} failed {r.status_code} {j(r)}')
        created.append(hw)
    out={'backend_url':BACKEND_URL,'created':created,'client_hw':CLIENT_HW,'admin_hw':ADMIN_HW}
    with open('/app/test_reports/bugverify_ui_fixture.json','w') as f: json.dump(out,f,indent=2)
    print(json.dumps(out, indent=2))
if __name__=='__main__': main()
