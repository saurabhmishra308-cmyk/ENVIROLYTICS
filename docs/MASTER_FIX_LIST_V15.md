# ENVIROLYTICS — Master Fix List V15

## Purpose

V15 is the next controlled master-fix and production-audit baseline after the successful Azure deployment pipeline repair.

V15 starts from the current `main` branch and does **not** assume that a feature is correct merely because the application builds or the deployment is green. Each V15 item must be traced from implementation through regression testing and, where applicable, live production verification.

## Current baseline

- Repository: `saurabhmishra308-cmyk/ENVIROLYTICS`
- Production VM: Azure VM at the verified production deployment path
- Repository path on VM: `/home/envirolytics/ENVIROLYTICS`
- Backend: FastAPI / Uvicorn on `127.0.0.1:8000`
- Frontend publication path: `/var/www/envirolytics`
- Production domain: `monitor.envirolytics.in`
- MongoDB connectivity: verified through `/api/health`
- Latest deployment pipeline verification: GitHub Actions completed successfully with frontend publication, backend restart, Nginx validation/reload, and `/api/health` returning healthy.
- Deployment workflow hardening commit: `4e4a3264c37ae9652c1f388a26e44e7c1a5eaad8`
- Frontend publication permission fix: `b8f77d25464897c5a97388e69d6b43c37df77fe9`

## Status discipline

Use only these states:

**PENDING → INVESTIGATING → FIXED → TESTED → DEPLOYED → VERIFIED**

A V15 item is not considered complete until the evidence required for that item is recorded.

### Evidence rules

1. Do not change code without first identifying the affected behaviour and expected result.
2. Do not mark a code fix TESTED without a reproducible regression test.
3. Do not mark a production item DEPLOYED solely because GitHub Actions is green.
4. Do not mark a production item VERIFIED without checking the relevant live API/UI behaviour.
5. Preserve existing authentication, ownership filtering, instrument mapping, telemetry processing, units, timestamps, and historical data unless the specific fix explicitly requires a change.
6. Do not replace missing original assets with recreated assets and call them original.
7. Keep unrelated fixes out of the same commit where practical.

---

# V15 MASTER AUDIT

## 1. Production baseline and deployment

**Status: VERIFIED**

- [x] GitHub Actions sanity check passes.
- [x] Backend import smoke test passes.
- [x] Master regression tests pass.
- [x] Frontend production build succeeds.
- [x] SSH deployment reaches the Azure VM.
- [x] Frontend build publishes to `/var/www/envirolytics`.
- [x] Backend systemd unit can be updated without an interactive sudo password.
- [x] FastAPI service restarts successfully.
- [x] Nginx configuration validates successfully.
- [x] Nginx reload succeeds.
- [x] `/api/health` reports healthy with database reachable.

**Note:** Deployment infrastructure is now a verified baseline. V15 application fixes must not unnecessarily modify the deployment mechanism.

---

## 2. Flowmeter

**Status: INVESTIGATING**

**Current V15 evidence:** measurement-time ordering, duplicate ingestion protection, delayed-packet latest-cache protection, totaliser-chain reconstruction, measurement-time date filtering, export filtering, edit-cache reconciliation, canonical-unit persistence, ownership protection, edit-time duplicate-timestamp rejection, late-measurement history retention, and unrestricted all-latest fleet coverage are implemented and covered by regression guards. CI run #87 completed successfully with deployment. Live production verification of representative flowmeters remains outstanding.

Audit and verify:

- [ ] Live flow value is correct and uses the configured canonical unit.
- [ ] Source/raw flow value and unit remain traceable.
- [ ] Chronological history uses device measurement time.
- [ ] Duplicate measurement timestamps do not create duplicate history rows.
- [ ] Delayed/out-of-order packets cannot replace a newer latest reading.
- [ ] Initial totaliser follows the previous chronological final totaliser.
- [ ] Final totaliser is persisted correctly.
- [ ] Consumption equals the valid chronological totaliser delta.
- [ ] Totaliser reset/rollover does not create negative consumption.
- [ ] Historical consumption remains consistent after page refresh.
- [ ] Reports/graphs use the same chronological data as the history view.
- [ ] Flowmeter behaviour is consistent across all registered clients/devices.

---

## 3. DWLR / Water Level

**Status: INVESTIGATING**

**Current V15 evidence:** MQTT DWLR readings preserve device measurement time separately from receipt time, latest cache is monotonic by measurement time, history ordering is measurement-time-first, device-specific access is ownership-protected, generic latest endpoints no longer have arbitrary 200/500-device caps, direct/admin generic ingest stamps measurement time, and the daily DWLR aggregation now applies both lower and upper bounds to authoritative measurement time without an arbitrary 20,000-row truncation. Live production verification of representative DWLR devices remains outstanding.

Audit and verify:

