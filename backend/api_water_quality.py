"""Water Quality (STP) and Dissolved-Oxygen (DO) meter API.

Two new instrument types are exposed on the existing `instrument_registry` /
`instrument_readings` / `instrument_latest` collections:

  * `wq_stp`   — STP water-quality analyser sending `COD`, `BOD`, `TSS`, `PH`.
                 Units: mg/L or ppm (numerically 1:1 for water at STP).
  * `do_meter` — Dissolved-oxygen probe monitoring TWO aeration tanks. Values
                 stored under `DO_TANK_1` and `DO_TANK_2` (0.00 – 20.00 mg/L).

The frontend page `/water-quality` renders:
  * animated gauges for each STP parameter
  * a 2-tank aeration animation whose bubble rate scales with DO reading
  * daily / weekly / monthly Recharts + CSV/PDF report download

Permission model:
  * Admins always see everything.
  * Clients see only devices they own.
  * The `view_water_quality` bit on the user document controls whether the
    top-nav item is displayed at all (admin-editable via
    `PUT /api/water-quality/permissions/{user_id}`).
"""
import csv
import io
import os
import shutil
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

import api_instrument_registry
from auth import get_current_user, require_admin
from server import db

router = APIRouter(prefix="/api/water-quality", tags=["water-quality"])

# --------------------------------------------------------------------------- upload storage

UPLOAD_ROOT = Path(__file__).parent / "uploads" / "aeration"
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)

ALLOWED_VIDEO_EXTS = {".mp4", ".webm", ".mov", ".m4v"}
MAX_VIDEO_BYTES = 60 * 1024 * 1024   # 60 MB — protects the container's ephemeral disk


# Both mg/L and ppm are supported. For dilute aqueous solutions they are
# numerically identical (1 mg/L ≈ 1 ppm for water density ≈ 1 g/mL), so the
# conversion below is a straight passthrough. Encapsulated so future
# refinements (density-based conversions for high-salinity water) remain
# backwards-compatible.
def _convert(value: float, from_unit: str, to_unit: str) -> float:
    if value is None:
        return None
    if (from_unit or "").lower() == (to_unit or "").lower():
        return round(float(value), 3)
    # mg/L ↔ ppm are equivalent for water; return unchanged.
    return round(float(value), 3)


# STP water-quality parameter keys and their typical operating bands. Used
# for the frontend gauge color-ranges when no admin-set limit is defined.
STP_PARAMS = {
    "COD": {"unit_default": "mg/L", "min": 0.0,  "max": 500.0, "safe_max": 250.0},
    "BOD": {"unit_default": "mg/L", "min": 0.0,  "max": 300.0, "safe_max": 30.0},
    "TSS": {"unit_default": "mg/L", "min": 0.0,  "max": 500.0, "safe_max": 100.0},
    "PH":  {"unit_default": "pH",   "min": 0.0,  "max": 14.0,  "safe_min": 6.5, "safe_max": 8.5},
}
DO_PARAMS = {
    "DO_TANK_1": {"unit_default": "mg/L", "min": 0.0, "max": 20.0, "safe_min": 2.0, "safe_max": 8.0},
    "DO_TANK_2": {"unit_default": "mg/L", "min": 0.0, "max": 20.0, "safe_min": 2.0, "safe_max": 8.0},
}


# --------------------------------------------------------------------------- helpers

def _has_wq_permission(user: dict) -> bool:
    """Admins always pass; clients need the `view_water_quality` flag."""
    if (user.get("role") or "").lower() == "admin":
        return True
    perms = user.get("permissions") or []
    if isinstance(perms, dict):
        return bool(perms.get("view_water_quality"))
    if isinstance(perms, list):
        return "view_water_quality" in perms
    return False


def _require_wq_view(user: dict):
    if not _has_wq_permission(user):
        raise HTTPException(
            status_code=403,
            detail=(
                "Water-quality dashboards require permission. "
                "Please contact your administrator to enable access."
            ),
        )


async def _visible(user: dict) -> Optional[set]:
    """Set of hardware_ids the user is allowed to see; None = unrestricted (admin)."""
    return await api_instrument_registry.visible_hardware_ids(user)


def _parse_dt(s: str) -> datetime:
    return datetime.fromisoformat((s or "").replace("Z", "+00:00"))


# --------------------------------------------------------------------------- schemas

class UnitPref(BaseModel):
    unit: str = Field("mg/L", description="'mg/L' or 'ppm'")


class ReportRequest(BaseModel):
    hardware_id: str
    from_date: str
    to_date: str
    format: str = Field("csv", description="'csv' | 'pdf'")
    unit: str = Field("mg/L", description="Convert numeric values to this unit label")
    # For DO meter reports only. `both` (default) returns Tank 1 + Tank 2;
    # `1` or `2` narrows the export to a single tank. Ignored for STP.
    tank: Optional[str] = Field(None, description="'1' | '2' | 'both' — DO meter only")


