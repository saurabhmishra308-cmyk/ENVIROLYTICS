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
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

import api_instrument_registry
from auth import get_current_user, require_admin
from server import db

router = APIRouter(prefix="/api/water-quality", tags=["water-quality"])

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

    # Enrich with registry meta so the UI can render a card even for devices
    # that never reported live yet.
    hw_ids = [r["hardware_id"] for r in stp_items + do_items if r.get("hardware_id")]
    regs = {}
    if hw_ids:
        async for reg in db.instrument_registry.find(
            {"hardware_id": {"$in": hw_ids}},
            {"_id": 0, "hardware_id": 1, "label": 1, "location_name": 1,
             "instrument_type": 1, "owner_user_id": 1, "dummy_config": 1},
        ):
            regs[reg["hardware_id"]] = reg
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
        fname = f"wq_report_{req.hardware_id}_{from_dt.strftime('%Y%m%d')}_{to_dt.strftime('%Y%m%d')}.csv"
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
