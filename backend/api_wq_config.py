"""STP unit configuration, aeration video upload, DO tank config and WQ
thresholds — admin-only endpoints.

Split out of `api_water_quality.py` (which keeps the read/report endpoints)
to keep module sizes manageable. Same URL prefix; served by its own router.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional, Literal

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel, Field

from auth import require_admin
from server import db

router = APIRouter(prefix="/api/water-quality", tags=["water-quality"])

# --------------------------------------------------------------------------- upload storage

UPLOAD_ROOT = Path(__file__).parent / "uploads" / "aeration"
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)

ALLOWED_VIDEO_EXTS = {".mp4", ".webm", ".mov", ".m4v"}
MAX_VIDEO_BYTES = 60 * 1024 * 1024   # 60 MB — protects the container's ephemeral disk


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
        {"hardware_id": hardware_id, "received_at": {"$gte": since},
         "_dummy": {"$ne": True}},
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


# ─────────── Turbidity coefficient + chlorine dosing band (admin-editable) ───────────

class WQThresholdsConfig(BaseModel):
    """Admin-editable per-device tuning:
    * `turbidity_k` — coefficient applied to TSS when the device doesn't send
      turbidity directly. Default 0.5 (TSS/2, domestic-sewage rule of thumb).
    * `chlorine_min` / `chlorine_max` — free residual chlorine (mg/L). Any
      reading below `min` triggers an *"Increase dosing"* alert; anything
      above `max` triggers *"Decrease dosing"*.
    * `chlorine_dose_target_mg_l` — setpoint the automated recommendation
      aims for. Defaults to the midpoint of `min`/`max` when unset.
    * `chlorine_solution_pct` — NaOCl solution strength (%, default 12).
    * `chlorine_pump_kw` — dosing-pump rated kW (used for the energy tally).
    * `chlorine_flow_kld` — plant flow through the analyser (KLD, ≡ m³/day).
      Falls back to `plant_capacity_kld` when unset.
    """
    turbidity_k: Optional[float] = Field(default=None, ge=0.0, le=5.0)
    chlorine_min: Optional[float] = Field(default=None, ge=0.0, le=10.0)
    chlorine_max: Optional[float] = Field(default=None, ge=0.0, le=10.0)
    chlorine_dose_target_mg_l: Optional[float] = Field(default=None, ge=0.0, le=10.0)
    chlorine_solution_pct: Optional[float] = Field(default=None, ge=0.5, le=100.0)
    chlorine_pump_kw: Optional[float] = Field(default=None, ge=0.0, le=100.0)
    chlorine_flow_kld: Optional[float] = Field(default=None, ge=0.0, le=1_000_000.0)


@router.put("/{hardware_id}/thresholds")
async def update_wq_thresholds(
    hardware_id: str,
    cfg: WQThresholdsConfig,
    admin: dict = Depends(require_admin),
):
    reg = await db.instrument_registry.find_one({"hardware_id": hardware_id})
    if not reg:
        raise HTTPException(status_code=404, detail="Instrument not found")
    itype = reg.get("instrument_type")
    if itype not in ("wq_stp", "chlorine_analyzer", "do_meter"):
        raise HTTPException(status_code=400, detail="thresholds only apply to wq_stp / do_meter / chlorine_analyzer")

    updates: dict = {}
    if cfg.turbidity_k is not None:
        updates["turbidity_k"] = float(cfg.turbidity_k)
    if cfg.chlorine_min is not None:
        updates["chlorine_min"] = float(cfg.chlorine_min)
    if cfg.chlorine_max is not None:
        updates["chlorine_max"] = float(cfg.chlorine_max)
    if cfg.chlorine_dose_target_mg_l is not None:
        updates["chlorine_dose_target_mg_l"] = float(cfg.chlorine_dose_target_mg_l)
    if cfg.chlorine_solution_pct is not None:
        updates["chlorine_solution_pct"] = float(cfg.chlorine_solution_pct)
    if cfg.chlorine_pump_kw is not None:
        updates["chlorine_pump_kw"] = float(cfg.chlorine_pump_kw)
    if cfg.chlorine_flow_kld is not None:
        updates["chlorine_flow_kld"] = float(cfg.chlorine_flow_kld)
    if updates.get("chlorine_min") is not None and updates.get("chlorine_max") is not None:
        if updates["chlorine_min"] >= updates["chlorine_max"]:
            raise HTTPException(status_code=400, detail="chlorine_min must be less than chlorine_max")
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    await db.instrument_registry.update_one({"hardware_id": hardware_id}, {"$set": updates})
    await db.audit_log.insert_one({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "entity_type": "wq_thresholds",
        "entity_id": hardware_id,
        "action": "update",
        "actor_id": admin.get("id"),
        "actor_email": admin.get("email"),
        "changes": updates,
    })
    return {"success": True, **updates}

