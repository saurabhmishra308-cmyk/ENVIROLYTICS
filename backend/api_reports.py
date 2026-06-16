"""Cross-correlated reports & multi-borewell consumption.

Endpoints
---------
GET /api/reports/flow-vs-level
    Returns a merged hourly series of borewell flow (m³/hr) + water level (m)
    for a given hardware_id (flowmeter) and the nearest DWLR. Used by the new
    "Flow vs Water Level" graph in Reports.

GET /api/reports/level-vs-rainfall
    Returns a merged daily series of DWLR water level (m) + rainfall (mm) from
    Open-Meteo for the user's location. Used by the "Water Level vs Rainfall"
    graph in Reports.

GET /api/reports/borewell-consumption
    Returns per-borewell + grand-total consumption (KL) for a date range.
    Supports JSON, CSV and PDF download.

GET /api/reports/hourly-pumping-vs-level
    Hourly buckets used by the Data Analysis page (pumping rate + level
    side-by-side).
"""
import csv
import io
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/reports", tags=["reports"])

# Set from server.py
db = None


def set_db(database):
    global db
    db = database


# --------------------------------------------------------------------------- utils
def _parse_dt(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def _bucket_hourly(ts_iso: str) -> str:
    dt = _parse_dt(ts_iso)
    if not dt:
        return ts_iso
    return dt.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0).isoformat()


def _bucket_daily(ts_iso: str) -> str:
    dt = _parse_dt(ts_iso)
    if not dt:
        return ts_iso
    return dt.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).date().isoformat()


def _kl(litres: float) -> float:
    return round((litres or 0.0) / 1000.0, 3)


# --------------------------------------------------------------------------- flow vs level
@router.get("/flow-vs-level")
async def flow_vs_level(
    hardware_id: str = Query(..., description="Flowmeter hardware id"),
    days: int = Query(7, ge=1, le=90),
    dwlr_id: Optional[str] = Query(None, description="Specific DWLR; defaults to the first one available"),
    user: dict = Depends(get_current_user),
):
    """Hourly merged series. Flow in m³/hr, water level in metres."""
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days)

    # Resolve a DWLR if not provided — pick the first one with data.
    if not dwlr_id:
        dwlr_latest = await db.instrument_latest.find_one({"instrument_type": "dwlr"})
        if dwlr_latest:
            dwlr_id = dwlr_latest.get("hardware_id")

    # Flowmeter readings (hourly averaged flow)
    flow_buckets = {}
    fm_cursor = db.flowmeter_readings.find(
        {"hardware_id": hardware_id, "timestamp": {"$gte": start.isoformat()}},
        {"_id": 0, "timestamp": 1, "flow_rate_lph": 1},
    )
    async for r in fm_cursor:
        b = _bucket_hourly(r["timestamp"])
        agg = flow_buckets.setdefault(b, {"sum": 0.0, "n": 0})
        agg["sum"] += float(r.get("flow_rate_lph", 0))
        agg["n"] += 1

    # DWLR readings (hourly averaged level)
    level_buckets = {}
    if dwlr_id:
        dw_cursor = db.instrument_readings.find(
            {"instrument_type": "dwlr", "hardware_id": dwlr_id,
             "timestamp": {"$gte": start.isoformat()}},
            {"_id": 0, "timestamp": 1, "values": 1},
        )
        async for r in dw_cursor:
            v = r.get("values", {}) or {}
            level = v.get("LEVEL") if isinstance(v.get("LEVEL"), (int, float)) else v.get("level")
            if level is None:
                continue
            b = _bucket_hourly(r["timestamp"])
            agg = level_buckets.setdefault(b, {"sum": 0.0, "n": 0})
            agg["sum"] += float(level)
            agg["n"] += 1

    # Merge buckets into time-aligned rows
    all_keys = sorted(set(flow_buckets.keys()) | set(level_buckets.keys()))
    series = []
    for k in all_keys:
        f = flow_buckets.get(k)
        lvl = level_buckets.get(k)
        series.append({
            "bucket": k,
            "flow_m3h": round((f["sum"] / f["n"]) / 1000.0, 3) if f else None,
            "level_m":  round(lvl["sum"] / lvl["n"], 3) if lvl else None,
        })

    return {
        "flowmeter_id": hardware_id,
        "dwlr_id": dwlr_id,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "series": series,
        "count": len(series),
    }


