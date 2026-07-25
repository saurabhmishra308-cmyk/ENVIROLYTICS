#!/usr/bin/env python3
"""Seed deterministic Customer Profile users for the admin-note regression check."""
import json
import os
import time
from pathlib import Path

import requests


ROOT = Path('/app')
FRONTEND_ENV = ROOT / 'frontend' / '.env'
STATE_PATH = ROOT / 'test_reports' / 'customer_profile_note_seed_state.json'


def read_backend_url():
    for line in FRONTEND_ENV.read_text().splitlines():
        if line.startswith('REACT_APP_BACKEND_URL='):
            return line.split('=', 1)[1].strip().rstrip('/')
    return os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


def request(session, method, url, **kwargs):
    resp = session.request(method, url, timeout=30, **kwargs)
    try:
        body = resp.json()
    except Exception:
        body = resp.text[:500]
    if resp.status_code >= 400:
        raise RuntimeError(f'{method} {url} failed {resp.status_code}: {body}')
    return body


def main():
    base = read_backend_url()
    if not base:
        raise SystemExit('Could not determine REACT_APP_BACKEND_URL')
    api = f'{base}/api'
    s = requests.Session()

    login = request(s, 'POST', f'{api}/auth/login', json={
        'email': 'admin@envirolytics.com',
        'password': 'Admin@Envirolytics2026',
    })
    token = login['access_token']
    s.headers.update({'Authorization': f'Bearer {token}'})

    suffix = f'{int(time.time())}'
    wq_email = f'cp-note-wq-{suffix}@example.com'
    gw_email = f'cp-note-gw-{suffix}@example.com'

    created_users = []
    created_instruments = []

    def create_user(email, full_name, company):
        body = request(s, 'POST', f'{api}/admin/users/create', json={
            'email': email,
            'password': 'Client@Test2026',
            'full_name': full_name,
            'role': 'client',
            'company_name': company,
            'location_name': 'QA Preview',
        })
        user = body['user']
        created_users.append(user['id'])
        return user

    wq_user = create_user(wq_email, f'QA WQ Only {suffix}', f'QA WQ Only Co {suffix}')
    gw_user = create_user(gw_email, f'QA Groundwater {suffix}', f'QA Groundwater Co {suffix}')

    wq_hw = f'CP_NOTE_WQ_{suffix}'
    gw_hw = f'CP_NOTE_FM_{suffix}'

    request(s, 'POST', f'{api}/instrument-registry', json={
        'hardware_id': wq_hw,
        'instrument_type': 'wq_stp',
        'owner_user_id': wq_user['id'],
        'label': f'QA WQ STP {suffix}',
        'location_name': 'QA WQ Site',
        'source': 'http',
    })
    created_instruments.append(wq_hw)

    request(s, 'POST', f'{api}/instrument-registry', json={
        'hardware_id': gw_hw,
        'instrument_type': 'flowmeter',
        'owner_user_id': gw_user['id'],
        'label': f'QA Flowmeter {suffix}',
        'location_name': 'QA GW Site',
        'category': 'groundwater_abstraction',
        'source': 'http',
    })
    created_instruments.append(gw_hw)

    # API sanity proof for the UI expectations.
    admin_profile = request(s, 'GET', f'{api}/customer-profile/{login["user"]["id"]}')
    wq_profile = request(s, 'GET', f'{api}/customer-profile/{wq_user["id"]}')
    gw_profile = request(s, 'GET', f'{api}/customer-profile/{gw_user["id"]}')

    state = {
        'backend_url': base,
        'frontend_url': base,
        'admin_id': login['user']['id'],
        'wq_user': wq_user,
        'gw_user': gw_user,
        'wq_hw': wq_hw,
        'gw_hw': gw_hw,
        'created_users': created_users,
        'created_instruments': created_instruments,
        'api_expectations': {
            'admin_role': admin_profile.get('role'),
            'admin_instruments_by_type': admin_profile.get('instruments_by_type'),
            'wq_instruments_by_type': wq_profile.get('instruments_by_type'),
            'gw_instruments_by_type': gw_profile.get('instruments_by_type'),
        },
    }
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, indent=2))
    print(json.dumps(state, indent=2))


if __name__ == '__main__':
    main()