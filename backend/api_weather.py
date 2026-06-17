"""Nearest water body lookup + Live weather proxy for the dashboard.

Given a (lat, lon), find the closest river / sea / dam from a curated list and
return the compass bearing from the user's site to that water body. Also
proxies Open-Meteo (free, no API key) to supply live weather data in an
OpenWeatherMap-compatible shape so the dashboard WeatherCard updates without
the user having to configure a third-party API key.
"""
import math
from typing import Optional, List, Dict

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from auth import get_current_user

router = APIRouter(prefix="/api/weather", tags=["weather"])


# A curated short-list — geo-significant water bodies near our target client
# region (Indian subcontinent). Coordinates pulled from public geodata.
WATER_BODIES: List[Dict] = [
    # Seas / oceans (use coastline-ish points)
    {"name": "Arabian Sea",        "kind": "sea",   "lat": 18.50, "lon": 70.00},
    {"name": "Bay of Bengal",      "kind": "sea",   "lat": 14.00, "lon": 87.00},
    {"name": "Indian Ocean",       "kind": "sea",   "lat":  6.00, "lon": 78.00},
    # Major rivers (representative mid-stream points)
    {"name": "Ganges River",       "kind": "river", "lat": 25.6, "lon": 85.1},
    {"name": "Yamuna River",       "kind": "river", "lat": 27.2, "lon": 78.0},
    {"name": "Gomti River",        "kind": "river", "lat": 26.85, "lon": 81.00},
    {"name": "Saryu River",        "kind": "river", "lat": 26.79, "lon": 82.20},
    {"name": "Narmada River",      "kind": "river", "lat": 22.71, "lon": 75.86},
    {"name": "Godavari River",     "kind": "river", "lat": 18.96, "lon": 78.65},
    {"name": "Krishna River",      "kind": "river", "lat": 16.50, "lon": 80.62},
    {"name": "Kaveri River",       "kind": "river", "lat": 11.42, "lon": 78.85},
    {"name": "Tapti River",        "kind": "river", "lat": 21.20, "lon": 75.00},
    {"name": "Brahmaputra River",  "kind": "river", "lat": 26.15, "lon": 91.70},
    {"name": "Mahanadi River",     "kind": "river", "lat": 20.50, "lon": 85.10},
    {"name": "Indravati River",    "kind": "river", "lat": 19.10, "lon": 81.70},
    # Major dams / reservoirs
    {"name": "Sardar Sarovar Dam", "kind": "dam",   "lat": 21.83, "lon": 73.75},
    {"name": "Bhakra Nangal Dam",  "kind": "dam",   "lat": 31.41, "lon": 76.43},
    {"name": "Hirakud Dam",        "kind": "dam",   "lat": 21.57, "lon": 83.87},
    {"name": "Tehri Dam",          "kind": "dam",   "lat": 30.38, "lon": 78.48},
    {"name": "Nagarjuna Sagar",    "kind": "dam",   "lat": 16.57, "lon": 79.31},
    {"name": "Idukki Dam",         "kind": "dam",   "lat":  9.84, "lon": 76.97},
    {"name": "Mettur Dam",         "kind": "dam",   "lat": 11.79, "lon": 77.80},
    {"name": "Almatti Dam",        "kind": "dam",   "lat": 16.33, "lon": 75.89},
]


def _haversine_km(lat1, lon1, lat2, lon2) -> float:
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def _bearing_deg(lat1, lon1, lat2, lon2) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def _cardinal(deg: float) -> str:
    points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
    return points[int((deg + 22.5) // 45) % 8]


def _nearest(lat: float, lon: float) -> Optional[Dict]:
    if lat is None or lon is None:
        return None
    best = None
    best_km = float("inf")
    for wb in WATER_BODIES:
        d = _haversine_km(lat, lon, wb["lat"], wb["lon"])
        if d < best_km:
            best_km = d
            best = wb
    if not best:
        return None
    bearing = _bearing_deg(lat, lon, best["lat"], best["lon"])
    return {
        **best,
        "distance_km": round(best_km, 1),
        "bearing_deg": round(bearing, 1),
        "cardinal": _cardinal(bearing),
    }


@router.get("/waterbody")
async def waterbody(
    lat: Optional[float] = Query(None),
    lon: Optional[float] = Query(None),
    user: dict = Depends(get_current_user),
):
    """Return the nearest river/dam/sea + compass direction from the user's site.

    `lat`/`lon` query params override the user's profile location (useful for
    multi-site clients). The label is what the WeatherCard renders.
    """
    if lat is None or lon is None:
        lat = float(user.get("latitude") or 0.0)
        lon = float(user.get("longitude") or 0.0)

    nearest = _nearest(lat, lon)
    if not nearest:
        return {"available": False, "label": "—"}

    direction_arrow = {
        "N": "↑", "NE": "↗", "E": "→", "SE": "↘",
        "S": "↓", "SW": "↙", "W": "←", "NW": "↖",
    }.get(nearest["cardinal"], "→")

    label = f"Flow toward {nearest['name']} {direction_arrow} {nearest['cardinal']} · {nearest['distance_km']} km"
    return {
        "available": True,
        "label": label,
        "name": nearest["name"],
        "kind": nearest["kind"],
        "cardinal": nearest["cardinal"],
        "bearing_deg": nearest["bearing_deg"],
        "distance_km": nearest["distance_km"],
        "from": {"lat": lat, "lon": lon},
        "to":   {"lat": nearest["lat"], "lon": nearest["lon"]},
    }


# ============================================================
# Live weather proxy (Open-Meteo — free, no API key required)
# ============================================================
OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"


@router.get("/live")
async def live_weather(
    lat: Optional[float] = Query(None),
    lon: Optional[float] = Query(None),
    user: dict = Depends(get_current_user),
):
    """Return current weather in OpenWeatherMap-compatible shape.

    Source: Open-Meteo (https://open-meteo.com) — free, no API key.
    Falls back to the user's profile lat/lon when query params are omitted.
    """
    if lat is None or lon is None:
        lat = float(user.get("latitude") or 26.8467)
        lon = float(user.get("longitude") or 80.9462)

    params = {
        "latitude": lat,
        "longitude": lon,
        "current": ",".join([
            "temperature_2m",
            "relative_humidity_2m",
            "apparent_temperature",
            "wind_speed_10m",
            "wind_direction_10m",
            "pressure_msl",
            "rain",
            "weather_code",
        ]),
        "timezone": "auto",
        "wind_speed_unit": "ms",
    }
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(OPEN_METEO_URL, params=params)
            r.raise_for_status()
            data = r.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Weather upstream error: {e}")

    cur = data.get("current") or {}
    # Shape to match what the frontend WeatherCard already consumes (OWM-like).
    return {
        "coord": {"lat": lat, "lon": lon},
        "name": "Site",
        "dt": cur.get("time"),
        "main": {
            "temp": cur.get("temperature_2m"),
            "feels_like": cur.get("apparent_temperature"),
            "humidity": cur.get("relative_humidity_2m"),
            "pressure": int(cur.get("pressure_msl")) if cur.get("pressure_msl") is not None else None,
        },
        "wind": {
            "speed": cur.get("wind_speed_10m"),
            "deg": cur.get("wind_direction_10m"),
        },
        "rain": {"1h": cur.get("rain") or 0},
        "weather_code": cur.get("weather_code"),
        "source": "open-meteo",
    }
