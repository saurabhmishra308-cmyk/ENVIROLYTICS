# Envirolytics — Product Requirements Document

## Original Problem Statement
MERN/FastAPI IoT sustainability-monitoring platform (Groundwater, STP, DO, Chlorine, Flowmeters). Real-time telemetry (direct MQTT + QESPL HTTP), admin device provisioning, strict client view-permissions, historical tables, Azure VM migration + deploy kit, m³/h flowmeter normalization, DO/Chlorine out-of-range Zoho SMTP alerts, object-storage persistence, admin god-mode, IT-staff role, OTP password recovery.

## What's Implemented

### 2026-02 (this session)
- Data export toolkit: `/app/exports/dump.sh` + `RESTORE_ON_AZURE.md` + bundled `emergent_mongo_export.tar.gz` (mongodump of all 22 collections + `/app/backend/uploads/` files) for one-shot Azure VM migration.
- **Fixed downloaded CSV/PDF files served as HTML on Azure VM** — root cause: raw `fetch(\`${process.env.REACT_APP_BACKEND_URL}/api/...\`)` compiled to `undefined/api/...` when `.env` was missing during `yarn build` on the VM. nginx SPA fallback then returned `index.html`.
  - Added `apiUrl(path)` helper in `frontend/src/lib/api.js` with same-origin fallback
  - Patched Reports.jsx (template + PDF export), Certificates.jsx (cert download), ReportsCharts.jsx (borewell CSV)
  - Hardened GitHub Actions workflow: auto-creates `/opt/envirolytics/frontend/.env` on the VM before `yarn build` if missing

### Prior sessions (feature-complete)
- Login by email/username only (legacy `user_id` disabled)
- Admin god-mode: cannot deactivate/edit/delete admin from UI
- Admin OTP + hidden-token recovery via `saurabh@envirolytics.in`
- Client OTP recovery + admin email notification on client password change
- IT Staff role (`require_operator`): full CRUD on clients/devices; admin & other staff invisible
- DO analyzer temperature + saturation sourced from QESPL
- Object Storage (`object_storage.py`) w/ safe local-disk fallback for Azure
- DO historical table hides irrelevant aeration tank column
- DO + Chlorine out-of-range Zoho SMTP alerts (`notification_service.py`)
- Azure VM Deploy Kit (`/app/deploy/azure-vm/*` + `.github/workflows/deploy-azure-vm.yml`)
- Unified flowmeter ingest → all sources normalized to `m3/h`
- Systemd config forces `uvicorn` single-worker to prevent duplicate background loops

## Prioritized Backlog

### P0 — Next
- **Stale Vendor Data UX Indicator** — Warning badge on WQ cards when QESPL feed older than 24 h (files: `WaterQuality.jsx`, `EnhancedDashboard.jsx`)

### P1
- **Global Ops Recipients UI** — Admin panel to manage DO/Chlorine alert recipient emails (backend + frontend)
- **Multi-unit hierarchy** — Format client names as "Company — Unit Name, State"; add `parent_company_id`, `unit_name`, `unit_state` to users schema

### P2
- **Print/PDF Export tuning** for Government Inspection (Customer Profile & Certificates pages, single-page audit prints)

### P3
- **Client Session Watermark Overlay** — Diagonal low-opacity email+timestamp repeat across every client screen

## Test Credentials
See `/app/memory/test_credentials.md`.

## Architecture Notes
- Same code runs on Emergent + Azure VM. Only differences: `.env` values, process manager (supervisor vs systemd), object-storage backend, ingress (K8s vs nginx).
- `object_storage.py` transparently falls back to `/app/backend/uploads/` when `EMERGENT_LLM_KEY` is absent.
- All flowmeter values normalized to `flow_rate_m3h` before DB insert (see `mqtt_utils.py`).
- Frontend `apiUrl()` helper guarantees no `undefined/...` URLs even when `REACT_APP_BACKEND_URL` is missing at build time (same-origin fallback works with nginx `/api/*` proxy).
