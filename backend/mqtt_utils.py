from datetime import datetime
from typing import Optional

def parse_timestamp(time_str: str) -> datetime:
    """Parse YYMMDDHHMMSS format to datetime."""
    try:
        # Format: YYMMDDHHMMSS
        year = int('20' + time_str[0:2])
        month = int(time_str[2:4])
        day = int(time_str[4:6])
        hour = int(time_str[6:8])
        minute = int(time_str[8:10])
        second = int(time_str[10:12])
        return datetime(year, month, day, hour, minute, second)
    except (ValueError, IndexError) as e:
        print(f"Error parsing timestamp {time_str}: {e}")
        return datetime.now()

def calculate_forward_totalizer(tot1: float, tot2: float) -> float:
    """Calculate forward totalizer: (TOT2 * 65535) + TOT1"""
    return (tot2 * 65535) + tot1

def calculate_reverse_totalizer(rtot1: float, rtot2: float) -> float:
    """Calculate reverse totalizer: (RTOT2 * 65535) + RTOT1"""
    return (rtot2 * 65535) + rtot1

def get_unit_name(unit_code: int) -> str:
    """Convert unit code to unit name."""
    unit_map = {
        1: 'L/S',
        2: 'L/M',
        3: 'L/H',
        4: 'M3/S',
        5: 'M3/M',
        6: 'M3/H',
        7: 'KL/S',
        8: 'KL/M',
        9: 'KL/H',
        10: 'KG/S',
        11: 'KG/M',
        12: 'KG/H'
    }
    return unit_map.get(unit_code, 'UNKNOWN')

def convert_flow_to_lpm(flow_lph: float) -> float:
    """Convert flow from L/H to L/M (liters per minute)."""
    return flow_lph / 60.0


# ============================================================
# Canonical unit normalisation — every flow reading persisted
# to Mongo is coerced to m³/h regardless of what the device
# actually reports. Downstream code (reports, UI, alerts) then
# reads a single, consistent number.
# ============================================================
# Multipliers to convert "1 <unit> → m³/h"
_UNIT_TO_M3H = {
    1: 3.6,          # L/S  -> m³/h  (× 3600 s/h ÷ 1000 L/m³)
    2: 0.06,         # L/M  -> m³/h  (× 60 min/h ÷ 1000)
    3: 0.001,        # L/H  -> m³/h  (÷ 1000)
    4: 3600.0,       # m³/S -> m³/h  (× 3600)
    5: 60.0,         # m³/M -> m³/h  (× 60)
    6: 1.0,          # m³/H -> m³/h  (identity)
    7: 3600.0,       # KL/S -> m³/h  (1 kL = 1 m³)
    8: 60.0,         # KL/M -> m³/h
    9: 1.0,          # KL/H -> m³/h  (identity)
    # KG/* left unmapped — mass, not volumetric flow. Only used
    # by chemical-dosing flowmeters, which aren't in this fleet.
}


def convert_flow_to_m3h(flow_value: float, unit_code: int) -> float:
    """Coerce a raw device flow reading into m³/h.

    Any unknown / mass-based unit code falls back to treating the
    value as m³/h (identity). That's the safest default — a stray
    unrecognised code will render as-is instead of being silently
    multiplied by a wrong factor."""
    try:
        v = float(flow_value or 0)
    except (TypeError, ValueError):
        return 0.0
    mult = _UNIT_TO_M3H.get(int(unit_code), 1.0)
    return round(v * mult, 4)


def m3h_to_lph(flow_m3h: float) -> float:
    """Inverse — used only for legacy fields where storage still
    expects L/H alongside the canonical m³/h value."""
    try:
        return round(float(flow_m3h) * 1000.0, 4)
    except (TypeError, ValueError):
        return 0.0
