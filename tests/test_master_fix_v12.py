"""Regression checks for the permanent Master Fix List V12.

These tests intentionally avoid requiring MongoDB or a live MQTT broker.
They protect the source-level invariants that were previously lost when
changes were not committed to GitHub.
"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def test_flowmeter_ingestion_preserves_measurement_time_and_deduplicates():
    src = read("backend/mqtt_service.py")
    assert '"measurement_timestamp": timestamp_iso' in src
    assert 'find_one(' in src
    assert '"timestamp": timestamp_iso' in src
    assert 'initial_forward_totalizer' in src
    assert 'final_forward_totalizer' in src
    assert 'consumption_l' in src
    assert 'timestamp": {"$lt": timestamp_iso}' in src
    assert 'Only move the live cache forward in measurement time' in src


def test_flowmeter_history_is_measurement_time_ordered():
    src = read("backend/mqtt_service.py")
    assert 'get_readings_history' in src
    assert re.search(
        r'\.sort\(\s*\[\s*\("measurement_timestamp",\s*-1\),\s*\("timestamp",\s*-1\)',
        src,
    )


def test_flowmeter_consumption_uses_chronological_chain():
    src = read("backend/api_flowmeter_mgmt.py")
    assert 'chronological forward-totaliser chain' in src
    assert '.sort([("measurement_timestamp", 1), ("timestamp", 1)])' in src
    assert 'if delta >= 0:' in src


def test_freshness_uses_device_measurement_timestamp():
    src = read("backend/api_instrument_registry.py")
    assert 'last_ts = latest_row.get("measurement_timestamp") or latest_row.get("timestamp")' in src
    assert '"last_seen": last_ts' in src
    assert '"received_at": last_rx' in src


def test_water_quality_history_uses_measurement_timestamp():
    src = read("backend/api_water_quality.py")
    assert '"measurement_timestamp": 1' in src
    assert '("measurement_timestamp", -1), ("timestamp", -1)' in src
    assert 'measurement_ts = row.get("measurement_timestamp") or row.get("timestamp")' in src


def test_water_quality_frontend_prefers_measurement_timestamp():
    src = read("frontend/src/pages/WaterQuality.jsx")
    assert 'lastReceivedAt={currentDevice?.measurement_timestamp || currentDevice?.timestamp || currentDevice?.received_at}' in src
