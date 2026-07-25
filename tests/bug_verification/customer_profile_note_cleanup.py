#!/usr/bin/env python3
"""Clean up deterministic Customer Profile note-regression seed data."""
import json
import os
from pathlib import Path

import requests


ROOT = Path('/app')
FRONTEND_ENV = ROOT / 'frontend' / '.env'
STATE_PATH = ROOT / 'test_reports' / 'customer_profile_note_seed_state.json'
OUT_PATH = ROOT / 'test_reports' / 'customer_profile_note_cleanup_result.json'


def read_backend_url():
    for line in FRONTEND_ENV.read_text().splitlines():
        if line.startswith('REACT_APP_BACKEND_URL='):
            return line.split('=', 1)[1].strip().rstrip('/')
    return os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


def main():
    if not STATE_PATH.exists():
        print('No seed state found; nothing to clean')
        return
    state = json.loads(STATE_PATH.read_text())
    base = state.get('backend_url') or read_backend_url()
    api = f'{base.rstrip("/")}/api'
    s = requests.Session()
    login = s.post(f'{api}/auth/login', json={
        'email': 'admin@envirolytics.com',
        'password': 'Admin@Envirolytics2026',
    }, timeout=30)
    login.raise_for_status()
    s.headers.update({'Authorization': f'Bearer {login.json()["access_token"]}'})

    results = {'deleted_instruments': [], 'deleted_users': [], 'errors': []}
    for hw in state.get('created_instruments', []):
        try:
            r = s.delete(f'{api}/instrument-registry/{hw}', timeout=30)
            results['deleted_instruments'].append({'hardware_id': hw, 'status': r.status_code, 'body': safe_body(r)})
        except Exception as exc:
            results['errors'].append(f'instrument {hw}: {exc}')
    for uid in state.get('created_users', []):
        try:
            r = s.delete(f'{api}/admin/users/{uid}', timeout=30)
            results['deleted_users'].append({'user_id': uid, 'status': r.status_code, 'body': safe_body(r)})
        except Exception as exc:
            results['errors'].append(f'user {uid}: {exc}')

    OUT_PATH.write_text(json.dumps(results, indent=2))
    print(json.dumps(results, indent=2))


def safe_body(resp):
    try:
        return resp.json()
    except Exception:
        return resp.text[:300]


if __name__ == '__main__':
    main()