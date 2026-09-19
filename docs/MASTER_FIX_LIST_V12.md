# ENVIROLYTICS — Master Fix List V12

## Purpose
Permanent production baseline for the fixes previously validated in the #21–#29 current-code audit.

## Implemented in V12

1. **Measurement timestamp authority**
   - Device measurement time is preserved separately from `received_at`.
   - Freshness / Last Seen uses measurement timestamp.
   - Transport receive time remains available for diagnostics.

2. **Chronological history**
   - Flowmeter history is sorted by device measurement timestamp.
   - Water Quality history/reports use measurement timestamp.
   - Delayed packets cannot overwrite a newer latest reading.

3. **Duplicate protection**
   - Historical rows are idempotent on `hardware_id + timestamp`.
   - Water Quality raw history suppresses duplicate measurement timestamps.

4. **Flowmeter totaliser chain**
   - Chronological previous final totaliser becomes the next reading's initial totaliser.
   - Initial/final/consumption fields are persisted for traceability.
   - Consumption is calculated from chronological totaliser deltas.
   - A decreasing totaliser is treated as a meter reset/rollover and does not create negative consumption.

5. **Flowmeter units**
   - Canonical storage/display remains m³/h.
   - Raw flow and source unit metadata remain available for audit.

6. **Current vs history**
   - Latest caches move forward only when the measurement timestamp is newer.
   - Historical data remains append-oriented and timestamp driven.

7. **Water Quality / DO**
   - DO tank mapping remains derived from the current registry assignment.
   - Water Quality history and reports use measurement time.
   - SCADA timestamp display uses measurement timestamp first.

8. **Authentication / visibility**
   - Existing authentication and ownership filtering are retained.
   - No public-access bypass was introduced.

## Final V12 acceptance gate

Validate end-to-end for Flowmeter, DWLR, WQ/STP, DO and QESPL:

**Device → ingestion → MongoDB → latest → history → Web UI → Mobile UI**

Acceptance requires:
- correct value
- correct measurement timestamp
- correct instrument mapping
- correct unit
- no duplicate historical row
- correct freshness / Last Seen
- correct online/stale/silent status
- correct authentication/ownership
- current and history consistency

## Git discipline

This file is part of the permanent V12 baseline. Do not mark a fix PASS for production unless the implementation and regression test are committed to GitHub.