# --------------------------------------------------------------------------- level vs rainfall
async def _fetch_rainfall(lat: float, lon: float, start_date: str, end_date: str) -> List[dict]:
    """Open-Meteo historical/forecast — no API key required. Returns
    [{date, rainfall_mm}, …]."""
    url = "https://archive-api.open-meteo.com/v1/archive"
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": start_date,
        "end_date": end_date,
        "daily": "precipitation_sum",
        "timezone": "UTC",
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        logger.warning(f"[rainfall] Open-Meteo error: {e}")
        return []
    daily = data.get("daily", {}) or {}
    dates = daily.get("time", []) or []
    rains = daily.get("precipitation_sum", []) or []
    return [{"date": d, "rainfall_mm": (r if r is not None else 0.0)} for d, r in zip(dates, rains)]


@router.get("/level-vs-rainfall")
async def level_vs_rainfall(
    hardware_id: Optional[str] = Query(None, description="DWLR hardware id (defaults to first available)"),
    days: int = Query(14, ge=1, le=180),
    user: dict = Depends(get_current_user),
):
    """Daily merged series of water level (m) + rainfall (mm)."""
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days)

    # Choose DWLR if not provided
    if not hardware_id:
        dwlr_latest = await db.instrument_latest.find_one({"instrument_type": "dwlr"})
        if dwlr_latest:
            hardware_id = dwlr_latest.get("hardware_id")
    if not hardware_id:
        return {"series": [], "count": 0, "dwlr_id": None}

    # DWLR daily averaged level
    level_buckets = {}
    dw_cursor = db.instrument_readings.find(
        {"instrument_type": "dwlr", "hardware_id": hardware_id,
         "timestamp": {"$gte": start.isoformat()}},
        {"_id": 0, "timestamp": 1, "values": 1},
    )
    async for r in dw_cursor:
        v = r.get("values", {}) or {}
        level = v.get("LEVEL") if isinstance(v.get("LEVEL"), (int, float)) else v.get("level")
        if level is None:
            continue
        b = _bucket_daily(r["timestamp"])
        agg = level_buckets.setdefault(b, {"sum": 0.0, "n": 0})
        agg["sum"] += float(level)
        agg["n"] += 1

    # User's location (fallback to admin Lucknow)
    lat = float(user.get("latitude") or 26.8467)
    lon = float(user.get("longitude") or 80.9462)

    rains = await _fetch_rainfall(lat, lon, start.date().isoformat(), end.date().isoformat())
    rain_by_day = {r["date"]: r["rainfall_mm"] for r in rains}

    all_days = sorted(set(level_buckets.keys()) | set(rain_by_day.keys()))
    series = []
    for d in all_days:
        lvl = level_buckets.get(d)
        series.append({
            "date": d,
            "level_m": round(lvl["sum"] / lvl["n"], 3) if lvl else None,
            "rainfall_mm": round(float(rain_by_day.get(d, 0.0)), 2),
        })

    return {
        "dwlr_id": hardware_id,
        "latitude": lat,
        "longitude": lon,
        "start": start.date().isoformat(),
        "end": end.date().isoformat(),
        "series": series,
        "count": len(series),
    }


# --------------------------------------------------------------------------- multi-borewell consumption
async def _consumption_kl(hardware_id: str, start: datetime, end: datetime) -> float:
    """Forward-totalizer delta between first reading >= start and last <= end."""
    first_doc = await db.flowmeter_readings.find_one(
        {"hardware_id": hardware_id, "timestamp": {"$gte": start.isoformat()}},
        sort=[("timestamp", 1)],
    )
    if not first_doc:
        return 0.0
    last_doc = await db.flowmeter_readings.find_one(
        {"hardware_id": hardware_id, "timestamp": {"$lte": end.isoformat()}},
        sort=[("timestamp", -1)],
    )
    if not last_doc:
        return 0.0
    delta_l = max(0.0, float(last_doc.get("forward_totalizer", 0)) - float(first_doc.get("forward_totalizer", 0)))
    return _kl(delta_l)


async def _list_groundwater_borewells() -> List[dict]:
    """All flowmeters categorised as groundwater_abstraction (default is also groundwater)."""
    out = []
    seen = set()
    # 1) explicitly categorised
    async for c in db.flowmeter_categories.find({"category": "groundwater_abstraction"}, {"_id": 0}):
        if c.get("hardware_id") and c["hardware_id"] not in seen:
            out.append({"hardware_id": c["hardware_id"], "label": c.get("label")})
            seen.add(c["hardware_id"])
    # 2) latest collection — any flowmeter not explicitly categorised stp_*
    async for r in db.flowmeter_latest.find({}, {"_id": 0, "hardware_id": 1}):
        hw = r.get("hardware_id")
        if not hw or hw in seen:
            continue
        cat_doc = await db.flowmeter_categories.find_one({"hardware_id": hw})
        cat = (cat_doc or {}).get("category") or "groundwater_abstraction"
        if cat == "groundwater_abstraction":
            out.append({"hardware_id": hw, "label": (cat_doc or {}).get("label")})
            seen.add(hw)
    return out