class SetPermissionRequest(BaseModel):
    view_water_quality: bool


# --------------------------------------------------------------------------- endpoints

@router.get("/latest")
async def latest_readings(
    unit: str = Query("mg/L", description="'mg/L' or 'ppm'"),
    user: dict = Depends(get_current_user),
):
    """Return the latest STP + DO reading for every device the user can see."""
    _require_wq_view(user)
    visible = await _visible(user)

    def _in(r):
        return visible is None or r.get("hardware_id") in visible

    stp_items: List[dict] = []
    async for r in db.instrument_latest.find({"instrument_type": "wq_stp"}, {"_id": 0}):
        if not _in(r):
            continue
        vals = dict(r.get("values") or {})
        for k in ("COD", "BOD", "TSS"):
            if vals.get(k) is not None:
                vals[k] = _convert(vals[k], "mg/L", unit)
        r["values"] = vals
        stp_items.append(r)

    do_items: List[dict] = []
    async for r in db.instrument_latest.find({"instrument_type": "do_meter"}, {"_id": 0}):
        if not _in(r):
            continue
        vals = dict(r.get("values") or {})
        for k in ("DO_TANK_1", "DO_TANK_2"):
            if vals.get(k) is not None:
                vals[k] = _convert(vals[k], "mg/L", unit)
        r["values"] = vals
        do_items.append(r)

    # Include registered devices that have never reported live data yet — the
    # UI still needs to render them (with placeholder values) so admins can
    # configure cameras, download reports, or verify device provisioning.
    seen_hw = {r.get("hardware_id") for r in stp_items + do_items}
    async for reg in db.instrument_registry.find(
        {"instrument_type": {"$in": ["wq_stp", "do_meter"]}},
        {"_id": 0},
    ):
        hw = reg.get("hardware_id")
        if hw in seen_hw:
            continue
        if visible is not None and hw not in visible:
            continue
        placeholder = {
            "hardware_id": hw,
            "instrument_type": reg.get("instrument_type"),
            "values": {},
            "received_at": None,
        }
        if reg.get("instrument_type") == "wq_stp":
            stp_items.append(placeholder)
        else:
            do_items.append(placeholder)

    # Enrich with registry meta so the UI can render a card even for devices
    # that never reported live yet.
    hw_ids = [r["hardware_id"] for r in stp_items + do_items if r.get("hardware_id")]
    regs = {}
    if hw_ids:
        async for reg in db.instrument_registry.find(
            {"hardware_id": {"$in": hw_ids}},
            {"_id": 0, "hardware_id": 1, "label": 1, "location_name": 1,
             "instrument_type": 1, "owner_user_id": 1, "dummy_config": 1,
             "plant_capacity_kld": 1, "tank_capacity_kld": 1,
             "stp_unit_config": 1, "aeration_videos": 1, "do_tank_config": 1},
        ):
            regs[reg["hardware_id"]] = reg

    # Resolve derived gardening-flushing KLD (from linked flowmeter, if any)
    # and energy usage for each STP device before returning.
    is_admin = (user or {}).get("role") == "admin"
    for hw_id, reg in list(regs.items()):
        cfg = reg.get("stp_unit_config") or {}
        derived = await _derive_stp_live_metrics(cfg)
        reg["stp_derived"] = derived
        # For non-admin clients, hide any metadata that would betray how the
        # data was entered (manual vs auto vs admin identity). Clients should
        # see the same numbers a real live-integrated pipeline would produce.
        if not is_admin:
            if reg.get("stp_unit_config"):
                sanitized = _sanitize_stp_cfg_for_client(reg["stp_unit_config"])
                if sanitized:
                    reg["stp_unit_config"] = sanitized
                else:
                    reg.pop("stp_unit_config", None)
            if reg.get("aeration_videos"):
                reg["aeration_videos"] = {
                    k: v for k, v in reg["aeration_videos"].items()
                    if not (k.endswith("_uploaded_at") or k.endswith("_uploaded_by"))
                }
            if reg.get("do_tank_config"):
                # Strip admin fingerprints from the DO tank config too.
                reg["do_tank_config"] = {
                    k: v for k, v in reg["do_tank_config"].items()
                    if k not in ("updated_at", "updated_by")
                }
            # Drop the internal energy_mode + breakdown labels that expose admin
            # bookkeeping. Only expose the total kWh figure and gardening KLD.
            if reg.get("stp_derived"):
                d = reg["stp_derived"]
                reg["stp_derived"] = {
                    "gardening_flushing_kld_today": d.get("gardening_flushing_kld_today"),
                    "energy_kwh_per_day": d.get("energy_kwh_per_day"),
                }

    for r in stp_items + do_items:
        r["_registry"] = regs.get(r.get("hardware_id"), {})

    return {
        "unit": unit,
        "stp_params_meta": STP_PARAMS,
        "do_params_meta": DO_PARAMS,
        "stp": stp_items,
        "do": do_items,
    }


