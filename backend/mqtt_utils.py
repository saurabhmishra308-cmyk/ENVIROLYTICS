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
