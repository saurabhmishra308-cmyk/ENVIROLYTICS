"""Live HTTP traffic panel + Poll-now endpoint for ESPL/QESPL polling."""
import io
import csv
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from auth import require_admin
import espl_poller

router = APIRouter(prefix="/api/http-traffic", tags=["http-traffic"])


@router.get("/espl")
async def get_espl_traffic(limit: int = 50, admin: dict = Depends(require_admin)):
    return espl_poller.get_traffic(limit=limit)


@router.post("/espl/poll-now")
async def espl_poll_now(admin: dict = Depends(require_admin)):
    return await espl_poller.poll_all_now()


@router.get("/espl/export.csv")
async def export_espl_traffic_csv(admin: dict = Depends(require_admin)):
    """Download the current 50-row buffer as CSV."""
    payload = espl_poller.get_traffic(limit=50)
    rows = payload.get("recent", [])
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["time", "device_id", "hardware_id", "instrument_type", "http_status", "result", "bytes", "duration_ms", "error"])
    for r in rows:
        writer.writerow([
            r.get("ts", ""), r.get("device_id", ""), r.get("hardware_id", ""),
            r.get("instrument_type", ""), r.get("http_status", ""), r.get("result", ""),
            r.get("bytes", 0), r.get("duration_ms", 0), r.get("error", "") or "",
        ])
    buf.seek(0)
    fname = f"espl_traffic_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        io.BytesIO(buf.getvalue().encode("utf-8")),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={fname}"},
    )
