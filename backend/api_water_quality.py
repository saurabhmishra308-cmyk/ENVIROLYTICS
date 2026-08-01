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
from typing import List, Optional, Literal, Dict

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

import api_instrument_registry
from auth import get_current_user, require_admin
from server import db

router = APIRouter(prefix="/api/water-quality", tags=["water-quality"])

# --------------------------------------------------------------------------- upload storage

# Upload constants + STP-config helpers moved to api_wq_config.py.
from api_wq_config import (  # noqa: E402,F401
    UPLOAD_ROOT,
    _derive_stp_live_metrics,
    _sanitize_stp_cfg_for_client,
)

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
    "COD":       {"unit_default": "mg/L", "min": 0.0,  "max": 500.0, "safe_max": 250.0},
    "BOD":       {"unit_default": "mg/L", "min": 0.0,  "max": 300.0, "safe_max": 30.0},
    "TSS":       {"unit_default": "mg/L", "min": 0.0,  "max": 500.0, "safe_max": 100.0},
    "PH":        {"unit_default": "pH",   "min": 0.0,  "max": 14.0,  "safe_min": 6.5, "safe_max": 8.5},
    # Turbidity is *derived* from TSS unless the device sends it directly.
    # See `_derive_turbidity()` — the safe upper band mirrors CPCB norms.
    "TURBIDITY": {"unit_default": "NTU",  "min": 0.0,  "max": 500.0, "safe_max": 10.0},
    # Free residual chlorine on the STP effluent line.
    "CHLORINE":  {"unit_default": "mg/L", "min": 0.0,  "max": 5.0,   "safe_min": 0.2, "safe_max": 2.0},
}
DO_PARAMS = {
    "DO_TANK_1":     {"unit_default": "mg/L", "min": 0.0, "max": 20.0, "safe_min": 2.0, "safe_max": 8.0},
    "DO_TANK_2":     {"unit_default": "mg/L", "min": 0.0, "max": 20.0, "safe_min": 2.0, "safe_max": 8.0},
    # Device-reported water temperature (from QESPL param `Temperature`).
    # Wide safe band — the aeration alerts key off DO, not temperature.
    "TEMPER":        {"unit_default": "°C",   "min": 0.0, "max": 60.0, "safe_min": 5.0, "safe_max": 45.0},
    # Dissolved-oxygen saturation percent — from QESPL param `Saturation`.
    "DO_SATURATION": {"unit_default": "%",    "min": 0.0, "max": 200.0, "safe_min": 40.0, "safe_max": 120.0},
}
# Dedicated chlorine-analyser device. Emits `CHLORINE` (free residual, mg/L)
# and optionally `CHLORINE_DOSE` (setpoint the dosing pump is currently
# holding). Alerts key off `CHLORINE` against the admin-configurable band
# `chlorine_min` / `chlorine_max` on the registry doc (defaults 0.2 / 2.0).
CHLORINE_PARAMS = {
    "CHLORINE":      {"unit_default": "mg/L", "min": 0.0, "max": 5.0, "safe_min": 0.2, "safe_max": 2.0},
    "CHLORINE_DOSE": {"unit_default": "mg/L", "min": 0.0, "max": 5.0, "safe_min": 0.5, "safe_max": 3.0},
}

# Default alert band for free residual chlorine (mg/L). Overridable per device.
CHLORINE_MIN_DEFAULT = 0.2
CHLORINE_MAX_DEFAULT = 2.0
# Default TSS→Turbidity coefficient (0.5 ≈ TSS/2, standard for domestic sewage).
TURBIDITY_K_DEFAULT = 0.5


def _derive_turbidity(values: dict, k: float | None = None) -> None:
    """In-place: fill `values['TURBIDITY']` from `values['TSS'] * k` when the
    device didn't send turbidity directly. No-op if either TSS is missing or
    TURBIDITY is already present with a numeric value."""
    if not isinstance(values, dict):
        return
    if isinstance(values.get("TURBIDITY"), (int, float)):
        return
    tss = values.get("TSS")
    if not isinstance(tss, (int, float)):
        return
    coef = float(k) if isinstance(k, (int, float)) else TURBIDITY_K_DEFAULT
    values["TURBIDITY"] = round(tss * coef, 2)


def _chlorine_status(value: float | None, cmin: float, cmax: float) -> dict:
    """Return an alert descriptor for a single free-chlorine reading.
    `status`: 'low' | 'ok' | 'high' | 'unknown'.
    `action`: human-readable next step surfaced on the tile."""
    if not isinstance(value, (int, float)):
        return {"status": "unknown", "action": None, "min": cmin, "max": cmax}
    if value < cmin:
        return {"status": "low", "action": "Increase dosing", "min": cmin, "max": cmax}
    if value > cmax:
        return {"status": "high", "action": "Decrease dosing", "min": cmin, "max": cmax}
    return {"status": "ok", "action": "Optimal", "min": cmin, "max": cmax}


