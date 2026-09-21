"""Regression guards for client mobile data visibility.

These checks ensure device-specific endpoints cannot bypass the same
instrument-registry ownership filtering used by list/latest endpoints.
"""
from pathlib import Path
import ast

ROOT = Path(__file__).resolve().parents[1]


def _tree(rel):
    return ast.parse((ROOT / rel).read_text(errors="ignore"), filename=rel)


def _function(tree, name):
    for node in ast.walk(tree):
        if isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)) and node.name == name:
            return node
    raise AssertionError(f"Function {name} not found")


def _source(rel):
    return (ROOT / rel).read_text(errors="ignore")


def test_generic_device_endpoints_require_authenticated_user():
    tree = _tree("backend/api_instruments.py")
    for name in ("latest_for_device", "history_for_device"):
        fn = _function(tree, name)
        args = [a.arg for a in fn.args.args]
        assert "user" in args, f"{name} must accept the authenticated user"
        assert "Depends" in ast.unparse(fn), f"{name} must depend on get_current_user"


def test_generic_device_endpoints_enforce_registry_visibility():
    src = _source("backend/api_instruments.py")
    assert "await _assert_device_visible(hardware_id, user)" in src
    assert 'raise HTTPException(status_code=403, detail="Not authorised to view this device")' in src


def test_flowmeter_device_endpoints_require_authenticated_user():
    tree = _tree("backend/api_flowmeter.py")
    for name in ("get_latest_reading", "get_flowmeter_history"):
        fn = _function(tree, name)
        args = [a.arg for a in fn.args.args]
        assert "user" in args, f"{name} must accept the authenticated user"
        assert "Depends" in ast.unparse(fn), f"{name} must depend on get_current_user"


def test_flowmeter_device_endpoints_enforce_registry_visibility():
    src = _source("backend/api_flowmeter.py")
    assert src.count("await api_instrument_registry.visible_hardware_ids(user)") >= 3
    assert src.count('raise HTTPException(status_code=403, detail="Not authorised to view this device")') >= 2


def test_generic_history_prefers_measurement_time():
    src = _source("backend/api_instruments.py")
    assert '.sort([("measurement_timestamp", -1), ("timestamp", -1), ("received_at", -1)])' in src
