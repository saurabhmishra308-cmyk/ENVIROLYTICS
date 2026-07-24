import os
import json
import time
import requests
from urllib.parse import urljoin

BACKEND_URL = os.environ.get('BACKEND_URL') or 'https://envirolytics-hub.preview.emergentagent.com'
ADMIN_EMAIL = 'admin@envirolytics.com'
ADMIN_PASSWORD = 'Admin@Envirolytics2026'
CLIENT_EMAIL = 'testclient@envirolytics.com'
CLIENT_PASSWORD = 'Client@Test2026'

OUT = {
    'backend_url': BACKEND_URL,
    'steps': [],
    'created_hardware_ids': [],
    'cleanup': {},
}


def record(name, passed, **details):
    item = {'name': name, 'passed': bool(passed), **details}
    OUT['steps'].append(item)
    mark = 'PASS' if passed else 'FAIL'
    print(f'[{mark}] {name}: {json.dumps(details, default=str)[:1000]}')


def api(path):
    return BACKEND_URL.rstrip('/') + path


def login(email, password):
    r = requests.post(api('/api/auth/login'), json={'email': email, 'password': password}, timeout=20)
    try:
        body = r.json()
    except Exception:
        body = {'text': r.text[:300]}
    token = body.get('access_token') if isinstance(body, dict) else None
    return r.status_code, body, {'Authorization': f'Bearer {token}'} if token else {}


def request(method, path, headers=None, **kwargs):
    return requests.request(method, api(path), headers=headers or {}, timeout=25, **kwargs)


def safe_json(resp):
    try:
        return resp.json()
    except Exception:
        return {'text': resp.text[:500]}


def registry(headers):
    r = request('GET', '/api/instrument-registry', headers=headers)
    return r, safe_json(r)


def delete_hw(hw, admin_headers):
    r = request('DELETE', f'/api/instrument-registry/{hw}', headers=admin_headers)
    return r.status_code, safe_json(r)