@router.get("/history/{hardware_id}")
async def history(
    hardware_id: str,
    range: str = Query("daily", regex="^(daily|weekly|monthly)$"),
    unit: str = Query("mg/L"),
    user: dict = Depends(get_current_user),
):
    """Aggregated series for a single device.

    * daily   → last 24 hours, one point per hour
    * weekly  → last 7 days, one point per day
    * monthly → last 30 days, one point per day
    """
    _require_wq_view(user)
    visible = await _visible(user)
    if visible is not None and hardware_id not in visible:
        raise HTTPException(status_code=403, detail="Not authorised to view this device")

    now = datetime.now(timezone.utc)
    if range == "daily":
        since = now - timedelta(hours=24)
        bucket_fmt = "%Y-%m-%dT%H"          # hourly buckets
    elif range == "weekly":
        since = now - timedelta(days=7)
        bucket_fmt = "%Y-%m-%d"             # daily
    else:
        since = now - timedelta(days=30)
        bucket_fmt = "%Y-%m-%d"

    cursor = db.instrument_readings.find(
        {"hardware_id": hardware_id, "received_at": {"$gte": since.isoformat()}},
        {"_id": 0, "values": 1, "received_at": 1, "instrument_type": 1},
    )

    # Determine parameter keys based on the first row (or the registry type).
    reg = await db.instrument_registry.find_one(
        {"hardware_id": hardware_id}, {"_id": 0, "instrument_type": 1, "label": 1}
    )
    itype = (reg or {}).get("instrument_type", "wq_stp")
    param_keys = list(STP_PARAMS.keys()) if itype == "wq_stp" else list(DO_PARAMS.keys())

    buckets: dict = {}
    async for row in cursor:
        try:
            ts = _parse_dt(row.get("received_at") or "")
        except (ValueError, TypeError):
            continue
        key = ts.strftime(bucket_fmt)
        b = buckets.setdefault(key, {p: {"sum": 0.0, "n": 0} for p in param_keys})
        for p in param_keys:
            v = (row.get("values") or {}).get(p)
            if v is None:
                continue
            try:
                b[p]["sum"] += float(v)
                b[p]["n"] += 1
            except (TypeError, ValueError):
                continue

    series = []
    for k in sorted(buckets.keys()):
        entry = {"bucket": k}
        for p in param_keys:
            n = buckets[k][p]["n"]
            avg = buckets[k][p]["sum"] / n if n else None
            if avg is not None:
                avg = _convert(avg, "mg/L", unit)
            entry[p] = round(avg, 3) if avg is not None else None
            entry[f"{p}_samples"] = n
        series.append(entry)

    return {
        "hardware_id": hardware_id,
        "instrument_type": itype,
        "label": (reg or {}).get("label"),
        "range": range,
        "unit": unit,
        "since": since.isoformat(),
        "params": param_keys,
        "series": series,
    }


