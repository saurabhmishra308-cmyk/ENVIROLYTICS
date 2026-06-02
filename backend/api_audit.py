"""Audit log endpoints — surfaces edited_by/edited_at fields already stored on each reading."""
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, Query, HTTPException
from auth import require_admin

router = APIRouter(prefix="/api/admin/audit-log", tags=["audit-log"])

# Set from server.py
db = None


def set_db(database):
    global db
    db = database


async def _resolve_users(user_ids: set):
    """Map user_id -> {email, full_name}."""
    if not user_ids:
        return {}
    cursor = db.users.find(
        {"id": {"$in": list(user_ids)}},
        {"_id": 0, "id": 1, "email": 1, "full_name": 1},
    )
    users = await cursor.to_list(length=500)
    return {u["id"]: u for u in users}


@router.get("/reading-edits")
async def list_reading_edits(
    instrument_type: Optional[str] = Query(None, description="flowmeter | dwlr | ph | tds | conductivity"),
    hardware_id: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None, description="ISO datetime — only edits at-or-after"),
    end_date: Optional[str] = Query(None, description="ISO datetime — only edits at-or-before"),
    limit: int = Query(100, ge=1, le=500),
    admin: dict = Depends(require_admin),
):
    """List every reading edit/delete tracked by `edited_by` + `edited_at`."""
    edit_filter = {"edited_by": {"$exists": True, "$ne": None}}
    if hardware_id:
        edit_filter["hardware_id"] = hardware_id
    if start_date or end_date:
        edit_filter["edited_at"] = {}
        if start_date:
            edit_filter["edited_at"]["$gte"] = start_date
        if end_date:
            edit_filter["edited_at"]["$lte"] = end_date

    sources = []
    if not instrument_type or instrument_type == "flowmeter":
        sources.append(("flowmeter", db.flowmeter_readings))
    if instrument_type and instrument_type in {"dwlr", "ph", "tds", "conductivity"}:
        ifilter = dict(edit_filter)
        ifilter["instrument_type"] = instrument_type
        sources.append((instrument_type, db.instrument_readings, ifilter))
    elif not instrument_type:
        sources.append(("instrument", db.instrument_readings))

    edits = []
    for entry in sources:
        if len(entry) == 3:
            label, coll, custom_filter = entry
            f = custom_filter
        else:
            label, coll = entry
            f = edit_filter
        cursor = coll.find(f).sort("edited_at", -1).limit(limit)
        docs = await cursor.to_list(length=limit)
        for d in docs:
            edits.append({
                "reading_id": str(d.get("_id")),
                "source": label if label != "instrument" else d.get("instrument_type", "instrument"),
                "hardware_id": d.get("hardware_id"),
                "timestamp": d.get("timestamp"),
                "edited_at": d.get("edited_at"),
                "edited_by": d.get("edited_by"),
                "values_snapshot": {
                    "flow_rate_lph": d.get("flow_rate_lph"),
                    "forward_totalizer": d.get("forward_totalizer"),
                    "reverse_totalizer": d.get("reverse_totalizer"),
                    "temperature": d.get("temperature"),
                    "values": d.get("values"),
                },
            })

    edits.sort(key=lambda x: x.get("edited_at") or "", reverse=True)
    edits = edits[:limit]

    # Attach editor info
    editor_ids = {e["edited_by"] for e in edits if e.get("edited_by")}
    user_map = await _resolve_users(editor_ids)
    for e in edits:
        info = user_map.get(e.get("edited_by"))
        e["editor"] = info or {"id": e.get("edited_by"), "email": e.get("edited_by"), "full_name": "(unknown)"}

    return {"edits": edits, "count": len(edits)}


@router.get("/summary")
async def audit_summary(admin: dict = Depends(require_admin)):
    """Quick counts: how many edits per instrument type and per editor."""
    flow_count = await db.flowmeter_readings.count_documents({"edited_by": {"$exists": True, "$ne": None}})
    instr_count = await db.instrument_readings.count_documents({"edited_by": {"$exists": True, "$ne": None}})

    # Top editors
    pipeline = [
        {"$match": {"edited_by": {"$exists": True, "$ne": None}}},
        {"$group": {"_id": "$edited_by", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 10},
    ]
    fl_editors = await db.flowmeter_readings.aggregate(pipeline).to_list(length=10)
    in_editors = await db.instrument_readings.aggregate(pipeline).to_list(length=10)

    by_editor = {}
    for e in fl_editors + in_editors:
        eid = e["_id"]
        by_editor[eid] = by_editor.get(eid, 0) + e["count"]
    sorted_editors = sorted(by_editor.items(), key=lambda x: x[1], reverse=True)[:10]
    editor_ids = {eid for eid, _ in sorted_editors}
    user_map = await _resolve_users(editor_ids)

    return {
        "total_edits": flow_count + instr_count,
        "by_instrument": {
            "flowmeter": flow_count,
            "instrument_readings": instr_count,
        },
        "top_editors": [
            {
                "user_id": eid,
                "count": cnt,
                "email": user_map.get(eid, {}).get("email", eid),
                "full_name": user_map.get(eid, {}).get("full_name", "(unknown)"),
            }
            for eid, cnt in sorted_editors
        ],
    }
