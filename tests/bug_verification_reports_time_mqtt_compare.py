#!/usr/bin/env python3
"""Verify simulated Live MQTT traffic time aligns with Reports/history received_at."""
import json
import os
from datetime import datetime
from pathlib import Path

import requests

APP = Path('/app')
BASE_URL = os.environ.get('BACKEND_URL', 'https://envirolytics-hub.preview.emergentagent.com')
INFO_PATH = APP / 'test_reports' / 'reports_time_seed_info.json'
OUT = APP / 'test_reports' / 'reports_time_mqtt_compare_result.json'
ADMIN_EMAIL = 'admin@envirolytics.com'
ADMIN_PASSWORD = 'Admin@Envirolytics2026'


def login():
    r = requests.post(f'{BASE_URL}/api/auth/login', json={'email': ADMIN_EMAIL, 'password': ADMIN_PASSWORD}, timeout=20)
    r.raise_for_status()
    return r.json()['access_token']


def parse_iso(s):
    return datetime.fromisoformat(str(s).replace('Z', '+00:00'))


def main():
    info = json.loads(INFO_PATH.read_text())
    token = login()
    headers = {'Authorization': f'Bearer {token}'}
    payload = {
        'IMEI': info['imei'],
        'TIME': '260725183417',  # deliberately unrelated device timestamp; Reports should use received_at now
        'LEVEL': '8.33',
        'LVL': '8.33',
        'WTEMP': '24.7',
        'SIGNAL': '99',
    }
    sim = requests.post(f'{BASE_URL}/api/devices/mqtt-simulate', headers=headers, json={'topic': 'PQA/0', 'payload': payload}, timeout=20)
    traffic = requests.get(f'{BASE_URL}/api/flowmeter/traffic?limit=10', headers=headers, timeout=20)
    hist = requests.get(f'{BASE_URL}/api/instruments/dwlr/{info["hardware_id"]}/history?limit=20', headers=headers, timeout=20)
    sim.raise_for_status(); traffic.raise_for_status(); hist.raise_for_status()
    recent = traffic.json().get('recent', [])
    traffic_match = next((m for m in recent if m.get('hardware_id') == info['hardware_id'] and m.get('source') == 'simulate'), None)
    hist_match = next((r for r in hist.json().get('readings', []) if str((r.get('values') or {}).get('LEVEL')) in ('8.33', '8.33')), None)
    result = {
        'simulate_status': sim.status_code,
        'simulate_response': sim.json(),
        'traffic_match': traffic_match,
        'history_match': {k: hist_match.get(k) for k in ['hardware_id','timestamp','received_at','values']} if hist_match else None,
    }
    if traffic_match and hist_match:
        diff = abs((parse_iso(traffic_match['ts']) - parse_iso(hist_match['received_at'])).total_seconds())
        result['traffic_vs_history_received_at_seconds_diff'] = diff
        result['matches_to_second'] = int(parse_iso(traffic_match['ts']).timestamp()) == int(parse_iso(hist_match['received_at']).timestamp())
    OUT.write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))

if __name__ == '__main__':
    main()