@router.post("/report")
async def report(req: ReportRequest, user: dict = Depends(get_current_user)):
    """Generate a CSV report of raw readings for a given device + date range."""
    _require_wq_view(user)
    visible = await _visible(user)
    if visible is not None and req.hardware_id not in visible:
        raise HTTPException(status_code=403, detail="Not authorised to view this device")

    try:
        from_dt = _parse_dt(req.from_date)
        to_dt = _parse_dt(req.to_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")
    if from_dt >= to_dt:
        raise HTTPException(status_code=400, detail="from_date must be before to_date")

    reg = await db.instrument_registry.find_one(
        {"hardware_id": req.hardware_id},
        {"_id": 0, "instrument_type": 1, "label": 1, "location_name": 1},
    )
    if not reg:
        raise HTTPException(status_code=404, detail="Instrument not found")
    itype = reg.get("instrument_type") or "wq_stp"
    param_keys = list(STP_PARAMS.keys()) if itype == "wq_stp" else list(DO_PARAMS.keys())

    # Narrow the DO param list when the caller asked for a specific tank.
    tank_choice = (req.tank or "both").lower() if itype == "do_meter" else "both"
    if itype == "do_meter" and tank_choice in ("1", "2"):
        param_keys = [f"DO_TANK_{tank_choice}"]

    cursor = db.instrument_readings.find(
        {"hardware_id": req.hardware_id,
         "received_at": {"$gte": from_dt.isoformat(), "$lte": to_dt.isoformat()}},
        {"_id": 0, "values": 1, "received_at": 1},
    ).sort("received_at", 1)

    fmt = (req.format or "csv").lower()
    if fmt not in ("csv", "pdf"):
        raise HTTPException(status_code=400, detail="format must be 'csv' or 'pdf'")

    if fmt == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        # Header
        w.writerow(["Envirolytics Water-Quality Report"])
        w.writerow(["Device:", reg.get("label") or req.hardware_id])
        w.writerow(["Hardware ID:", req.hardware_id])
        w.writerow(["Type:", itype])
        w.writerow(["Location:", reg.get("location_name") or "—"])
        w.writerow(["From:", from_dt.isoformat()])
        w.writerow(["To:", to_dt.isoformat()])
        w.writerow(["Unit:", req.unit])
        w.writerow([])
        w.writerow(["Received At (UTC)"] + param_keys)
        n = 0
        async for row in cursor:
            vals = row.get("values") or {}
            data_row = [row.get("received_at")]
            for p in param_keys:
                v = vals.get(p)
                if v is None:
                    data_row.append("")
                else:
                    try:
                        data_row.append(_convert(float(v), "mg/L", req.unit))
                    except (TypeError, ValueError):
                        data_row.append(v)
            w.writerow(data_row)
            n += 1
        buf.seek(0)
        tank_suffix = f"_tank{tank_choice}" if (itype == "do_meter" and tank_choice in ("1", "2")) else ""
        fname = f"wq_report_{req.hardware_id}{tank_suffix}_{from_dt.strftime('%Y%m%d')}_{to_dt.strftime('%Y%m%d')}.csv"
        return StreamingResponse(
            iter([buf.getvalue().encode("utf-8")]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={fname}"},
        )

    # PDF path
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.platypus import (
            SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
        )
        from reportlab.lib import colors
    except ImportError:
        raise HTTPException(status_code=500, detail="reportlab not installed; use format=csv")

    rows = await cursor.to_list(length=None)
    pdf_buf = io.BytesIO()
    doc = SimpleDocTemplate(pdf_buf, pagesize=A4, title="Envirolytics Water Quality Report")
    styles = getSampleStyleSheet()
    story = [
        Paragraph("<b>Envirolytics — Water Quality Report</b>", styles["Title"]),
        Spacer(1, 12),
        Paragraph(f"<b>Device:</b> {reg.get('label') or req.hardware_id}", styles["Normal"]),
        Paragraph(f"<b>Hardware ID:</b> {req.hardware_id}", styles["Normal"]),
        Paragraph(f"<b>Type:</b> {itype}", styles["Normal"]),
        Paragraph(f"<b>Location:</b> {reg.get('location_name') or '—'}", styles["Normal"]),
        Paragraph(
            f"<b>Period:</b> {from_dt.strftime('%Y-%m-%d %H:%M')} → {to_dt.strftime('%Y-%m-%d %H:%M')} UTC",
            styles["Normal"],
        ),
        Paragraph(f"<b>Unit:</b> {req.unit}", styles["Normal"]),
        Paragraph(f"<b>Rows:</b> {len(rows)}", styles["Normal"]),
        Spacer(1, 16),
    ]
    header = ["Timestamp"] + param_keys
    table_data = [header]
    for row in rows[:5000]:  # PDF row cap for performance
        vals = row.get("values") or {}
        table_row = [row.get("received_at", "")[:19]]
        for p in param_keys:
            v = vals.get(p)
            if v is None:
                table_row.append("—")
            else:
                try:
                    table_row.append(f"{_convert(float(v), 'mg/L', req.unit):.2f}")
                except (TypeError, ValueError):
                    table_row.append(str(v))
        table_data.append(table_row)
    t = Table(table_data, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a2332")),
        ("TEXTCOLOR",  (0, 0), (-1, 0), colors.white),
        ("FONTNAME",   (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",   (0, 0), (-1, -1), 8),
        ("GRID",       (0, 0), (-1, -1), 0.25, colors.grey),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f7f8fa")]),
    ]))
    story.append(t)
    doc.build(story)
    pdf_buf.seek(0)
    fname = f"wq_report_{req.hardware_id}_{from_dt.strftime('%Y%m%d')}_{to_dt.strftime('%Y%m%d')}.pdf"
    return StreamingResponse(
        iter([pdf_buf.getvalue()]),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={fname}"},
    )


@router.get("/permissions/{user_id}")
async def get_wq_permission(user_id: str, admin: dict = Depends(require_admin)):
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "email": 1, "permissions": 1})
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    perms = u.get("permissions") or []
    has = ("view_water_quality" in perms) if isinstance(perms, list) else bool(perms.get("view_water_quality"))
    return {"user_id": user_id, "email": u.get("email"), "view_water_quality": has}


