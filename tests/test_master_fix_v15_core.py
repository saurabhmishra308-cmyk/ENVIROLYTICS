"""V15 core master-fix regression guards.

These tests lock the concrete fixes made in the V15 audit cycle:
measurement-time ordering, client ownership enforcement, and report/export
timestamp consistency.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def test_flowmeter_mqtt_control_endpoints_require_admin():
    src = read("backend/api_flowmeter.py")
    assert "from auth import get_current_user, require_admin" in src
    assert "async def subscribe_to_flowmeter(subscription: FlowmeterSubscription, admin: dict = Depends(require_admin))" in src
    assert "async def subscribe_to_gateway(subscription: GatewaySubscription, admin: dict = Depends(require_admin))" in src
    assert "async def get_mqtt_status(admin: dict = Depends(require_admin))" in src


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
    assert '{"measurement_timestamp": {"$exists": False}, "timestamp": dict(time_filter)}' in src


def test_flowmeter_edit_rejects_duplicate_measurement_timestamp():
    src = read("backend/api_flowmeter_mgmt.py")
    assert 'if req.timestamp is not None:' in src
    assert '"measurement_timestamp": req.timestamp' in src
    assert '"_id": {"$ne": obj_id}' in src
    assert 'status_code=409' in src
    assert 'A flowmeter reading already exists for this measurement timestamp' in src


def test_flowmeter_edit_neighbors_separate_legacy_and_measurement_time():
    src = read("backend/api_flowmeter_mgmt.py")
    assert "async def _chronological_neighbor(" in src
    assert '"measurement_timestamp": {"$exists": False}' in src
    assert 'return max(candidates, key=lambda row: str(' in src
    assert 'return min(candidates, key=lambda row: str(' in src
    assert 'prev = await _chronological_neighbor(hardware_id, new_ts, "previous", obj_id)' in src
    assert 'nxt = await _chronological_neighbor(hardware_id, new_ts, "next", obj_id)' in src


def test_flowmeter_export_date_filter_only_uses_legacy_timestamp_when_measurement_time_is_absent():
    src = read("backend/api_flowmeter_mgmt.py")
    assert '{"measurement_timestamp": dict(time_filter)}' in src
    assert '{"measurement_timestamp": {"$exists": False}, "timestamp": dict(time_filter)}' in src


def test_dwlr_daily_date_filter_only_uses_legacy_timestamp_when_measurement_time_is_absent():
    src = read("backend/api_flowmeter_mgmt.py")
    assert '{"measurement_timestamp": {"$gte": start.isoformat(), "$lte": end.isoformat()}}' in src
    assert '{"measurement_timestamp": {"$exists": False}, "timestamp": {"$gte": start.isoformat(), "$lte": end.isoformat()}}' in src


def test_edited_latest_caches_are_reconciled_by_measurement_time():
    src = read("backend/api_flowmeter_mgmt.py")
    assert 'sort=[("measurement_timestamp", -1), ("timestamp", -1)]' in src
    assert 'latest_cache = {k: v for k, v in latest_row.items() if k != "_id"}' in src
    assert 'await db.flowmeter_latest.update_one(' in src
    assert 'await db.instrument_latest.update_one(' in src


def test_flowmeter_consumption_includes_pre_window_boundary_reading():
    src = read("backend/api_flowmeter_mgmt.py")
    assert 'before_measurement = await db.flowmeter_readings.find_one(' in src
    assert 'before_legacy = await db.flowmeter_readings.find_one(' in src
    assert 'rows.append(boundary)' in src
    assert 'rows.sort(key=_effective_ts)' in src


def test_water_quality_history_and_pdf_use_measurement_time():
    src = read("backend/api_water_quality.py")
    assert '("measurement_timestamp", -1), ("timestamp", -1)' in src
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
    assert '"measurement_timestamp": {"$exists": False}' in src
    assert '"timestamp": {"$gte": from_dt.isoformat(), "$lte": to_dt.isoformat()}' in src


def test_flowmeter_date_filters_do_not_fallback_to_legacy_timestamp_when_measurement_time_exists():
    src = read("backend/api_flowmeter_mgmt.py")
    assert '"measurement_timestamp": {"$exists": False}' in src
    assert '"timestamp": {"$gte": start_dt.isoformat(), "$lte": end_dt.isoformat()}' in src


def test_mqtt_downsampling_uses_measurement_time_not_receipt_time():
    src = read("backend/mqtt_service.py")
    assert 'measurement_timestamp: Optional[str] = None' in src
    assert 'current_ts <= previous_ts' in src
    assert '(current_ts - previous_ts) >= timedelta(minutes=freq_minutes)' in src
    assert 'self._should_store_reading("flowmeter", hardware_id, timestamp_iso)' in src
    assert 'self._should_store_reading("instrument", hardware_id, ts_iso)' in src
def test_mqtt_downsampling_preserves_late_measurements_in_chronological_history():
    src = read("backend/mqtt_service.py")
    start = src.index("async def _should_store_reading")
    end = src.index("async def process_instrument_data", start)
    block = src[start:end]
    assert '"measurement_timestamp": {"$lt": measurement_timestamp}' in block
    assert '"measurement_timestamp": {"$exists": False}, "timestamp": {"$lt": measurement_timestamp}' in block
    assert "nearest earlier device measurement" in block
    assert "current_ts <= previous_ts" in block


def test_mqtt_flowmeter_dedup_and_latest_use_measurement_timestamp():
    src = read("backend/mqtt_service.py")
    assert '{"hardware_id": hardware_id, "measurement_timestamp": timestamp_iso}' in src
    assert '"measurement_timestamp": 1, "timestamp": 1, "_id": 0' in src
    assert '(current or {}).get("measurement_timestamp")' in src
    assert 'sort=[("measurement_timestamp", -1), ("timestamp", -1)]' in src
def test_flowmeter_all_latest_has_no_arbitrary_100_device_cap():
    src = read("backend/mqtt_service.py")
    start = src.index("async def get_all_latest_readings(self)")
    end = src.index("async def get_readings_history", start)
    block = src[start:end]
    assert ".limit(100)" not in block
    assert "to_list(length=100)" not in block
    assert "async for r in cursor:" in block
    assert '[("measurement_timestamp", -1), ("timestamp", -1), ("received_at", -1)]' in block


def test_mqtt_flowmeter_totaliser_previous_reading_uses_measurement_time():
    src = read("backend/mqtt_service.py")
    assert '{"measurement_timestamp": {"$lt": timestamp_iso}}' in src
    assert '{"measurement_timestamp": {"$exists": False}, "timestamp": {"$lt": timestamp_iso}}' in src
    assert '"forward_totalizer": 1, "measurement_timestamp": 1, "timestamp": 1' in src


def test_flowmeter_aggregate_exposes_measurement_time_and_separate_receipt_time():
    src = read("backend/api_flowmeter_mgmt.py")
    assert '"last_reading_at": (latest.get("measurement_timestamp") or latest.get("timestamp")) if latest else None' in src
    assert '"last_received_at": latest.get("received_at") if latest else None' in src


def test_flowmeter_admin_ingest_persists_measurement_timestamp():
    src = read("backend/api_flowmeter_mgmt.py")
    assert '"timestamp": now_iso,' in src
    assert '"measurement_timestamp": now_iso,' in src
    assert '{"hardware_id": req.hardware_id, "measurement_timestamp": now_iso}' in src


def test_flowmeter_ui_prefers_measurement_timestamp():
    src = read("frontend/src/pages/Flowmeter.jsx")
    assert "r.measurement_timestamp || r.timestamp || r.received_at" in src
    assert "current.measurement_timestamp || current.timestamp || current.received_at" in src


def test_flowmeter_ui_labels_totalisers_as_litres_not_flow_rate_unit():
    src = read("frontend/src/pages/Flowmeter.jsx")
    assert '<p className="text-xs text-gray-500">L</p>' in src
    assert '<span className="text-3xl font-semibold text-gray-600">L</span>' in src


def test_dwlr_ui_separates_measurement_and_receipt_timestamps():
    src = read("frontend/src/pages/WaterLevelRecorder.jsx")
    assert "measurement_timestamp: lt?.measurement_timestamp || lt?.timestamp || lt?.received_at || null" in src
    assert "received_at: lt?.received_at || null" in src
    assert "activeWell.measurement_timestamp" in src
    assert "well.measurement_timestamp" in src


def test_registry_retention_and_clear_history_use_measurement_time():
    src = read("backend/api_instrument_registry.py")
    assert '"measurement_timestamp": {"$lt": cutoff}' in src
    assert '"measurement_timestamp": {"$exists": False}, "timestamp": {"$lt": cutoff}' in src
    assert 'measurement_range_clause' in src
    assert '"measurement_timestamp": inner' in src


def test_mqtt_reconnect_backoff_is_configured():
    src = read("backend/mqtt_service.py")
    assert "self.client.reconnect_delay_set(min_delay=1, max_delay=60)" in src
    assert "connect_async(self.broker_host, self.broker_port, 60)" in src


def test_espl_poller_keeps_five_minute_polling_and_measurement_time_authority():
    src = read("backend/espl_poller.py")
    assert "POLL_INTERVAL_SEC = 300" in src
    assert '"measurement_timestamp": measurement_ts' in src
    assert '"received_at": now_iso' in src
    assert '"measurement_timestamp": 1, "timestamp": 1' in src
    assert 'measurement_dt >= current_dt' in src

def test_generic_instrument_ingest_stamps_measurement_time():
    src = read("backend/api_instruments.py")
    assert '"measurement_timestamp": now_iso' in src


def test_generic_latest_endpoints_have_no_arbitrary_device_caps():
    src = read("backend/api_instruments.py")
    all_start = src.index('async def latest_all_types')
    all_end = src.index('@router.get("/{instrument_type}/latest")', all_start)
    all_block = src[all_start:all_end]
    assert "to_list(length=500)" not in all_block
    assert "async for row in cursor:" in all_block

    type_start = src.index('async def latest_for_type')
    type_end = src.index('@router.get("/{instrument_type}/{hardware_id}/latest")', type_start)
    type_block = src[type_start:type_end]
    assert "to_list(length=200)" not in type_block
    assert "async for row in cursor:" in type_block

def test_dwlr_daily_range_is_measurement_time_authoritative():
    src = read("backend/api_flowmeter_mgmt.py")
    start = src.index('async def dwlr_daily')
    end = src.index('\n#', start) if '\n#' in src[start:] else len(src)
    block = src[start:end]
    assert '"measurement_timestamp": {"$gte": start.isoformat(), "$lte": end.isoformat()}' in block
    assert '"measurement_timestamp": {"$exists": False}, "timestamp": {"$gte": start.isoformat(), "$lte": end.isoformat()}' in block
    assert '.limit(20000)' not in block

def test_espl_malformed_timestamp_falls_back_to_receipt_time():
    src = read("backend/espl_poller.py")
    assert "if measurement_dt is None:" in src
    assert "measurement_dt = datetime.now(timezone.utc)" in src
    assert "measurement_ts = measurement_dt.isoformat()" in src


def test_espl_http_device_polling_has_no_arbitrary_500_device_cap():
    src = read("backend/espl_poller.py")
    start = src.index("async def _http_devices")
    end = src.index("# ---------------------------------------------------------------- probe", start)
    block = src[start:end]
    assert "to_list(length=500)" not in block
    assert "async for row in cursor:" in block

def test_wq_aggregated_history_deduplicates_measurement_timestamps():
    src = read("backend/api_water_quality.py")
    start = src.index("async def history(")
    end = src.index('@router.post("/report")', start)
    block = src[start:end]
    assert 'seen_measurement_ts = set()' in block
    assert 'if measurement_ts in seen_measurement_ts:' in block
    assert 'measurement_ts = row.get("measurement_timestamp") or row.get("timestamp")' in block
    assert '.sort([("measurement_timestamp", -1), ("timestamp", -1), ("received_at", -1)])' in block


def test_wq_reports_deduplicate_measurement_timestamps():
    src = read("backend/api_water_quality.py")
    assert "seen_measurement_ts = set()" in src
    assert "measurement_ts = row.get(\"measurement_timestamp\") or row.get(\"timestamp\")" in src
    assert "if measurement_ts in seen_measurement_ts:" in src
    assert "raw_rows = await cursor.to_list(length=None)" in src

def test_mqtt_ingestion_retains_raw_vendor_timestamp():
    src = read("backend/mqtt_service.py")
    assert '"source_timestamp_raw": str(data.get("TIME") or "").strip() or None' in src
    assert '"source_timestamp_raw": raw_time or None' in src


def test_mqtt_flowmeter_malformed_timestamp_falls_back_to_receipt_time():
    src = read("backend/mqtt_service.py")
    start = src.index("async def process_flowmeter_data")
    end = src.index("async def process_gateway_status", start)
    block = src[start:end]
    assert 'raw_time = str(data.get("TIME") or "").strip()' in block
    assert "except (TypeError, ValueError):" in block
    assert "timestamp_iso = datetime.now(timezone.utc).isoformat()" in block

def test_instrument_registry_has_no_arbitrary_2000_device_caps():
    src = read("backend/api_instrument_registry.py")
    start = src.index("async def list_instruments")
    end = src.index("# ---------------------------------------------------------------- last-data snapshot", start)
    block = src[start:end]
    assert "to_list(length=2000)" not in block
    assert "async for item in cursor:" in block

    start = src.index("async def instrument_last_data")
    end = src.index("# ----------------------------------------------------------------", start + 10)
    block = src[start:end]
    assert ".to_list(length=2000)" not in block
    assert "async for item in registry_cursor:" in block

def test_registry_updates_keep_type_category_and_mqtt_mapping_consistent():
    src = read("backend/api_instrument_registry.py")
    assert 'effective_type = updates.get("instrument_type", existing.get("instrument_type"))' in src
    assert 'if effective_type != "flowmeter":' in src
    assert 'updates["category"] = None' in src
    assert 'elif existing.get("instrument_type") == "flowmeter" and new_type != "flowmeter":' in src
    assert 'new_source = updates.get("source", existing.get("source") or "mqtt")' in src
    assert 'if new_source == "mqtt":' in src
    assert 'await _subscribe_topic(new_type, hardware_id)' in src

def test_auth_rechecks_account_active_state_after_jwt_validation():
    src = read("backend/auth.py")
    assert 'if not user.get("is_active", True):' in src
    assert 'raise HTTPException(status_code=403, detail="Account is deactivated")' in src
    assert src.index('if not user.get("is_active", True):') < src.index('user.pop("password_hash", None)')

def test_flowmeter_categories_have_no_arbitrary_fleet_cap():
    src = read("backend/api_flowmeter_mgmt.py")
    start = src.index('@router.get("/categories")')
    end = src.index('@router.delete("/{hardware_id}/category")', start)
    block = src[start:end]
    assert "to_list(length=500)" not in block
    assert "async for item in cursor:" in block

def test_frontend_logs_out_when_backend_deactivates_account():
    src = read("frontend/src/lib/api.js")
    assert 'const isDeactivated = status === 403 && detail === "Account is deactivated";' in src
    assert 'isDeactivated || (status === 401 && isTokenInvalidError(err))' in src

def test_client_dashboard_does_not_require_admin_flowmeter_status():
    src = read("frontend/src/pages/EnhancedDashboard.jsx")
    assert "const liveRequests = [" in src
    assert "if (isAdmin()) {" in src
    assert "liveRequests.push(api.get('/api/flowmeter/status'));" in src
    assert "const [fmRes, instrRes, catRes, regRes, statusRes]" in src

def test_reports_use_measurement_time_and_registry_visibility():
    src = read("backend/api_reports.py")
    assert "import api_instrument_registry" in src
    assert "async def _visible_ids(user: dict" in src
    assert 'raise HTTPException(status_code=403, detail="Not authorised to view this device")' in src
    assert "measurement_timestamp" in src
    assert "def _measurement_range(start: datetime, end: datetime)" in src
    assert "def _measurement_since(start: datetime)" in src
    assert 'sort=[("measurement_timestamp", -1), ("timestamp", -1)]' in src
    assert "async def _list_groundwater_borewells(user: dict)" in src
    assert "_list_groundwater_borewells(user)" in src

def test_generic_manual_ingest_is_registry_bound_and_latest_monotonic():
    src = read("backend/api_instruments.py")
    assert 'raise HTTPException(status_code=404, detail="Instrument not registered")' in src
    assert 'raise HTTPException(status_code=400, detail="Instrument type does not match registry")' in src
    assert '"measurement_timestamp": now_iso' in src
    assert 'if not current_ts or now_iso >= current_ts:' in src

def test_measurement_time_indexes_exist_for_hot_history_queries():
    src = read("backend/server.py")
    assert 'create_index([("hardware_id", 1), ("measurement_timestamp", -1)])' in src
    assert 'create_index([("instrument_type", 1), ("hardware_id", 1), ("measurement_timestamp", -1)])' in src

def test_legacy_status_and_site_status_endpoints_are_authenticated():
    server = read("backend/server.py")
    assert 'async def create_status_check(input: StatusCheckCreate, user: dict = Depends(auth_module.get_current_user))' in server
    assert 'async def get_status_checks(user: dict = Depends(auth_module.get_current_user))' in server

    admin = read("backend/api_admin.py")
    assert 'async def check_site_status(user_id: str, caller: dict = Depends(get_current_user))' in admin
    assert 'Not authorised to view this site status' in admin

def test_espl_timestamp_traceability():
    src = read("backend/espl_poller.py")
    assert '"measurement_timestamp": measurement_ts' in src
    assert '"source_timestamp_raw": str(source_timestamp_raw).strip() if source_timestamp_raw else None' in src
    assert '"received_at": now_iso' in src

def test_dwlr_daily_deduplicates_measurement_timestamps():
    src = read("backend/api_flowmeter_mgmt.py")
    start = src.index('@router.get("/dwlr/{hardware_id}/daily")')
    block = src[start:]
    assert "seen_measurement_ts = set()" in block
    assert "if ts in seen_measurement_ts:" in block
    assert "seen_measurement_ts.add(ts)" in block