def main():
    admin_status, admin_body, admin_headers = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    record('admin login returns token role admin', admin_status == 200 and bool(admin_body.get('access_token')) and admin_body.get('user', {}).get('role') == 'admin', status=admin_status, user=admin_body.get('user'))
    client_status, client_body, client_headers = login(CLIENT_EMAIL, CLIENT_PASSWORD)
    record('testclient login returns access_token role client', client_status == 200 and bool(client_body.get('access_token')) and client_body.get('user', {}).get('role') == 'client', status=client_status, user=client_body.get('user'))

    if not admin_headers or not client_headers:
        with open('/app/test_reports/bugverify_client_flows_result.json', 'w') as f:
            json.dump(OUT, f, indent=2, default=str)
        print(json.dumps(OUT, indent=2))
        return 2

    # Users list and IDs
    users_r = request('GET', '/api/admin/users/list', headers=admin_headers)
    users_body = safe_json(users_r)
    users = users_body.get('users', []) if isinstance(users_body, dict) else []
    admin_user = next((u for u in users if u.get('email') == ADMIN_EMAIL), None)
    client_user = next((u for u in users if u.get('email') == CLIENT_EMAIL), None)
    record('admin and testclient exist before tests', users_r.status_code == 200 and bool(admin_user) and bool(client_user), status=users_r.status_code, admin_id=admin_user and admin_user.get('id'), client_id=client_user and client_user.get('id'), user_count=len(users))
    if not admin_user or not client_user:
        with open('/app/test_reports/bugverify_client_flows_result.json', 'w') as f:
            json.dump(OUT, f, indent=2, default=str)
        print(json.dumps(OUT, indent=2))
        return 2

    # Pre-clean stale BUGVERIFY fixtures only, so this run starts clean without touching required users.
    reg_admin_r, reg_admin_body = registry(admin_headers)
    stale = [it.get('hardware_id') for it in reg_admin_body.get('instruments', []) if str(it.get('hardware_id', '')).startswith('BUGVERIFY_')]
    for hw in stale:
        status, body = delete_hw(hw, admin_headers)
        OUT['cleanup'][f'preclean_{hw}'] = {'status': status, 'body': body}
    record('pre-cleaned stale BUGVERIFY registry fixtures only', True, stale_deleted=stale)

    # Initial client scoped registry should be zero.
    client_reg_r, client_reg_body = registry(client_headers)
    record('client-scoped registry initially count=0', client_reg_r.status_code == 200 and client_reg_body.get('count') == 0, status=client_reg_r.status_code, count=client_reg_body.get('count'), instruments=client_reg_body.get('instruments'))

    suffix = str(int(time.time()))
    hw_client = f'BUGVERIFY_CLIENT_{suffix}'
    hw_admin = f'BUGVERIFY_ADMIN_{suffix}'
    hw_reassign = f'BUGVERIFY_REASSIGN_{suffix}'
    for hw in (hw_client, hw_admin, hw_reassign):
        OUT['created_hardware_ids'].append(hw)

    # Create a client-owned device and verify client sees it.
    payload_client = {
        'hardware_id': hw_client,
        'instrument_type': 'flowmeter',
        'owner_user_id': client_user['id'],
        'label': 'BUGVERIFY Client Flowmeter',
        'location_name': 'BUGVERIFY Client Site',
        'category': 'groundwater_abstraction',
        'source': 'mqtt',
    }
    create_client_r = request('POST', '/api/instrument-registry', headers=admin_headers, json=payload_client)
    create_client_body = safe_json(create_client_r)
    record('admin can create client-owned device', create_client_r.status_code == 200 and create_client_body.get('success') is True, status=create_client_r.status_code, body=create_client_body)

    client_reg2_r, client_reg2_body = registry(client_headers)
    client_hws = [it.get('hardware_id') for it in client_reg2_body.get('instruments', [])]
    record('client-scoped registry includes newly assigned client device', client_reg2_r.status_code == 200 and hw_client in client_hws, status=client_reg2_r.status_code, count=client_reg2_body.get('count'), hardware_ids=client_hws)

    # Create admin-private device for UI scoping negative check.
    payload_admin = {
        'hardware_id': hw_admin,
        'instrument_type': 'flowmeter',
        'owner_user_id': admin_user['id'],
        'label': 'BUGVERIFY Admin Private Flowmeter',
        'location_name': 'BUGVERIFY Admin Site',
        'category': 'groundwater_abstraction',
        'source': 'mqtt',
    }
    create_admin_r = request('POST', '/api/instrument-registry', headers=admin_headers, json=payload_admin)
    record('admin can create admin-private device for scoping check', create_admin_r.status_code == 200 and safe_json(create_admin_r).get('success') is True, status=create_admin_r.status_code, body=safe_json(create_admin_r))

    # Duplicate hardware ID conflict.
    dup_r = request('POST', '/api/instrument-registry', headers=admin_headers, json=payload_client)
    record('duplicate hardware_id POST returns HTTP 409 conflict', dup_r.status_code == 409, status=dup_r.status_code, body=safe_json(dup_r))

    # Admin reassignment preserves users.
    payload_reassign = {
        'hardware_id': hw_reassign,
        'instrument_type': 'flowmeter',
        'owner_user_id': client_user['id'],
        'label': 'BUGVERIFY Reassign Device',
        'location_name': 'BUGVERIFY Reassign Site',
        'category': 'groundwater_abstraction',
        'source': 'mqtt',
    }
    create_reassign_r = request('POST', '/api/instrument-registry', headers=admin_headers, json=payload_reassign)
    put_reassign_r = request('PUT', f'/api/instrument-registry/{hw_reassign}', headers=admin_headers, json={'owner_user_id': admin_user['id']})
    users_after_r = request('GET', '/api/admin/users/list', headers=admin_headers)
    users_after = safe_json(users_after_r).get('users', [])
    admin_after = next((u for u in users_after if u.get('email') == ADMIN_EMAIL), None)
    client_after = next((u for u in users_after if u.get('email') == CLIENT_EMAIL), None)
    record('admin reassignment succeeds and neither required user is deleted', create_reassign_r.status_code == 200 and put_reassign_r.status_code == 200 and bool(admin_after) and bool(client_after), create_status=create_reassign_r.status_code, put_status=put_reassign_r.status_code, put_body=safe_json(put_reassign_r), admin_exists=bool(admin_after), client_exists=bool(client_after), user_count=len(users_after))

    # Client write-blocks.
    client_post_payload = dict(payload_client)
    client_post_payload['hardware_id'] = f'BUGVERIFY_CLIENT_FORBIDDEN_{suffix}'
    post_forbid_r = request('POST', '/api/instrument-registry', headers=client_headers, json=client_post_payload)
    put_forbid_r = request('PUT', f'/api/instrument-registry/{hw_client}', headers=client_headers, json={'label': 'Client Should Not Edit'})
    del_forbid_r = request('DELETE', f'/api/instrument-registry/{hw_client}', headers=client_headers)
    record('client POST/PUT/DELETE registry writes all return 403', post_forbid_r.status_code == 403 and put_forbid_r.status_code == 403 and del_forbid_r.status_code == 403, post_status=post_forbid_r.status_code, put_status=put_forbid_r.status_code, delete_status=del_forbid_r.status_code, post_body=safe_json(post_forbid_r), put_body=safe_json(put_forbid_r), delete_body=safe_json(del_forbid_r))

    # Client still only sees own devices, not admin private or reassigned-to-admin.
    client_reg3_r, client_reg3_body = registry(client_headers)
    client_hws3 = [it.get('hardware_id') for it in client_reg3_body.get('instruments', [])]
    record('client GET sees own device only, not admin-private/reassigned devices', client_reg3_r.status_code == 200 and hw_client in client_hws3 and hw_admin not in client_hws3 and hw_reassign not in client_hws3, status=client_reg3_r.status_code, hardware_ids=client_hws3)

    # Cleanup created fixtures, preserve users.
    for hw in OUT['created_hardware_ids']:
        status, body = delete_hw(hw, admin_headers)
        OUT['cleanup'][hw] = {'status': status, 'body': body}
    reg_final_r, reg_final_body = registry(admin_headers)
    leftovers = [it.get('hardware_id') for it in reg_final_body.get('instruments', []) if str(it.get('hardware_id', '')).startswith('BUGVERIFY_')]
    users_final_r = request('GET', '/api/admin/users/list', headers=admin_headers)
    users_final = safe_json(users_final_r).get('users', [])
    record('cleanup removed BUGVERIFY fixtures and preserved admin/testclient users', not leftovers and any(u.get('email') == ADMIN_EMAIL for u in users_final) and any(u.get('email') == CLIENT_EMAIL for u in users_final), leftovers=leftovers, cleanup=OUT['cleanup'])

    with open('/app/test_reports/bugverify_client_flows_result.json', 'w') as f:
        json.dump(OUT, f, indent=2, default=str)
    print('BUGVERIFY_BACKEND_RESULT_JSON=' + json.dumps(OUT, default=str))
    return 0 if all(s['passed'] for s in OUT['steps']) else 1

if __name__ == '__main__':
    raise SystemExit(main())