- [ ] Live water level displays the latest device measurement.
- [ ] Measurement timestamp is distinct from transport receipt time.
- [ ] Last Seen/freshness uses measurement time.
- [ ] Delayed packets cannot move latest data backward.
- [ ] Duplicate measurements are suppressed.
- [ ] Historical water-level ordering is chronological.
- [ ] Water-level graphs use the correct timestamps.
- [ ] Water Level vs Rainfall graph/report is present if it is part of the currently supported V14 UI.
- [ ] Water temperature handling is correct for device-supplied and configured manual values.
- [ ] Unit labels and conversions remain correct.

---

## 4. Water Quality / OCEMS / DO

**Status: INVESTIGATING**

**Current V15 evidence:** QESPL/ESPL preserves device measurement time separately from receipt time, deduplicates by hardware ID + measurement timestamp, keeps latest cache monotonic, preserves raw DO and tank mapping, recovers legacy DO_TANK values, polls at the configured five-minute cadence, uses measurement-time history/report filters, and enforces user/device visibility. ESPL fleet polling now has no arbitrary 500-device cap, and malformed vendor timestamps fall back safely to receipt time while preserving the raw payload. Live production verification of representative DO/WQ devices remains outstanding.

Audit and verify:

- [ ] DO Analyzer live data appears in the correct UI card/tank.
- [ ] Generic DO and tank-specific DO mapping remain consistent with registry assignment.
- [ ] Legacy `DO_TANK_N` data remains readable.
- [ ] DO measurement timestamp is authoritative for history/freshness.
- [ ] Duplicate DO measurements are suppressed.
- [ ] Delayed QESPL/HTTP responses cannot overwrite newer latest data.
- [ ] pH/TSS/COD/BOD/TDS/ORP/conductivity and other supported parameters remain correctly mapped.
- [ ] Turbidity fallback behaviour remains intentional and traceable where applicable.
- [ ] Water Quality history uses measurement time.
- [ ] Water Quality reports use measurement time.
- [ ] SCADA timestamp display uses measurement time.
- [ ] Live HTTP Traffic — ESPL remains consistent with persisted data.
- [ ] Five-minute QESPL polling remains intact.

---

## 5. MQTT telemetry

**Status: INVESTIGATING**

**Current V15 evidence:** MQTT reconnect backoff is bounded, reconnects use `connect_async`, the universal device wildcard is restored on broker reconnect, flowmeter and generic instrument ingestion preserve measurement and receipt timestamps separately, duplicate history is suppressed by hardware ID + measurement timestamp, latest caches are monotonic by measurement time, late measurements are evaluated in device measurement order for down-sampling, totaliser chaining uses measurement time, all-latest flowmeter fleet retrieval has no arbitrary 100-device cap, and malformed flowmeter timestamps now fall back safely to receipt time. Live broker/device verification remains outstanding.

Audit and verify:

- [ ] MQTT measurement timestamp is preserved.
- [ ] Transport receipt time remains separately available.
- [ ] Duplicate MQTT readings are suppressed using hardware ID + measurement timestamp.
- [ ] History sampling is evaluated using measurement time.
- [ ] Latest cache is monotonic by measurement timestamp.
- [ ] Delayed/out-of-order MQTT packets are handled correctly.
- [ ] DWLR, WQ/STP and other supported MQTT instrument types retain their existing field mappings.
- [ ] MQTT reconnect/subscription behaviour does not lose registered devices.

---

## 6. Instrument Registry

**Status: INVESTIGATING**

**Current V15 evidence:** registry ownership and visibility are authoritative, hardware IDs and IMEIs are checked for duplicates, device types/source/tank assignments are validated, registry retention/history controls use measurement time, orphan-data cleanup is available, registry fleet endpoints no longer impose arbitrary 2,000-device caps, and device updates now keep flowmeter category and MQTT mapping consistent when type/source changes. Live production registry/device verification remains outstanding.

Audit and verify:

- [ ] Registered hardware IDs are the authoritative device set.
- [ ] Owner/client visibility remains enforced.
- [ ] Instrument type mapping is preserved.
- [ ] HTTP vs MQTT source assignment is preserved.
- [ ] IMEI/vendor device ID mapping is correct.
- [ ] DO aeration-tank assignment is preserved.
- [ ] Last measurement timestamp is distinct from receipt time.
- [ ] Last Seen status is based on the intended timestamp.
- [ ] Live/stale/silent status thresholds behave consistently.
- [ ] Registry changes do not orphan live telemetry.

---

## 7. Authentication, authorization and visibility

**Status: PENDING**

Audit and verify:

- [ ] Admin authentication works.
- [ ] Client authentication works.
- [ ] Protected API endpoints remain protected.
- [ ] Client ownership filtering remains enforced.
- [ ] Admin-only functions remain admin-only.
- [ ] Device visibility permissions remain enforced.
- [ ] No V15 change introduces a public-access bypass.
- [ ] Session/login behaviour remains compatible with Web and Mobile clients.

---

## 8. Web dashboard

**Status: PENDING**

Audit and verify:

- [ ] Dashboard loads after a fresh login.
- [ ] Live device cards display correct values.
- [ ] Online/stale/silent indicators are correct.
- [ ] Current values and history agree.
- [ ] Instrument filtering works.
- [ ] Client-specific dashboards remain isolated.
- [ ] Admin dashboard retains required controls.
- [ ] No JavaScript/API console errors block normal operation.