@router.put("/permissions/{user_id}")
async def set_wq_permission(user_id: str, req: SetPermissionRequest,
                             admin: dict = Depends(require_admin)):
    """Grant / revoke water-quality dashboard access for a client user."""
    u = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not u:
        raise HTTPException(status_code=404, detail="User not found")

    perms = u.get("permissions") or []
    # Normalise to a list so future additions are ergonomic.
    if isinstance(perms, dict):
        perms = [k for k, v in perms.items() if v]

    perms = set(perms)
    if req.view_water_quality:
        perms.add("view_water_quality")
    else:
        perms.discard("view_water_quality")

    await db.users.update_one({"id": user_id}, {"$set": {"permissions": sorted(perms)}})
    await db.audit_log.insert_one({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "entity_type": "user_permission",
        "entity_id": user_id,
        "action": "grant" if req.view_water_quality else "revoke",
        "actor_id": admin.get("id"),
        "actor_email": admin.get("email"),
        "detail": {"permission": "view_water_quality", "value": req.view_water_quality},
    })
    return {"success": True, "user_id": user_id, "view_water_quality": req.view_water_quality}


@router.get("/me/permission")
async def my_wq_permission(user: dict = Depends(get_current_user)):
    """Small helper called by the frontend to decide whether to render the
    water-quality tab in the sidebar."""
    return {"view_water_quality": _has_wq_permission(user)}


# ─────────────────────────────────────────────────────────────────────────
# STP unit-level configuration + aeration video upload + energy compilation
# ─────────────────────────────────────────────────────────────────────────

class AirBlowerCfg(BaseModel):
    label: str = Field(default="Blower")
    capacity_m3ph: Optional[float] = Field(default=None, ge=0, description="Air delivery capacity in m³/hr")
    power_kw: Optional[float] = Field(default=None, ge=0)
    running_hours_per_day: Optional[float] = Field(default=None, ge=0, le=24)


class PumpCfg(BaseModel):
    capacity_kld: Optional[float] = Field(default=None, ge=0, description="Flow capacity in KLD")
    power_kw: Optional[float] = Field(default=None, ge=0)
    running_hours_per_day: Optional[float] = Field(default=None, ge=0, le=24)


class GardeningCfg(BaseModel):
    source: Literal["manual", "flowmeter"] = "manual"
    linked_flowmeter_hw_id: Optional[str] = Field(default=None, description="hardware_id of an existing flowmeter device to pull consumption from")
    manual_kld_per_day: Optional[float] = Field(default=None, ge=0)
    pump_power_kw: Optional[float] = Field(default=None, ge=0)
    running_hours_per_day: Optional[float] = Field(default=None, ge=0, le=24)


class EnergyCfg(BaseModel):
    mode: Literal["auto", "manual"] = "auto"
    manual_kwh_per_day: Optional[float] = Field(default=None, ge=0)


class ParamRange(BaseModel):
    """Realistic operating band for a single STP effluent parameter.

    When the physical instrument is offline the dummy-data service picks a
    random value from this band (with a small bounded random-walk so the
    reading looks organic, not constant).
    """
    min: Optional[float] = Field(default=None, description="Lower bound (inclusive)")
    max: Optional[float] = Field(default=None, description="Upper bound (inclusive)")


class STPParamRanges(BaseModel):
    COD: Optional[ParamRange] = None
    BOD: Optional[ParamRange] = None
    TSS: Optional[ParamRange] = None
    PH: Optional[ParamRange] = None


class DummyAutoPushCfg(BaseModel):
    """Configures automatic daily dummy-data push for STP effluent params
    when the physical instrument is not sending data."""
    enabled: bool = False
    interval_seconds: int = Field(default=86400, ge=60, le=86400, description="How often to push. Default: 86400 = once per day.")


class STPUnitConfig(BaseModel):
    equalization_tank_kld: Optional[float] = Field(default=None, ge=0)
    aeration_tank_kld: Optional[float] = Field(default=None, ge=0)
    settling_tank_kld: Optional[float] = Field(default=None, ge=0)
    filter_feed_tank_kld: Optional[float] = Field(default=None, ge=0)
    treated_water_tank_kld: Optional[float] = Field(default=None, ge=0)
    air_blowers: List[AirBlowerCfg] = Field(default_factory=list)
    filter_feed_pump: Optional[PumpCfg] = None
    gardening_flushing: Optional[GardeningCfg] = None
    energy: Optional[EnergyCfg] = None
    # Admin-configurable range per parameter used by the dummy-data auto-push.
    param_ranges: Optional[STPParamRanges] = None
    dummy_auto_push: Optional[DummyAutoPushCfg] = None


