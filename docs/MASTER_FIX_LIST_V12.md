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

## Fresh V14 restoration cycle — IN PROGRESS

The Version 14 screenshots/regression evidence showed that previously implemented
behaviour cannot be assumed to survive into the current build. Therefore the
Master Fix items #1–#29 are being re-performed against the current codebase.

Priority restoration already applied on this branch:
- QESPL/DO now persists the vendor/device measurement timestamp separately from received_at.
- QESPL/DO history is idempotent on hardware_id + measurement_timestamp.
- QESPL/DO latest cache cannot move backward when an older HTTP response arrives late.
- DO API restores legacy DO_TANK_N values when older latest documents do not contain the generic DO field.
- MQTT DWLR/WQ readings explicitly preserve measurement_timestamp.
- Instrument registry separates last_seen/last_timestamp from transport received_at.
- Water Quality reports use measurement time for their date-range query.

These changes are NOT considered final PASS until the complete #1–#29 verification
and V14/v1.0.3 visual restoration are tested and committed to the production branch.

## V14 / v1.0.3 restoration — PENDING

9. **Version 14 / v1.0.3 UI restoration — NOT YET PASS**
   - Restore the original **Flowmeter animation** asset: `flowmeter-animation.png`.
   - Restore the original **DWLR animation** asset: `dwlr-animation.png`.
   - Restore the associated animation/display behaviour.
   - Restore the **Flow vs Water Level** graph/report UI.
   - Restore the **Water Level vs Rainfall** graph/report UI.
   - Keep these changes strictly in the visual/UI layer.
   - Do **not** change Flowmeter calculations, DWLR calculations, telemetry, MongoDB processing, or existing APIs while restoring the visual layer.
   - The original PNG assets are currently absent from `main`; this item must remain **PENDING** until the actual V14 assets/code are restored and verified.

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

**V14/v1.0.3 rule:** do not mark item 9 PASS until the actual original assets/code are restored, tested, and committed to GitHub. If the assets are unavailable, keep the item explicitly PENDING rather than substituting recreated assets without confirmation.