---

## 9. Reports and graphs

**Status: PENDING**

Audit and verify:

- [ ] Date-range filtering uses measurement timestamps.
- [ ] Graph points are chronologically ordered.
- [ ] No duplicate points are introduced by repeated telemetry.
- [ ] Empty-data handling is correct.
- [ ] Flowmeter history/consumption reports are consistent.
- [ ] DWLR historical reports are consistent.
- [ ] Water Quality reports are consistent.
- [ ] Flow vs Water Level UI is restored if supported by the intended V14 release.
- [ ] Water Level vs Rainfall UI is restored if supported by the intended V14 release.
- [ ] Exported report values match displayed data.

---

## 10. V14 / v1.0.3 visual restoration

**Status: PENDING**

This remains explicitly dependent on the availability of the actual original V14 assets/code.

- [ ] Restore the original `flowmeter-animation.png`.
- [ ] Restore the original `dwlr-animation.png`.
- [ ] Restore the original animation/display behaviour.
- [ ] Restore Flow vs Water Level graph/report UI.
- [ ] Restore Water Level vs Rainfall graph/report UI.
- [ ] Verify visual changes are UI-only.
- [ ] Verify no telemetry, calculation, MongoDB, or API behaviour changes are introduced by the visual restoration.
- [ ] Do not substitute recreated assets and label them as original.

**Current evidence:** the original animation PNG assets were previously found absent from `main`. Keep this item PENDING until actual source assets/code are available.

---

## 11. Mobile application

**Status: PENDING**

Audit and verify:

- [ ] Mobile login works.
- [ ] API authentication remains compatible.
- [ ] Dashboard values match Web values.
- [ ] Flowmeter values/history match Web.
- [ ] DWLR values/history match Web.
- [ ] Water Quality/DO values match Web.
- [ ] Timestamp display is consistent.
- [ ] Client ownership/visibility remains enforced.
- [ ] Production API URL is correct.
- [ ] No release build is accidentally pointed at a development endpoint.

---

## 12. Data integrity and historical consistency

**Status: PENDING**

Verify representative devices end-to-end:

**Device → ingestion → MongoDB → latest → history → Web → Mobile**

For each representative device verify:

- [ ] value
- [ ] unit
- [ ] measurement timestamp
- [ ] receipt timestamp
- [ ] hardware ID
- [ ] instrument type
- [ ] owner/client
- [ ] latest cache
- [ ] history
- [ ] duplicate protection
- [ ] freshness status
- [ ] report output

---

## 13. Performance and reliability

**Status: PENDING**

Audit:

- [ ] Backend startup time.
- [ ] API response time for latest-data endpoints.
- [ ] Historical query performance.
- [ ] MongoDB query/index behaviour.
- [ ] QESPL polling reliability.
- [ ] MQTT reconnect reliability.
- [ ] Memory/log growth.
- [ ] Frontend bundle warnings and practical loading impact.
- [ ] Long-running service stability.

Warnings must be separated from actual production failures.

---

## 14. Security and operational controls

**Status: PENDING**

Audit:

- [ ] No secrets committed to GitHub.
- [ ] Production `.env` remains outside repository synchronization.
- [ ] SSH deployment uses the dedicated deployment key.
- [ ] Deployment key is not exposed in logs.
- [ ] Sudo deployment permissions are limited to the required operational scope.
- [ ] Nginx/TLS configuration remains intact.
- [ ] Debug/demo data is not exposed to clients.
- [ ] Authentication/authorization regression tests remain active.

---

# V15 change-control procedure

For every discovered issue:

### Step 1 — Record
Document the exact symptom, affected device/client, endpoint/page, timestamp and expected behaviour.

### Step 2 — Investigate
Trace the data path before changing code.

### Step 3 — Fix
Make the smallest targeted change.

### Step 4 — Regression test
Add or update a test that would fail if the fix is removed.

### Step 5 — Commit
Use a descriptive Git commit message and keep unrelated changes separate.

### Step 6 — Deploy
Allow the verified GitHub Actions pipeline to deploy the change.

### Step 7 — Verify
Check the affected API/UI behaviour in production.

### Step 8 — Close
Only then change the item to **VERIFIED**.

---

# V15 acceptance gate

V15 is complete only when all required application fixes have reached:

**FIXED → TESTED → DEPLOYED → VERIFIED**

and the final production chain has been checked:

**Device → ingestion → database → latest → history → reports → Web → Mobile**

No item should be marked VERIFIED from code inspection alone when live behaviour is required.

## Relationship to previous master lists

- V12 remains the historical baseline for the timestamp, duplicate, chronological, totaliser, Water Quality and authentication fixes.
- V14 restoration work remains documented in `docs/MASTER_FIX_LIST_V12.md`.
- V15 is the next controlled audit/fix cycle and must not silently overwrite the historical record of V12/V14 decisions.
