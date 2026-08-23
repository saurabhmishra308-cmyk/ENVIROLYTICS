"""Retention auto-purge — DISABLED (lifetime retention policy).

All instrument readings are kept for lifetime so clients can query any
historical range. This module is preserved as a no-op purely so
`server.py`'s background-task startup import stays intact — the tick
scans for devices where `data_retention_days > 0` and finds none because
the `/instrument-registry/{hw}/data-frequency` endpoint hard-writes
`data_retention_days = None`.

If a future product decision reverses this policy, restore the original
purge logic from git history.
"""
from __future__ import annotations

import asyncio
import logging
import os

logger = logging.getLogger(__name__)

# One tick per day by default.
TICK_SECONDS = int(os.getenv("RETENTION_TICK_SECONDS", str(24 * 60 * 60)))
MIN_TICK_SECONDS = 300


async def retention_purge_loop(db) -> None:  # noqa: ARG001 — signature kept for compat
    """No-op loop. Sleeps forever without touching any readings."""
    interval = max(MIN_TICK_SECONDS, TICK_SECONDS)
    logger.info("[retention] lifetime retention active — purge loop is a no-op (tick=%ss)", interval)
    while True:
        await asyncio.sleep(interval)