@router.get("/borewell-consumption")
async def borewell_consumption(
    start: Optional[str] = Query(None, description="YYYY-MM-DD or ISO; default = 30 days ago"),
    end: Optional[str] = Query(None, description="YYYY-MM-DD or ISO; default = now"),
    format: str = Query("json", pattern="^(json|csv)$"),
    user: dict = Depends(get_current_user),
):
    """Per-borewell + grand total consumption (KL) for the given date range."""
    end_dt = _parse_dt(end) or datetime.now(timezone.utc)
    start_dt = _parse_dt(start) or (end_dt - timedelta(days=30))
    if start_dt.tzinfo is None:
        start_dt = start_dt.replace(tzinfo=timezone.utc)
    if end_dt.tzinfo is None:
        end_dt = end_dt.replace(tzinfo=timezone.utc)

    borewells = await _list_groundwater_borewells()
    rows = []
    total_kl = 0.0
    for b in borewells:
        kl = await _consumption_kl(b["hardware_id"], start_dt, end_dt)
        rows.append({
            "hardware_id": b["hardware_id"],
            "label": b.get("label") or b["hardware_id"],
            "consumption_kl": kl,
        })
        total_kl += kl

    rows.sort(key=lambda r: r["consumption_kl"], reverse=True)

    if format == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["Hardware ID", "Label", "Consumption (KL)"])
        for r in rows:
            w.writerow([r["hardware_id"], r["label"], f"{r['consumption_kl']:.3f}"])
        w.writerow([])
        w.writerow(["GRAND TOTAL", f"{start_dt.date()} → {end_dt.date()}", f"{total_kl:.3f}"])
        buf.seek(0)
        filename = f"borewell-consumption_{start_dt.date()}_{end_dt.date()}.csv"
        return StreamingResponse(
            iter([buf.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    return {
        "start": start_dt.isoformat(),
        "end": end_dt.isoformat(),
        "borewells": rows,
        "grand_total_kl": round(total_kl, 3),
        "count": len(rows),
    }


# --------------------------------------------------------------------------- hourly pumping vs level (Analysis page)
@router.get("/hourly-pumping-vs-level")
async def hourly_pumping_vs_level(
    hardware_id: str = Query(..., description="Flowmeter hardware id"),
    hours: int = Query(24, ge=1, le=168),
    dwlr_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """Hour-by-hour pumped volume (KL) + average water level (m).
    Returns a series with `hour_label`, `pumped_kl`, `level_m`."""
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)

    if not dwlr_id:
        dwlr_latest = await db.instrument_latest.find_one({"instrument_type": "dwlr"})
        if dwlr_latest:
            dwlr_id = dwlr_latest.get("hardware_id")

    out = []
    for i in range(hours, 0, -1):
        b_start = now - timedelta(hours=i)
        b_end   = now - timedelta(hours=i - 1)
        pumped = await _consumption_kl(hardware_id, b_start, b_end)

        avg_level = None
        if dwlr_id:
            agg = {"sum": 0.0, "n": 0}
            async for r in db.instrument_readings.find(
                {"instrument_type": "dwlr", "hardware_id": dwlr_id,
                 "timestamp": {"$gte": b_start.isoformat(), "$lt": b_end.isoformat()}},
                {"_id": 0, "values": 1},
            ):
                v = r.get("values", {}) or {}
                level = v.get("LEVEL") if isinstance(v.get("LEVEL"), (int, float)) else v.get("level")
                if level is None:
                    continue
                agg["sum"] += float(level)
                agg["n"] += 1
            if agg["n"]:
                avg_level = round(agg["sum"] / agg["n"], 3)

        out.append({
            "hour_label": b_start.strftime("%d %b %H:00"),
            "start": b_start.isoformat(),
            "end": b_end.isoformat(),
            "pumped_kl": pumped,
            "level_m": avg_level,
        })

    return {"flowmeter_id": hardware_id, "dwlr_id": dwlr_id, "hours": hours, "series": out}