# NaOCl (12 % w/v) density in kg/L. Constant across the app — used to convert
# the required chlorine-mass dose (kg pure Cl₂ per day) into a solution volume
# for the dosing pump. 1.2 kg/L is standard for commercial 12 % NaOCl.
_NAOCL_DENSITY_KG_PER_L = 1.2


def _dose_recommendation(
    current_cl: float | None,
    target_cl: float | None,
    flow_kld: float | None,
    solution_pct: float | None,
    pump_kw: float | None,
) -> dict | None:
    """Compute a plant-wide dose recommendation.

    Returns a dict describing how much sodium-hypochlorite solution should
    be dosed per day / per minute to move `current_cl` toward `target_cl`
    given the plant's flow (`flow_kld` — kilolitres per day, ≡ m³/day).

    * `delta_mg_l` — signed target − current gap (positive ⇒ need to dose more)
    * `dose_kg_per_day` — mass of pure Cl₂ equivalent required (or excess if negative)
    * `solution_l_per_day` — volume of NaOCl at `solution_pct` % strength
    * `solution_ml_per_min` — pump rate equivalent (60·24 = 1440 min/day)
    * `direction` — 'increase' | 'decrease' | 'hold'
    * `energy_kwh_per_day` — dosing-pump energy contribution (kW × hours pump likely runs; assume 24 h if delta≠0)

    Returns None when required inputs are missing (caller decides how to render).
    """
    if not isinstance(current_cl, (int, float)) or not isinstance(target_cl, (int, float)):
        return None
    if not isinstance(flow_kld, (int, float)) or flow_kld <= 0:
        return None
    pct = float(solution_pct) if isinstance(solution_pct, (int, float)) and solution_pct > 0 else 12.0
    delta = float(target_cl) - float(current_cl)
    # mg/L × KLD (= m³/day) × 10⁻³ = kg/day
    dose_kg_day = round(delta * float(flow_kld) / 1000.0, 4)
    # kg pure Cl₂ / (pct% × density) → litres of NaOCl solution per day
    solution_l_day = round(abs(dose_kg_day) / ((pct / 100.0) * _NAOCL_DENSITY_KG_PER_L), 3)
    solution_ml_min = round(solution_l_day * 1000.0 / 1440.0, 2)
    if delta > 0.02:
        direction = "increase"
    elif delta < -0.02:
        direction = "decrease"
    else:
        direction = "hold"
    pump_energy = None
    if isinstance(pump_kw, (int, float)) and pump_kw > 0 and direction != "hold":
        # Assume the dosing pump runs continuously while the plant is on.
        pump_energy = round(float(pump_kw) * 24.0, 2)
    return {
        "target_mg_l": float(target_cl),
        "current_mg_l": float(current_cl),
        "delta_mg_l": round(delta, 3),
        "direction": direction,
        "flow_kld": float(flow_kld),
        "solution_pct": pct,
        "dose_kg_per_day": abs(dose_kg_day),
        "dose_signed_kg_per_day": dose_kg_day,
        "solution_l_per_day": solution_l_day,
        "solution_ml_per_min": solution_ml_min,
        "energy_kwh_per_day": pump_energy,
    }


# --------------------------------------------------------------------------- helpers