async def _flowmeter_daily_kld(hardware_id: str) -> Optional[float]:
    """Sum of `TOTAL` (or `VOLUME`) delta for the last 24 h from a flowmeter.

    Returns None if the flowmeter is unknown or reports no data. The
    `flowmeter_readings` schema stores `values.TOTAL` as a running total, so
    we take max - min over the window.
    """
    if not hardware_id:
        return None
    since = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    cursor = db.flowmeter_readings.find(
        {"hardware_id": hardware_id, "received_at": {"$gte": since}},
        {"_id": 0, "values": 1, "received_at": 1},
    ).sort("received_at", 1)
    lo, hi = None, None
    async for row in cursor:
        v = (row.get("values") or {}).get("TOTAL")
        if v is None:
            v = (row.get("values") or {}).get("VOLUME")
        if v is None:
            continue
        try:
            fv = float(v)
        except (TypeError, ValueError):
            continue
        lo = fv if lo is None or fv < lo else lo
        hi = fv if hi is None or fv > hi else hi
    if lo is None or hi is None:
        return None
    # Assume flowmeter TOTAL is in KL (kilolitres) — matches how the rest of
    # the app treats flowmeter data. If your firmware emits m³, the numeric
    # value is identical (1 KL = 1 m³).
    return max(0.0, round(hi - lo, 3))


def _sanitize_stp_cfg_for_client(cfg: dict) -> dict:
    """Return a client-safe copy of `stp_unit_config`.

    Strips any field that reveals admin bookkeeping (updated_at, updated_by,
    gardening_flushing.source, energy.mode, energy.manual_kwh_per_day) so
    clients cannot tell whether a number was manually entered or computed.
    """
    if not cfg:
        return {}
    out = {k: v for k, v in cfg.items() if k not in ("updated_at", "updated_by")}
    if isinstance(out.get("gardening_flushing"), dict):
        gf = {k: v for k, v in out["gardening_flushing"].items()
              if k not in ("source", "manual_kld_per_day", "linked_flowmeter_hw_id")}
        out["gardening_flushing"] = gf
    # Always drop the energy block for clients — even if it's null/empty the
    # key itself still tells clients "there's a mode toggle admins can set",
    # which is exactly what we want to hide.
    out.pop("energy", None)
    return out


async def _derive_stp_live_metrics(cfg: dict) -> dict:
    """Compute derived KLD and kWh figures shown on the SCADA plant diagram.

    * gardening_flushing_kld_today → either the manual value or a daily delta
      pulled from the linked flowmeter's `TOTAL` counter.
    * energy_kwh_per_day → manual override or Σ (blower kW + pump kW) × hrs.
    """
    out = {
        "gardening_flushing_kld_today": None,
        "energy_kwh_per_day": None,
        "energy_mode": "auto",
        "energy_breakdown": [],
    }
    if not cfg:
        return out

    # Gardening / flushing throughput
    gcfg = cfg.get("gardening_flushing") or {}
    if gcfg.get("source") == "flowmeter" and gcfg.get("linked_flowmeter_hw_id"):
        val = await _flowmeter_daily_kld(gcfg["linked_flowmeter_hw_id"])
        out["gardening_flushing_kld_today"] = val
    elif gcfg.get("manual_kld_per_day") is not None:
        out["gardening_flushing_kld_today"] = float(gcfg["manual_kld_per_day"])

    # Energy
    ecfg = cfg.get("energy") or {}
    mode = ecfg.get("mode") or "auto"
    out["energy_mode"] = mode
    if mode == "manual" and ecfg.get("manual_kwh_per_day") is not None:
        out["energy_kwh_per_day"] = float(ecfg["manual_kwh_per_day"])
        return out

    # Auto mode — sum every configured electrical load
    total = 0.0
    breakdown: List[dict] = []
    for i, blower in enumerate(cfg.get("air_blowers") or []):
        p = blower.get("power_kw") or 0
        h = blower.get("running_hours_per_day") or 0
        kwh = float(p) * float(h)
        if kwh:
            breakdown.append({"label": blower.get("label") or f"Blower {i+1}", "kwh": round(kwh, 2)})
            total += kwh

    ffp = cfg.get("filter_feed_pump") or {}
    kwh = float(ffp.get("power_kw") or 0) * float(ffp.get("running_hours_per_day") or 0)
    if kwh:
        breakdown.append({"label": "Filter Feed Pump", "kwh": round(kwh, 2)})
        total += kwh

    gkwh = float(gcfg.get("pump_power_kw") or 0) * float(gcfg.get("running_hours_per_day") or 0)
    if gkwh:
        breakdown.append({"label": "Gardening Pump", "kwh": round(gkwh, 2)})
        total += gkwh

    out["energy_kwh_per_day"] = round(total, 2) if total else None
    out["energy_breakdown"] = breakdown
    return out


