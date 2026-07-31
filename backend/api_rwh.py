"""Rainwater Harvesting recharge estimation.

Computes potential recharge (litres) for a client based on:
  * Their Customer Profile (`rwh_catchment_area_sqm`, `rwh_runoff_coefficient`).
  * Live daily rainfall (mm) at their site coordinates, sourced from
    Open-Meteo — no API key required, free tier.

Formula (CGWB standard):
    recharge_litres = catchment_area_m2 × runoff_coefficient × rainfall_mm

Since 1 mm of rain over 1 m² deposits exactly 1 litre, the units work out
cleanly. We surface today / past-7 / past-30 day rolling totals for the
Dashboard "RWH Recharge" tile placed next to the DWLR (groundwater level)
card.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional, Dict, List

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from auth import get_current_user

router = APIRouter(prefix="/api/rwh", tags=["rwh"])

db = None
OPEN_METEO_FORECAST = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"

# Sensible default when the client hasn't picked one — RCC rooftop is the
# most common catchment type in Indian commercial installations.
DEFAULT_RUNOFF = 0.85


def set_db(database):
    global db
    db = database


async def _daily_rainfall(lat: float, lon: float, past_days: int = 30) -> List[Dict]:
    """Fetch `past_days` days of `precipitation_sum` (mm) from Open-Meteo.

    Uses the free forecast API which accepts `past_days` up to 92 — no API
    key required. Returns `[{date: 'YYYY-MM-DD', mm: float}]` newest last.
    """
    if past_days < 1 or past_days > 92:
        past_days = 30
    params = {
        "latitude": lat,
        "longitude": lon,
        "daily": "precipitation_sum",
        "past_days": past_days,
        "forecast_days": 1,
        "timezone": "auto",
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(OPEN_METEO_FORECAST, params=params)
        r.raise_for_status()
        payload = r.json()
    daily = payload.get("daily") or {}
    dates = daily.get("time") or []
    mm_series = daily.get("precipitation_sum") or []
    out: List[Dict] = []
    for i, d in enumerate(dates):
        try:
            mm = float(mm_series[i]) if mm_series[i] is not None else 0.0
        except (TypeError, ValueError, IndexError):
            mm = 0.0
        out.append({"date": d, "mm": round(mm, 2)})
    return out


@router.get("/recharge")
async def recharge_estimate(
    past_days: int = Query(30, ge=1, le=92),
    lat: Optional[float] = Query(None),
    lon: Optional[float] = Query(None),
    user: dict = Depends(get_current_user),
):
    """Return recharge estimation for the caller's site.

    * Reads catchment area + runoff coefficient from the caller's Customer
      Profile (or looks up an admin-selected client via `?client_id=`).
    * Fetches daily rainfall from Open-Meteo at the caller's coordinates.
    * Multiplies the three to get daily litres; returns today, past-7d,
      past-30d, and the raw daily series so the dashboard can chart it.

    Never returns a hard error when weather is briefly unreachable — instead
    surfaces `weather_available=false` so the tile can degrade gracefully.
    """
    uid = user.get("id")
    # Profile fields live on the `users` collection (see api_customer_profile
    # — updates are written via `users.update_one`). Reading straight from
    # there keeps recharge computation aligned with what admins see & save
    # on the Customer Profile page.
    profile = await db.users.find_one(
        {"id": uid},
        {"_id": 0, "rwh_catchment_area_sqm": 1, "rwh_runoff_coefficient": 1, "rwh_structure_count": 1, "latitude": 1, "longitude": 1},
    ) or {}

    area = profile.get("rwh_catchment_area_sqm")
    runoff = profile.get("rwh_runoff_coefficient") or DEFAULT_RUNOFF
    structure_count = profile.get("rwh_structure_count") or 0

    # Fall back to user's home location if the caller didn't pass explicit
    # coords. Admin views can override via lat/lon query params.
    if lat is None or lon is None:
        lat = float(user.get("latitude") or profile.get("latitude") or 0.0)
        lon = float(user.get("longitude") or profile.get("longitude") or 0.0)

    if not lat or not lon:
        return {
            "available": False,
            "reason": "no coordinates on user profile",
            "catchment_area_sqm": area,
            "runoff_coefficient": runoff,
            "structure_count": structure_count,
        }

    if not area or float(area) <= 0:
        return {
            "available": False,
            "reason": "no catchment area configured — add it in Customer Profile",
            "catchment_area_sqm": area,
            "runoff_coefficient": runoff,
            "structure_count": structure_count,
        }

    try:
        rainfall = await _daily_rainfall(float(lat), float(lon), past_days=past_days)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Weather upstream error: {e}")

    area_f = float(area)
    runoff_f = float(runoff)

    # Litres = area_m2 × runoff × rainfall_mm (unit-clean: 1 mm on 1 m² = 1 L).
    series = []
    for row in rainfall:
        litres = round(area_f * runoff_f * float(row["mm"]), 1)
        series.append({"date": row["date"], "rainfall_mm": row["mm"], "recharge_litres": litres})

    today_l = series[-1]["recharge_litres"] if series else 0.0
    past_7 = round(sum(r["recharge_litres"] for r in series[-7:]), 1)
    past_30 = round(sum(r["recharge_litres"] for r in series[-30:]), 1)

    return {
        "available": True,
        "computed_at": datetime.now(timezone.utc).isoformat(),
        "coord": {"lat": lat, "lon": lon},
        "catchment_area_sqm": area_f,
        "runoff_coefficient": runoff_f,
        "structure_count": structure_count,
        "today": {
            "date": series[-1]["date"] if series else None,
            "rainfall_mm": series[-1]["rainfall_mm"] if series else 0.0,
            "recharge_litres": today_l,
        },
        "past_7_days": {"total_litres": past_7, "total_kl": round(past_7 / 1000, 3)},
        "past_30_days": {"total_litres": past_30, "total_kl": round(past_30 / 1000, 3)},
        "series": series,
    }