def _has_wq_permission(user: dict) -> bool:
    """Admins always pass. Non-admins are granted WQ view when EITHER
    system says yes:
      (a) the legacy `permissions.view_water_quality` flag is True, OR
      (b) the new View Access dialog toggle `view_permissions.water_quality`
          is True (missing key = True by default, matching the admin UI).
    Rule from the product owner: "when admin has permitted the tab, the
    client must see it — no additional gate." So (b) alone is enough.
    """
    if (user.get("role") or "").lower() == "admin":
        return True
    # (b) New View Access — the source of truth going forward.
    vp = user.get("view_permissions") or {}
    if vp.get("water_quality", True):
        return True
    # (a) Legacy per-user permissions map (kept for backward compat).
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
    async for r in db.instrument_latest.find({"instrument_type": "wq_stp", "_dummy": {"$ne": True}}, {"_id": 0}):
        if not _in(r):
            continue
        vals = dict(r.get("values") or {})
        for k in ("COD", "BOD", "TSS"):
            if vals.get(k) is not None:
                vals[k] = _convert(vals[k], "mg/L", unit)
        r["values"] = vals
        stp_items.append(r)

    do_items: List[dict] = []
    async for r in db.instrument_latest.find({"instrument_type": "do_meter", "_dummy": {"$ne": True}}, {"_id": 0}):
        if not _in(r):
            continue
        vals = dict(r.get("values") or {})
        for k in ("DO_TANK_1", "DO_TANK_2"):
            if vals.get(k) is not None:
                vals[k] = _convert(vals[k], "mg/L", unit)
        r["values"] = vals
        do_items.append(r)

    # ----- Per-device tank labelling (no cross-device merge) -----
    # Each physical DO Analyzer covers ONE aeration tank (mapped by
    # `aeration_tank_number` at registration). Each device is rendered as
    # its own card showing ONLY its own tank — the user picks a device
    # from the pill list to view that tank.
    #
    # IMPORTANT: We always re-derive `DO_TANK_<n>` from the CURRENT
    # `aeration_tank_number` in the registry (never trust the pre-baked
    # `DO_TANK_N` key stored by the poller). Otherwise, when an admin
    # remaps a device from Tank 1 to Tank 2 via the linker, the stale
    # `DO_TANK_1` key that the poller wrote before the remap would still
    # show — showing the wrong reading on the wrong tank.
    if do_items:
        do_hws = [r.get("hardware_id") for r in do_items if r.get("hardware_id")]
        registry_map: Dict[str, dict] = {}
        async for reg in db.instrument_registry.find(
            {"hardware_id": {"$in": do_hws}},
            {"_id": 0, "hardware_id": 1, "owner_user_id": 1, "aeration_tank_number": 1},
        ):
            registry_map[reg["hardware_id"]] = reg
        for r in do_items:
            hw = r.get("hardware_id")
            reg = registry_map.get(hw) or {}
            tn = reg.get("aeration_tank_number")
            raw_vals = r.get("values") or {}
            # Strip any pre-baked DO_TANK_* keys — re-derive from current mapping.
            vals = {k: v for k, v in raw_vals.items() if not k.startswith("DO_TANK_")}
            do_val = vals.get("DO")
            if isinstance(tn, int) and do_val is not None:
                vals[f"DO_TANK_{tn}"] = do_val
            elif not isinstance(tn, int):
                # Safety net for devices that don't have `aeration_tank_number`
                # set in the registry yet — surface whatever DO_TANK_* the
                # poller baked in previously so the tank tile still shows
                # live data instead of going blank. If neither is present,
                # fall back to Tank 1 using the raw `DO` value so a freshly
                # provisioned DO Analyzer isn't invisible until an admin
                # remembers to configure the aeration tank number.
                found_any = False
                for k, v in raw_vals.items():
                    if k.startswith("DO_TANK_") and v is not None:
                        vals[k] = v
                        found_any = True
                if not found_any and do_val is not None:
                    vals["DO_TANK_1"] = do_val
            r["values"] = vals

    chlorine_items: List[dict] = []
    async for r in db.instrument_latest.find({"instrument_type": "chlorine_analyzer", "_dummy": {"$ne": True}}, {"_id": 0}):
        if not _in(r):
            continue
        r["values"] = dict(r.get("values") or {})
        chlorine_items.append(r)

    # Include registered devices that have never reported live data yet — the
    # UI still needs to render them (with placeholder values) so admins can
    # configure cameras, download reports, or verify device provisioning.
    seen_hw = {r.get("hardware_id") for r in stp_items + do_items + chlorine_items}
    async for reg in db.instrument_registry.find(
        {"instrument_type": {"$in": ["wq_stp", "do_meter", "chlorine_analyzer"]}},
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
        elif reg.get("instrument_type") == "do_meter":
            do_items.append(placeholder)
        else:
            chlorine_items.append(placeholder)

    # Enrich with registry meta so the UI can render a card even for devices
    # that never reported live yet.
    hw_ids = [r["hardware_id"] for r in stp_items + do_items + chlorine_items if r.get("hardware_id")]
    regs = {}
    if hw_ids:
        async for reg in db.instrument_registry.find(
            {"hardware_id": {"$in": hw_ids}},
            {"_id": 0, "hardware_id": 1, "label": 1, "location_name": 1,
             "instrument_type": 1, "owner_user_id": 1, "dummy_config": 1,
             "plant_capacity_kld": 1, "tank_capacity_kld": 1,
             "aeration_tank_number": 1,
             "stp_unit_config": 1, "aeration_videos": 1, "do_tank_config": 1,
             "turbidity_k": 1, "chlorine_min": 1, "chlorine_max": 1,
             "chlorine_dose_target_mg_l": 1, "chlorine_solution_pct": 1,
             "chlorine_pump_kw": 1, "chlorine_flow_kld": 1},
        ):
            regs[reg["hardware_id"]] = reg

    # Owner-level DO dedup — every DO card for the same client renders the
    # same merged tank data, so keep only ONE representative per owner.
    # Runs AFTER the registry-placeholder pass so newly-registered devices
    # (which appear as empty placeholders here) also get collapsed into
    # the unified card. Chooses the lowest `aeration_tank_number` as the
    # canonical entry.
    # Attach a `_do_siblings` list to every DO card so the inline admin
    # dropdown (Link DO device → Tank) can list all sibling DO devices
    # owned by the same client and show the current assignment. We do NOT
    # dedupe / merge — each device is rendered as its OWN card showing
    # only its own tank.
    if do_items:
        by_owner: Dict[str, List[dict]] = {}
        for r in do_items:
            hw = r.get("hardware_id")
            owner = (regs.get(hw) or {}).get("owner_user_id") or hw
            by_owner.setdefault(owner, []).append(r)
        for owner, items in by_owner.items():
            siblings = []
            for it in items:
                hw = it.get("hardware_id")
                reg = regs.get(hw) or {}
                siblings.append({
                    "hardware_id": hw,
                    "label": reg.get("label") or hw,
                    "aeration_tank_number": reg.get("aeration_tank_number"),
                })
            for it in items:
                it["_do_siblings"] = siblings

    # Enrich each registry entry with the owner's friendly name / email so
    # the admin badge on the WQ page reads "Client: Shalimar Lake City"
    # instead of "Client: user_2ba8d15c08ae".
    owner_ids = list({reg.get("owner_user_id") for reg in regs.values() if reg.get("owner_user_id")})
    if owner_ids:
        users_map: Dict[str, dict] = {}
        async for u in db.users.find(
            {"id": {"$in": owner_ids}},
            {"_id": 0, "id": 1, "email": 1, "company_name": 1, "full_name": 1, "location_name": 1, "username": 1},
        ):
            users_map[u["id"]] = u
        for reg in regs.values():
            owner = users_map.get(reg.get("owner_user_id"))
            if owner:
                reg["owner_name"] = owner.get("company_name") or owner.get("full_name") or owner.get("username") or owner.get("email")
                reg["owner_email"] = owner.get("email")
                # Fall back to the owner's location if the device didn't have one.
                if not reg.get("location_name") and owner.get("location_name"):
                    reg["location_name"] = owner["location_name"]

    # Derive turbidity for STP items now that we know each device's coefficient.
    for it in stp_items:
        reg = regs.get(it.get("hardware_id")) or {}
        _derive_turbidity(it["values"], reg.get("turbidity_k"))

    # Compute chlorine alerts + automated dose recommendations for STP +
    # chlorine_analyzer devices. Recommendation falls back to
    # `plant_capacity_kld` when the admin hasn't set a dedicated
    # `chlorine_flow_kld`, so a single admin field (plant capacity) is
    # enough to get a useful number on day one.
    for it in stp_items + chlorine_items:
        reg = regs.get(it.get("hardware_id")) or {}
        cmin = reg.get("chlorine_min") if isinstance(reg.get("chlorine_min"), (int, float)) else CHLORINE_MIN_DEFAULT
        cmax = reg.get("chlorine_max") if isinstance(reg.get("chlorine_max"), (int, float)) else CHLORINE_MAX_DEFAULT
        it["chlorine_alert"] = _chlorine_status(it["values"].get("CHLORINE"), cmin, cmax)
        target = reg.get("chlorine_dose_target_mg_l")
        # If no explicit target, aim for the midpoint of the safe band.
        if not isinstance(target, (int, float)):
            target = round((cmin + cmax) / 2.0, 2)
        flow_kld = reg.get("chlorine_flow_kld")
        if not isinstance(flow_kld, (int, float)) or flow_kld <= 0:
            flow_kld = reg.get("plant_capacity_kld")
        rec = _dose_recommendation(
            current_cl=it["values"].get("CHLORINE"),
            target_cl=target,
            flow_kld=flow_kld,
            solution_pct=reg.get("chlorine_solution_pct"),
            pump_kw=reg.get("chlorine_pump_kw"),
        )
        if rec is not None:
            it["chlorine_alert"]["recommendation"] = rec

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

    for r in stp_items + do_items + chlorine_items:
        r["_registry"] = regs.get(r.get("hardware_id"), {})

    return {
        "unit": unit,
        "stp_params_meta": STP_PARAMS,
        "do_params_meta": DO_PARAMS,
        "chlorine_params_meta": CHLORINE_PARAMS,
        "stp": stp_items,
        "do": do_items,
        "chlorine": chlorine_items,
    }


@router.get("/history/{hardware_id}")
async def history(
    hardware_id: str,
    range: str = Query("daily", regex="^(daily|weekly|monthly|quarterly|yearly|raw)$"),
    unit: str = Query("mg/L"),
    limit: int = Query(500, ge=1, le=10000),
    user: dict = Depends(get_current_user),
):
    """Aggregated series for a single device.

    * raw       → last 7 days, every reading (no bucketing, capped by `limit`)
    * daily     → last 24 hours, one point per hour
    * weekly    → last 7 days, one point per day
    * monthly   → last 30 days, one point per day
    * quarterly → last 13 weeks, one point per ISO week
    * yearly    → last 12 months, one point per calendar month
    """
    _require_wq_view(user)
    visible = await _visible(user)
    if visible is not None and hardware_id not in visible:
        raise HTTPException(status_code=403, detail="Not authorised to view this device")

    now = datetime.now(timezone.utc)
    if range == "raw":
        since = now - timedelta(days=7)
        bucket_fmt = None
    elif range == "daily":
        since = now - timedelta(hours=24)
        bucket_fmt = "%Y-%m-%dT%H"          # hourly buckets
    elif range == "weekly":
        since = now - timedelta(days=7)
        bucket_fmt = "%Y-%m-%d"             # daily
    elif range == "monthly":
        since = now - timedelta(days=30)
        bucket_fmt = "%Y-%m-%d"
    elif range == "quarterly":
        since = now - timedelta(weeks=13)
        bucket_fmt = "%G-W%V"               # ISO year-week
    else:  # yearly
        since = now - timedelta(days=365)
        bucket_fmt = "%Y-%m"                # calendar month

    cursor = db.instrument_readings.find(
        {"hardware_id": hardware_id, "received_at": {"$gte": since.isoformat()},
         "_dummy": {"$ne": True}},
        {"_id": 0, "values": 1, "received_at": 1, "instrument_type": 1},
    )

    # Determine parameter keys based on the first row (or the registry type).
    reg = await db.instrument_registry.find_one(
        {"hardware_id": hardware_id}, {"_id": 0, "instrument_type": 1, "label": 1}
    )
    itype = (reg or {}).get("instrument_type", "wq_stp")
    if itype == "wq_stp":
        param_keys = list(STP_PARAMS.keys())
    elif itype == "do_meter":
        param_keys = list(DO_PARAMS.keys())
    else:
        param_keys = list(CHLORINE_PARAMS.keys())

    # ---- raw path: return every reading, timestamped, newest first ----
    if range == "raw":
        rows: List[dict] = []
        async for row in cursor.sort("received_at", -1).limit(limit):
            entry = {"received_at": row.get("received_at")}
            vals = row.get("values") or {}
            for p in param_keys:
                v = vals.get(p)
                if v is not None:
                    try:
                        v = round(_convert(float(v), "mg/L", unit), 3)
                    except (TypeError, ValueError):
                        pass
                entry[p] = v
            rows.append(entry)
        return {
            "hardware_id": hardware_id,
            "instrument_type": itype,
            "label": (reg or {}).get("label"),
            "range": range,
            "unit": unit,
            "since": since.isoformat(),
            "params": param_keys,
            "rows": rows,
        }

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
    if itype == "wq_stp":
        param_keys = list(STP_PARAMS.keys())
    elif itype == "do_meter":
        param_keys = list(DO_PARAMS.keys())
    else:
        param_keys = list(CHLORINE_PARAMS.keys())

    # Narrow the DO param list when the caller asked for a specific tank.
    tank_choice = (req.tank or "both").lower() if itype == "do_meter" else "both"
    if itype == "do_meter" and tank_choice in ("1", "2"):
        param_keys = [f"DO_TANK_{tank_choice}"]

    cursor = db.instrument_readings.find(
        {"hardware_id": req.hardware_id,
         "received_at": {"$gte": from_dt.isoformat(), "$lte": to_dt.isoformat()},
         "_dummy": {"$ne": True}},
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
    pdf_tank_suffix = f"_tank{tank_choice}" if (itype == "do_meter" and tank_choice in ("1", "2")) else ""
    fname = f"wq_report_{req.hardware_id}{pdf_tank_suffix}_{from_dt.strftime('%Y%m%d')}_{to_dt.strftime('%Y%m%d')}.pdf"
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