@router.get("/{hardware_id}/stp-config")
async def get_stp_config(hardware_id: str, admin: dict = Depends(require_admin)):
    """Read the STP unit-level configuration for a device (admin-only)."""
    reg = await db.instrument_registry.find_one(
        {"hardware_id": hardware_id},
        {"_id": 0, "hardware_id": 1, "label": 1, "instrument_type": 1,
         "plant_capacity_kld": 1, "stp_unit_config": 1, "aeration_videos": 1},
    )
    if not reg:
        raise HTTPException(status_code=404, detail="Instrument not found")
    reg["stp_derived"] = await _derive_stp_live_metrics(reg.get("stp_unit_config") or {})
    return reg


@router.put("/{hardware_id}/stp-config")
async def update_stp_config(hardware_id: str, cfg: STPUnitConfig,
                             admin: dict = Depends(require_admin)):
    """Admin-only: persist per-unit capacities, energy config and pump wiring."""
    reg = await db.instrument_registry.find_one({"hardware_id": hardware_id})
    if not reg:
        raise HTTPException(status_code=404, detail="Instrument not found")

    # Validate flowmeter linkage if provided
    if cfg.gardening_flushing and cfg.gardening_flushing.source == "flowmeter":
        fm_id = cfg.gardening_flushing.linked_flowmeter_hw_id
        if not fm_id:
            raise HTTPException(status_code=400, detail="linked_flowmeter_hw_id is required when source='flowmeter'")
        fm = await db.instrument_registry.find_one({"hardware_id": fm_id, "instrument_type": "flowmeter"})
        if not fm:
            raise HTTPException(status_code=404, detail=f"Linked flowmeter '{fm_id}' not found")

    doc = cfg.model_dump(exclude_none=False)
    doc["updated_at"] = datetime.now(timezone.utc).isoformat()
    doc["updated_by"] = admin.get("email")

    update_ops: dict = {"stp_unit_config": doc}

    # If the admin flipped "auto-push dummy data when instrument is offline"
    # on, mirror that intent into `dummy_config` (which the background
    # generator actually reads). We compute overall min/max as the widest of
    # all configured parameter ranges — the per-param band still wins inside
    # the generator, this is only used as a legacy safety net.
    dap = doc.get("dummy_auto_push") or {}
    if dap.get("enabled"):
        pr = doc.get("param_ranges") or {}
        mins, maxs = [], []
        for band in pr.values() or []:
            if isinstance(band, dict):
                if band.get("min") is not None: mins.append(float(band["min"]))
                if band.get("max") is not None: maxs.append(float(band["max"]))
        overall_lo = min(mins) if mins else 0.0
        overall_hi = max(maxs) if maxs else 500.0
        if overall_hi <= overall_lo:
            overall_hi = overall_lo + 1.0
        interval = int(dap.get("interval_seconds") or 86400)
        update_ops["dummy_config"] = {
            "enabled": True,
            "min_value": overall_lo,
            "max_value": overall_hi,
            "interval_seconds": interval,
            "auto_from_stp_cfg": True,           # marker so we can detect this later
            "updated_at": doc["updated_at"],
            "updated_by": admin.get("email"),
        }
    else:
        # Turn off auto-push if the flag is now false but was previously
        # driven by STP-config (leave manually-enabled dummy_configs alone).
        existing_cfg = reg.get("dummy_config") or {}
        if existing_cfg.get("auto_from_stp_cfg"):
            update_ops["dummy_config"] = {**existing_cfg, "enabled": False}

    await db.instrument_registry.update_one(
        {"hardware_id": hardware_id},
        {"$set": update_ops},
    )
    await db.audit_log.insert_one({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "entity_type": "stp_unit_config",
        "entity_id": hardware_id,
        "action": "update",
        "actor_id": admin.get("id"),
        "actor_email": admin.get("email"),
    })
    derived = await _derive_stp_live_metrics(doc)
    return {"success": True, "stp_unit_config": doc, "stp_derived": derived}


# ─────────── Aeration video upload (per aeration tank) ───────────

