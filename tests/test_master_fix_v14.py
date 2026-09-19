"""Master Fix V14 regression guards.

These tests protect the fixes restored after the Version 14 regression evidence:
DO cards showing no data, timestamp/freshness drift, and historical/latest
timestamp integrity. They are source-level guards and do not require MongoDB.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_qespl_uses_measurement_timestamp_and_deduplication():
    src = read("backend/espl_poller.py")
    assert '"measurement_timestamp": measurement_ts' in src
    assert '"hardware_id": device["hardware_id"], "measurement_timestamp": measurement_ts' in src
    assert 'sort=[("measurement_timestamp", -1), ("timestamp", -1)]' in src
    assert 'Latest cache is monotonic in DEVICE measurement time' in src


def test_qespl_preserves_raw_do_and_tank_mapping():
    src = read("backend/espl_poller.py")
    assert 'values["DO"]' in src
    assert 'values[f"DO_TANK_{tank_int}"] = values["DO"]' in src
    assert '"raw": payload' in src
    assert 'POLL_INTERVAL_SEC = 300' in src


def test_water_quality_recovers_legacy_do_tank_values():
    src = read("backend/api_water_quality.py")
    assert 'do_val = raw_vals.get(f"DO_TANK_{tn}")' in src
    assert 'if do_val is None:' in src
    assert 'vals[f"DO_TANK_{tn}"] = do_val' in src


def test_mqtt_device_measurement_timestamp_is_explicit():
    src = read("backend/mqtt_service.py")
    assert '"measurement_timestamp": ts_iso' in src
    assert '{"hardware_id": hardware_id, "measurement_timestamp": ts_iso}' in src
    assert '"measurement_timestamp": 1, "timestamp": 1, "received_at": 1' in src


def test_registry_separates_last_seen_from_transport_receipt():
    src = read("backend/api_instrument_registry.py")
    assert '"last_timestamp": last_ts' in src
    assert '"last_received_at": last_rx' in src
    assert '"received_at": last_rx' in src
    assert '"last_seen": last_ts' in src


def test_water_quality_history_and_reports_use_measurement_time():
    src = read("backend/api_water_quality.py")
    assert 'row.get("measurement_timestamp") or row.get("timestamp")' in src
    assert '"measurement_timestamp": 1' in src
    assert 'async for row in cursor.sort("timestamp", -1)' in src
    assert '"measurement_timestamp": {"$gte": from_dt.isoformat(), "$lte": to_dt.isoformat()}' in src


def test_v14_original_assets_remain_pending_until_restored():
    src = read("docs/MASTER_FIX_LIST_V12.md")
    assert "Version 14 / v1.0.3 UI restoration — NOT YET PASS" in src
    assert "flowmeter-animation.png" in src
    assert "dwlr-animation.png" in src
    assert "Flow vs Water Level" in src
    assert "Water Level vs Rainfall" in src
