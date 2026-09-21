"""V15 core master-fix regression guards.

These tests lock the concrete fixes made in the V15 audit cycle:
measurement-time ordering, client ownership enforcement, and report/export
timestamp consistency.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def test_flowmeter_detail_apis_enforce_ownership():
    src = read("backend/api_flowmeter_mgmt.py")
    assert "async def _assert_flowmeter_visible" in src
    assert 'await _assert_flowmeter_visible(hardware_id, user)' in src


def test_flowmeter_consumption_uses_measurement_time():
    src = read("backend/api_flowmeter_mgmt.py")
    assert '"measurement_timestamp": {"$gte": start_dt.isoformat(), "$lte": end_dt.isoformat()}' in src
    assert '.sort([("measurement_timestamp", 1), ("timestamp", 1)])' in src
    assert 'row.get("measurement_timestamp") or row.get("timestamp")' in src


def test_flowmeter_export_preserves_legacy_timestamp_fallback():
    src = read("backend/api_flowmeter_mgmt.py")
    assert 'query["$or"] = [' in src
    assert '{"measurement_timestamp": dict(time_filter)}' in src
    assert '{"timestamp": dict(time_filter)}' in src


def test_flowmeter_consumption_includes_pre_window_boundary_reading():
    src = read("backend/api_flowmeter_mgmt.py")
    assert 'before_measurement = await db.flowmeter_readings.find_one(' in src
    assert 'before_legacy = await db.flowmeter_readings.find_one(' in src
    assert 'rows.append(boundary)' in src
    assert 'rows.sort(key=_effective_ts)' in src


def test_water_quality_history_and_pdf_use_measurement_time():
    src = read("backend/api_water_quality.py")
    assert 'cursor.sort([("measurement_timestamp", -1), ("timestamp", -1)])' in src
    assert 'row.get("measurement_timestamp") or row.get("timestamp")' in src
    assert 'table_row = [(row.get("measurement_timestamp") or row.get("timestamp") or row.get("received_at") or "")[:19]]' in src


def test_client_specific_generic_and_flowmeter_endpoints_are_scoped():
    generic = read("backend/api_instruments.py")
    flow = read("backend/api_flowmeter.py")
    assert 'await _assert_device_visible(hardware_id, user)' in generic
    assert flow.count("visible_hardware_ids(user)") >= 3


def test_dwlr_daily_uses_measurement_time():
    src = read("backend/api_flowmeter_mgmt.py")
    assert '"measurement_timestamp": 1' in src
    assert 'r.get("measurement_timestamp") or r.get("timestamp")' in src


def test_reports_use_measurement_timestamp_before_receipt_time():
    src = read("frontend/src/pages/Reports.jsx")
    assert "r?.measurement_timestamp" in src
    assert "r?.received_at" in src
    assert src.find("r?.measurement_timestamp") < src.find("r?.received_at")


def test_wq_date_filters_do_not_fallback_to_legacy_timestamp_when_measurement_time_exists():
    src = read("backend/api_water_quality.py")
    assert '"measurement_timestamp": {"exists": False}' in src\n    assert '"timestamp": {"$gte": from_dt.isoformat(), "$lte": to_dt.isoformat()}' in src


def test_flowmeter_date_filters_do_not_fallback_to_legacy_timestamp_when_measurement_time_exists():
    src = read("backend/api_flowmeter_mgmt.py")
    assert '"measurement_timestamp": {"exists": False}' in src\n    assert '"timestamp": {"$gte": start_dt.isoformat(), "$lte": end_dt.isoformat()}' in src


def test_mqtt_flowmeter_dedup_and_latest_use_measurement_timestamp():
    src = read("backend/mqtt_service.py")
    assert '{"hardware_id": hardware_id, "measurement_timestamp": timestamp_iso}' in src
    assert '"measurement_timestamp": 1, "timestamp": 1, "_id": 0' in src
    assert '(current or {}).get("measurement_timestamp")' in src
    assert 'sort=[("measurement_timestamp", -1), ("timestamp", -1)]' in src


def test_mqtt_flowmeter_totaliser_previous_reading_uses_measurement_time():
    src = read("backend/mqtt_service.py")
    assert '{"measurement_timestamp": {"$lt": timestamp_iso}}' in src
    assert '{"measurement_timestamp": {"$exists": False}, "timestamp": {"$lt": timestamp_iso}}' in src
    assert '"forward_totalizer": 1, "measurement_timestamp": 1, "timestamp": 1' in src


def test_flowmeter_admin_ingest_persists_measurement_timestamp():
    src = read("backend/api_flowmeter_mgmt.py")
    assert '"timestamp": now_iso,' in src
    assert '"measurement_timestamp": now_iso,' in src
    assert '{"hardware_id": req.hardware_id, "measurement_timestamp": now_iso}' in src