@router.post("/{hardware_id}/aeration-video/{tank_number}")
async def upload_aeration_video(hardware_id: str, tank_number: int,
                                 file: UploadFile = File(...),
                                 admin: dict = Depends(require_admin)):
    """Admin-only: upload a recorded MP4 of the actual aeration tank.

    The uploaded file replaces any previous video for the same tank on the
    same device. Files are stored on disk and served under
    `/api/uploads/aeration/…` by the FastAPI static mount.
    """
    if tank_number not in (1, 2):
        raise HTTPException(status_code=400, detail="tank_number must be 1 or 2")

    reg = await db.instrument_registry.find_one({"hardware_id": hardware_id})
    if not reg:
        raise HTTPException(status_code=404, detail="Instrument not found")

    ext = os.path.splitext(file.filename or "")[1].lower() or ".mp4"
    if ext not in ALLOWED_VIDEO_EXTS:
        raise HTTPException(status_code=400, detail=f"Unsupported video extension. Allowed: {sorted(ALLOWED_VIDEO_EXTS)}")

    # Stream to disk with a size guard so a huge upload can't fill the pod.
    safe_hw = hardware_id.replace("/", "_")
    fname = f"{safe_hw}_tank{tank_number}_{uuid.uuid4().hex[:10]}{ext}"
    dest = UPLOAD_ROOT / fname
    total = 0
    try:
        with dest.open("wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)  # 1 MB
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_VIDEO_BYTES:
                    out.close()
                    dest.unlink(missing_ok=True)
                    raise HTTPException(status_code=413, detail=f"File exceeds {MAX_VIDEO_BYTES // (1024*1024)} MB")
                out.write(chunk)
    except HTTPException:
        raise
    except Exception as e:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")

    url = f"/api/uploads/aeration/{fname}"
    key = f"tank_{tank_number}"

    # Purge the previous file (if any) to keep disk usage bounded.
    prev = ((reg.get("aeration_videos") or {}).get(key) or "").rsplit("/", 1)[-1]
    if prev and prev != fname:
        (UPLOAD_ROOT / prev).unlink(missing_ok=True)

    await db.instrument_registry.update_one(
        {"hardware_id": hardware_id},
        {"$set": {
            f"aeration_videos.{key}": url,
            f"aeration_videos.{key}_uploaded_at": datetime.now(timezone.utc).isoformat(),
            f"aeration_videos.{key}_uploaded_by": admin.get("email"),
        }},
    )
    return {"success": True, "tank_number": tank_number, "url": url, "bytes": total}


@router.delete("/{hardware_id}/aeration-video/{tank_number}")
async def delete_aeration_video(hardware_id: str, tank_number: int,
                                 admin: dict = Depends(require_admin)):
    """Admin-only: remove the uploaded video and revert to the built-in demo clip."""
    if tank_number not in (1, 2):
        raise HTTPException(status_code=400, detail="tank_number must be 1 or 2")
    reg = await db.instrument_registry.find_one({"hardware_id": hardware_id})
    if not reg:
        raise HTTPException(status_code=404, detail="Instrument not found")
    key = f"tank_{tank_number}"
    current = ((reg.get("aeration_videos") or {}).get(key) or "").rsplit("/", 1)[-1]
    if current:
        (UPLOAD_ROOT / current).unlink(missing_ok=True)
    await db.instrument_registry.update_one(
        {"hardware_id": hardware_id},
        {"$unset": {
            f"aeration_videos.{key}": "",
            f"aeration_videos.{key}_uploaded_at": "",
            f"aeration_videos.{key}_uploaded_by": "",
        }},
    )
    return {"success": True, "tank_number": tank_number}


# ─────────── DO tank capacity (per-tank, admin-editable) ───────────

class DOTankConfig(BaseModel):
    tank_1_kld: Optional[float] = Field(default=None, ge=0, description="Aeration Tank 1 capacity in KLD")
    tank_2_kld: Optional[float] = Field(default=None, ge=0, description="Aeration Tank 2 capacity in KLD")


@router.put("/{hardware_id}/do-tank-config")
async def update_do_tank_config(hardware_id: str, cfg: DOTankConfig,
                                 admin: dict = Depends(require_admin)):
    """Admin-only: save independent capacity values for the two aeration
    tanks on a `do_meter` device. Each tank gets its own KLD figure so ops
    can model asymmetric plants (e.g. Tank 1 = 250 KLD, Tank 2 = 180 KLD)."""
    reg = await db.instrument_registry.find_one({"hardware_id": hardware_id})
    if not reg:
        raise HTTPException(status_code=404, detail="Instrument not found")
    if reg.get("instrument_type") != "do_meter":
        raise HTTPException(status_code=400, detail="do-tank-config only applies to do_meter devices")
    doc = cfg.model_dump(exclude_none=False)
    doc["updated_at"] = datetime.now(timezone.utc).isoformat()
    doc["updated_by"] = admin.get("email")
    await db.instrument_registry.update_one(
        {"hardware_id": hardware_id},
        {"$set": {"do_tank_config": doc}},
    )
    await db.audit_log.insert_one({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "entity_type": "do_tank_config",
        "entity_id": hardware_id,
        "action": "update",
        "actor_id": admin.get("id"),
        "actor_email": admin.get("email"),
    })
    return {"success": True, "do_tank_config": doc}
