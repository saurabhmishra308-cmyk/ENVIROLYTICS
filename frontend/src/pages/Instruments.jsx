import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '../components/ui/dialog';
import {
  Cpu, Plus, Trash2, Edit3, Shield, RotateCcw, AlertTriangle, KeyRound, RefreshCw, Radio, Activity, CheckCircle2, XCircle, Dices, Hash, Clock, Eraser, Layers,
} from 'lucide-react';
import api, { formatApiError } from '../lib/api';
import { isAdmin } from '../mockData';
import { toast } from 'sonner';
import { cleanLabel } from '../utils/labels';
import BulkAddInstruments from '../components/BulkAddInstruments';

import { TYPE_OPTIONS, CATEGORY_OPTIONS, INSTRUMENT_CATEGORY_MAP, EMPTY_FORM } from '../components/instruments/instrumentOptions';
import { CreateInstrumentDialog } from '../components/instruments/CreateInstrumentDialog';
import { EditInstrumentDialog } from '../components/instruments/EditInstrumentDialog';
import { HttpsIngestionDialog } from '../components/instruments/HttpsIngestionDialog';
import { DummyModeDialog } from '../components/instruments/DummyModeDialog';
import { SimulateMessageDialog } from '../components/instruments/SimulateMessageDialog';
import { RenameHardwareIdDialog } from '../components/instruments/RenameHardwareIdDialog';
import { DataFrequencyDialog } from '../components/instruments/DataFrequencyDialog';
import { ClearHistoryDialog } from '../components/instruments/ClearHistoryDialog';

const Instruments = () => {
  const admin = isAdmin();
  const [items, setItems] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editTarget, setEditTarget] = useState(null);
  const [thresholdForm, setThresholdForm] = useState({
    turbidity_k: '',
    chlorine_min: '',
    chlorine_max: '',
    chlorine_dose_target_mg_l: '',
    chlorine_solution_pct: '',
    chlorine_pump_kw: '',
    chlorine_flow_kld: '',
  });
  const [savingThresholds, setSavingThresholds] = useState(false);
  const [keyTarget, setKeyTarget] = useState(null); // {hardware_id, label, device_key, instrument_type}
  // Rename hardware_id dialog (admin only)
  const [renameTarget, setRenameTarget] = useState(null); // { device, new_id }
  const [renaming, setRenaming] = useState(false);
  // Clear-history dialog
  const [clearTarget, setClearTarget] = useState(null); // { device, from, to }
  const [clearing, setClearing] = useState(false);
  // Data-frequency dialog
  const [freqTarget, setFreqTarget] = useState(null);   // { device, minutes, retention_days }
  const [savingFreq, setSavingFreq] = useState(false);
  // Bulk selection on the All Registered Instruments table
  const [selected, setSelected] = useState(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // MQTT simulate dialog (admin-only end-to-end verification)
  const [simOpen, setSimOpen] = useState(false);
  const [simSubmitting, setSimSubmitting] = useState(false);
  const [simResult, setSimResult] = useState(null);
  const [simForm, setSimForm] = useState({ topic: '', payload: '' });

  // Live MQTT traffic panel state
  const [trafficOpen, setTrafficOpen] = useState(true);
  const [traffic, setTraffic] = useState(null);

  // Live HTTP traffic (ESPL) panel state
  const [esplOpen, setEsplOpen] = useState(true);
  const [espl, setEspl] = useState(null);
  const [esplPolling, setEsplPolling] = useState(false);
  // Auto-suggest registration — probe an unknown deviceId
  const [probeDeviceId, setProbeDeviceId] = useState('');
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState(null); // {ok, values, inferred_instrument_type, already_registered, ...}

  // Dummy mode dialog (per-instrument)
  const [dummyOpen, setDummyOpen] = useState(false);
  const [dummyTarget, setDummyTarget] = useState(null);
  const [dummyTab, setDummyTab] = useState('live'); // 'live' | 'backfill'
  const [dummyForm, setDummyForm] = useState({
    enabled: false, min_value: '', max_value: '', interval_seconds: 900,
  });
  const [backfillForm, setBackfillForm] = useState({
    from_date: '', to_date: '', interval_seconds: 3600, min_value: '', max_value: '',
  });
  const [dummySubmitting, setDummySubmitting] = useState(false);
  const [backfillResult, setBackfillResult] = useState(null);

  const copyToClipboard = async (text, label = 'Copied') => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(label);
    } catch (e) {
      toast.error('Clipboard not available — please copy manually');
    }
  };

  const rotateKey = async (hw) => {
    if (!window.confirm(`Rotate device key for ${hw}? The old key will stop working immediately.`)) return;
    try {
      const { data } = await api.post(`/api/instrument-registry/${hw}/rotate-key`);
      toast.success('New device key generated');
      setKeyTarget((prev) => prev ? { ...prev, device_key: data.device_key } : prev);
      refresh();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Failed to rotate key');
    }
  };

  const backendUrl = (process.env.REACT_APP_BACKEND_URL || '').replace(/\/$/, '');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: regData }, { data: userData }] = await Promise.all([
        api.get('/api/instrument-registry'),
        admin ? api.get('/api/admin/users/list') : Promise.resolve({ data: { users: [] } }),
      ]);
      setItems(regData.instruments || []);
      setUsers(userData.users || []);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  }, [admin]);

  useEffect(() => { refresh(); }, [refresh]);

  // Poll the live MQTT traffic every 5s while the panel is open — cheap
  // read-only endpoint that returns an in-memory buffer.
  useEffect(() => {
    if (!admin || !trafficOpen) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await api.get('/api/flowmeter/traffic?limit=50');
        if (!cancelled) setTraffic(data);
      } catch (e) {
        if (!cancelled) setTraffic({ error: formatApiError(e?.response?.data?.detail) });
      }
    };
    load();
    const id = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [admin, trafficOpen]);

  // Poll the ESPL HTTP traffic buffer every 5s while the panel is open.
  useEffect(() => {
    if (!admin || !esplOpen) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await api.get('/api/http-traffic/espl?limit=50');
        if (!cancelled) setEspl(data);
      } catch (e) {
        if (!cancelled) setEspl({ error: formatApiError(e?.response?.data?.detail) });
      }
    };
    load();
    const id = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [admin, esplOpen]);

  const esplPollNow = async () => {
    setEsplPolling(true);
    try {
      const { data } = await api.post('/api/http-traffic/espl/poll-now');
      toast.success(`Polled ${data.polled} device${data.polled === 1 ? '' : 's'} · ${data.ok} ok · ${data.failed} failed`);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Poll failed');
    } finally {
      setEsplPolling(false);
    }
  };

  const esplExportCsv = () => {
    // Same pattern the MQTT card uses — trigger a download via a hidden anchor.
    const token = localStorage.getItem('envirolytics_token') || '';
    const url = `${backendUrl}/api/http-traffic/espl/export.csv`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const link = document.createElement('a');
        link.href = window.URL.createObjectURL(blob);
        link.download = `espl_traffic_${Date.now()}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
      })
      .catch(() => toast.error('CSV export failed'));
  };

  const adoptUnknownImei = (imei) => {
    // Prefill the create-instrument form with the IMEI so admin just needs
    // to fill in hardware_id + owner + type + click Register.
    setForm({ ...EMPTY_FORM, imei });
    setCreateOpen(true);
  };

  // ---------- Auto-Suggest: probe an unknown deviceId against QESPL ----------
  const runProbe = async () => {
    const did = probeDeviceId.trim();
    if (!did) { toast.error('Enter a deviceId to probe (e.g. DTU10020426)'); return; }
    setProbing(true);
    setProbeResult(null);
    try {
      const { data } = await api.post('/api/http-traffic/espl/probe', { device_id: did });
      setProbeResult(data);
      if (data.already_registered) {
        toast.info(`${did} is already registered as "${data.already_registered.label || data.already_registered.hardware_id}"`);
      } else if (data.ok) {
        toast.success(`Live data found for ${did} — click Register to add it`);
      } else {
        toast.warning(`Probe result: ${data.result}`);
      }
      // Refresh the traffic panel so the probe row shows up
      try {
        const { data: t } = await api.get('/api/http-traffic/espl?limit=50');
        setEspl(t);
      } catch (_) { /* ignore */ }
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Probe failed');
    } finally {
      setProbing(false);
    }
  };

  // Pre-fill the Add-Instrument dialog with everything the probe already knows:
  // deviceId → IMEI, inferred type → instrument_type, HTTP source, sensible label.
  const registerProbeResult = () => {
    if (!probeResult?.device_id) return;
    setForm({
      ...EMPTY_FORM,
      imei: probeResult.device_id,
      instrument_type: probeResult.inferred_instrument_type || 'do_meter',
      source: 'http',
      hardware_id: probeResult.device_id,   // sensible default; admin can rename
      label: (probeResult.inferred_instrument_type === 'do_meter' ? 'DO Analyzer' :
              probeResult.inferred_instrument_type === 'wq_stp' ? 'OCEMS / Water Quality Analyzer' :
              probeResult.inferred_instrument_type === 'chlorine_analyzer' ? 'Chlorine Analyzer' :
              'Instrument') + ` (${probeResult.device_id})`,
    });
    setProbeResult(null);
    setProbeDeviceId('');
    setCreateOpen(true);
  };

  // ---------- Dummy Mode helpers ----------
  const openDummyDialog = async (it) => {
    setDummyTarget(it);
    setDummyTab('live');
    setBackfillResult(null);
    // Reasonable defaults based on the instrument type
    const defaults = it.instrument_type === 'flowmeter'
      ? { min_value: 100, max_value: 500 }        // L/H
      : { min_value: 5, max_value: 200 };          // mWC for DWLR
    setDummyForm({
      enabled: false,
      min_value: String(defaults.min_value),
      max_value: String(defaults.max_value),
      interval_seconds: 900,
    });
    const now = new Date();
    const oneMonthAgo = new Date(now.getTime() - 30 * 86400 * 1000);
    const toIso = (d) => d.toISOString().slice(0, 16);
    setBackfillForm({
      from_date: toIso(oneMonthAgo),
      to_date: toIso(now),
      interval_seconds: 3600,
      min_value: String(defaults.min_value),
      max_value: String(defaults.max_value),
    });
    // Fetch existing config, if any
    try {
      const { data } = await api.get(`/api/instrument-registry/${it.hardware_id}/dummy`);
      if (data?.dummy_config) {
        setDummyForm({
          enabled: !!data.dummy_config.enabled,
          min_value: data.dummy_config.min_value != null ? String(data.dummy_config.min_value) : String(defaults.min_value),
          max_value: data.dummy_config.max_value != null ? String(data.dummy_config.max_value) : String(defaults.max_value),
          interval_seconds: data.dummy_config.interval_seconds || 900,
        });
      }
    } catch (e) {
      // 404 for legacy rows without a config — that's OK, we'll create one.
    }
    setDummyOpen(true);
  };

  const submitDummyLive = async () => {
    if (!dummyTarget) return;
    const lo = parseFloat(dummyForm.min_value);
    const hi = parseFloat(dummyForm.max_value);
    if (dummyForm.enabled) {
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
        toast.error('Min and Max values must be numbers');
        return;
      }
      if (hi <= lo) { toast.error('Max value must be greater than Min value'); return; }
    }
    setDummySubmitting(true);
    try {
      await api.put(`/api/instrument-registry/${dummyTarget.hardware_id}/dummy`, {
        enabled: !!dummyForm.enabled,
        min_value: Number.isFinite(lo) ? lo : null,
        max_value: Number.isFinite(hi) ? hi : null,
        interval_seconds: parseInt(dummyForm.interval_seconds, 10) || 900,
      });
      toast.success(dummyForm.enabled
        ? `Dummy mode ON — new readings every ${dummyForm.interval_seconds}s (${lo}…${hi})`
        : 'Dummy mode turned OFF');
      setDummyOpen(false);
      refresh();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    } finally {
      setDummySubmitting(false);
    }
  };

  const submitBackfill = async () => {
    if (!dummyTarget) return;
    const lo = parseFloat(backfillForm.min_value);
    const hi = parseFloat(backfillForm.max_value);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
      toast.error('Min and Max must be numbers with Max > Min'); return;
    }
    if (!backfillForm.from_date || !backfillForm.to_date) {
      toast.error('Both start and end dates are required'); return;
    }
    // Preview # of points
    const from = new Date(backfillForm.from_date);
    const to = new Date(backfillForm.to_date);
    if (from >= to) { toast.error('Start date must be before end date'); return; }
    const interval = parseInt(backfillForm.interval_seconds, 10) || 3600;
    const nPoints = Math.floor((to - from) / 1000 / interval);
    if (nPoints > 200000) {
      toast.error(`Selected range would generate ${nPoints.toLocaleString()} rows (max 200,000). Increase the interval.`);
      return;
    }
    if (!window.confirm(`Generate ~${nPoints.toLocaleString()} dummy readings for ${dummyTarget.hardware_id}?\n\nWindow: ${backfillForm.from_date} → ${backfillForm.to_date}\nInterval: every ${interval}s\nRange: ${lo} .. ${hi}\n\nThis cannot be undone (rows are marked _dummy internally).`)) return;

    setDummySubmitting(true);
    setBackfillResult(null);
    try {
      const { data } = await api.post(
        `/api/instrument-registry/${dummyTarget.hardware_id}/dummy/backfill`,
        {
          from_date: new Date(backfillForm.from_date).toISOString(),
          to_date: new Date(backfillForm.to_date).toISOString(),
          interval_seconds: interval,
          min_value: lo, max_value: hi,
        }
      );
      setBackfillResult(data);
      toast.success(`Backfilled ${data.inserted_count?.toLocaleString?.() ?? data.inserted_count} readings`);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    } finally {
      setDummySubmitting(false);
    }
  };

  if (!admin) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <Shield className="h-12 w-12 mx-auto text-gray-400" />
            <h2 className="text-xl font-semibold">Admin access required</h2>
            <p className="text-gray-600">Only administrators can manage the instrument registry.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const buildPayload = (raw) => {
    const out = { ...raw };
    out.hardware_id = out.hardware_id?.trim();
    out.label = out.label?.trim() || out.hardware_id;
    out.location_name = out.location_name?.trim() || null;
    out.latitude = out.latitude === '' || out.latitude == null ? null : parseFloat(out.latitude);
    out.longitude = out.longitude === '' || out.longitude == null ? null : parseFloat(out.longitude);
    // Category — flowmeter uses the user-picked value from CATEGORY_OPTIONS;
    // every other type carries a *fixed* category from INSTRUMENT_CATEGORY_MAP
    // so reports/dashboards can group DWLRs (Ground Water Level) separately
    // from STP-side devices (STP Water Quality) etc.
    if (out.instrument_type !== 'flowmeter') {
      const fixed = INSTRUMENT_CATEGORY_MAP[out.instrument_type];
      if (fixed) out.category = fixed.value; else delete out.category;
    }
    // IMEI / vendor deviceId — accept any non-empty printable string.
    // MQTT devices report numeric SIM IMEIs; QESPL HTTP devices report
    // alphanumeric ids like `DTU10020426`. Some vendors include letters,
    // dashes, dots — so no format restriction is enforced.
    const imei = String(out.imei || '').trim();
    if (imei) out.imei = imei; else delete out.imei;
    // Manual water temp — only send for DWLR (and only if a valid number)
    if (out.instrument_type === 'dwlr') {
      const tv = String(out.manual_water_temp_c ?? '').trim();
      if (tv === '') {
        delete out.manual_water_temp_c;
      } else {
        const n = parseFloat(tv);
        if (Number.isNaN(n)) delete out.manual_water_temp_c;
        else out.manual_water_temp_c = n;
      }
    } else {
      delete out.manual_water_temp_c;
    }
    // Plant + tank capacity for water-quality / DO meter / chlorine-analyzer instruments
    if (out.instrument_type === 'wq_stp' || out.instrument_type === 'do_meter' || out.instrument_type === 'chlorine_analyzer') {
      for (const k of ['plant_capacity_kld', 'tank_capacity_kld']) {
        const v = String(out[k] ?? '').trim();
        if (v === '') { delete out[k]; continue; }
        const n = parseFloat(v);
        if (Number.isNaN(n)) delete out[k]; else out[k] = n;
      }
    } else {
      delete out.plant_capacity_kld;
      delete out.tank_capacity_kld;
    }
    // Source override — probe/auto-suggest sets 'http' so QESPL polling
    // engages immediately after registration. Otherwise default (mqtt).
    if (out.source && ['mqtt', 'http'].includes(out.source)) {
      // keep as-is
    } else {
      delete out.source;
    }
    return out;
  };

  const handleCreate = async () => {
    if (!form.hardware_id || !form.owner_user_id) {
      toast.error('Hardware ID and Owner are required');
      return;
    }
    try {
      await api.post('/api/instrument-registry', buildPayload(form));
      toast.success(`Instrument ${form.hardware_id} registered`);
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      refresh();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    }
  };

  const openEdit = (it) => {
    setEditTarget(it);
    setForm({
      hardware_id: it.hardware_id,
      instrument_type: it.instrument_type,
      owner_user_id: it.owner_user_id || '',
      label: it.label || '',
      location_name: it.location_name || '',
      latitude: it.latitude != null ? String(it.latitude) : '',
      longitude: it.longitude != null ? String(it.longitude) : '',
      category: it.category || 'groundwater_abstraction',
      imei: it.imei || '',
      manual_water_temp_c: it.manual_water_temp_c != null ? String(it.manual_water_temp_c) : '',
      plant_capacity_kld: it.plant_capacity_kld != null ? String(it.plant_capacity_kld) : '',
      tank_capacity_kld: it.tank_capacity_kld != null ? String(it.tank_capacity_kld) : '',
    });
    // Preload the alert-threshold section — kept in a separate form so the
    // "Save thresholds" button posts to the dedicated /thresholds endpoint
    // without accidentally sending stale registry fields.
    setThresholdForm({
      turbidity_k: it.turbidity_k != null ? String(it.turbidity_k) : '',
      chlorine_min: it.chlorine_min != null ? String(it.chlorine_min) : '',
      chlorine_max: it.chlorine_max != null ? String(it.chlorine_max) : '',
      chlorine_dose_target_mg_l: it.chlorine_dose_target_mg_l != null ? String(it.chlorine_dose_target_mg_l) : '',
      chlorine_solution_pct: it.chlorine_solution_pct != null ? String(it.chlorine_solution_pct) : '',
      chlorine_pump_kw: it.chlorine_pump_kw != null ? String(it.chlorine_pump_kw) : '',
      chlorine_flow_kld: it.chlorine_flow_kld != null ? String(it.chlorine_flow_kld) : '',
    });
    setEditOpen(true);
  };

  const saveThresholds = async () => {
    if (!editTarget) return;
    const body = {};
    const kv = (s) => { const n = parseFloat(String(s ?? '').trim()); return Number.isFinite(n) ? n : null; };
    const tk = kv(thresholdForm.turbidity_k);
    const cmin = kv(thresholdForm.chlorine_min);
    const cmax = kv(thresholdForm.chlorine_max);
    const target = kv(thresholdForm.chlorine_dose_target_mg_l);
    const pct = kv(thresholdForm.chlorine_solution_pct);
    const kw = kv(thresholdForm.chlorine_pump_kw);
    const flow = kv(thresholdForm.chlorine_flow_kld);
    if (tk != null) body.turbidity_k = tk;
    if (cmin != null) body.chlorine_min = cmin;
    if (cmax != null) body.chlorine_max = cmax;
    if (target != null) body.chlorine_dose_target_mg_l = target;
    if (pct != null) body.chlorine_solution_pct = pct;
    if (kw != null) body.chlorine_pump_kw = kw;
    if (flow != null) body.chlorine_flow_kld = flow;
    if (Object.keys(body).length === 0) { toast.error('Enter at least one value to save'); return; }
    if (body.chlorine_min != null && body.chlorine_max != null && body.chlorine_min >= body.chlorine_max) {
      toast.error('Chlorine min must be less than max');
      return;
    }
    setSavingThresholds(true);
    try {
      await api.put(`/api/water-quality/${editTarget.hardware_id}/thresholds`, body);
      toast.success('Alert thresholds & dose config saved');
      refresh();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    } finally {
      setSavingThresholds(false);
    }
  };

  const handleEdit = async () => {
    if (!editTarget) return;
    try {
      const { hardware_id: _ignore, ...rest } = buildPayload(form);
      await api.put(`/api/instrument-registry/${editTarget.hardware_id}`, rest);
      toast.success(`Instrument ${editTarget.hardware_id} updated`);
      setEditOpen(false);
      setEditTarget(null);
      refresh();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    }
  };

  const handleDelete = async (it) => {
    if (!window.confirm(`Remove ${it.hardware_id}? This deletes ALL readings, edits and limits for this device.`)) return;
    try {
      const { data } = await api.delete(`/api/instrument-registry/${it.hardware_id}`);
      const total = Object.values(data.removed || {}).reduce((a, b) => a + (b || 0), 0);
      toast.success(`Removed ${it.hardware_id} — purged ${total} records`);
      refresh();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    }
  };

  const toggleSelect = (hw) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(hw)) next.delete(hw); else next.add(hw);
      return next;
    });
  };
  const toggleSelectAll = (visible) => {
    setSelected((prev) => {
      if (visible.every((h) => prev.has(h))) return new Set();
      const next = new Set(prev);
      visible.forEach((h) => next.add(h));
      return next;
    });
  };
  const bulkDeleteSelected = async () => {
    if (selected.size === 0) return;
    if (!window.confirm(`Delete ${selected.size} instrument${selected.size === 1 ? '' : 's'} and ALL their readings? This cannot be undone.`)) return;
    setBulkDeleting(true);
    let ok = 0;
    let failed = 0;
    for (const hw of Array.from(selected)) {
      try {
        await api.delete(`/api/instrument-registry/${encodeURIComponent(hw)}`);
        ok += 1;
      } catch { failed += 1; }
    }
    setBulkDeleting(false);
    setSelected(new Set());
    if (failed) toast.error(`Deleted ${ok}, failed ${failed}`);
    else toast.success(`Deleted ${ok} instrument${ok === 1 ? '' : 's'}`);
    refresh();
  };

  const doRename = async () => {
    if (!renameTarget?.device) return;
    const trimmed = (renameTarget.new_id || '').trim();
    if (!trimmed) { toast.error('Enter a new hardware ID'); return; }
    if (trimmed === renameTarget.device.hardware_id) { toast.error('New ID must differ from the current one'); return; }
    setRenaming(true);
    try {
      const oldId = renameTarget.device.hardware_id;
      const { data } = await api.post(
        `/api/instrument-registry/${encodeURIComponent(oldId)}/rename`,
        { new_hardware_id: trimmed },
      );
      toast.success(`Renamed ${oldId} → ${data.new_hardware_id} · ${data.total_rows_updated} FK rows updated`);
      setRenameTarget(null);
      refresh();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Rename failed');
    } finally { setRenaming(false); }
  };

  const doClearHistory = async () => {
    if (!clearTarget?.device) return;
    const { device, from, to } = clearTarget;
    const label = cleanLabel(device.label || device.hardware_id);
    const scope = from || to ? `readings between ${from || 'start'} and ${to || 'now'}` : 'ALL history';
    if (!window.confirm(`Delete ${scope} for ${label}?\nThis cannot be undone.`)) return;
    setClearing(true);
    try {
      const { data } = await api.post(
        `/api/instrument-registry/${encodeURIComponent(device.hardware_id)}/clear-history`,
        { from_ts: from || null, to_ts: to || null },
      );
      toast.success(`Cleared ${data.total_rows_deleted} rows for ${label}`);
      setClearTarget(null);
      refresh();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Clear failed');
    } finally { setClearing(false); }
  };

  const doSaveFrequency = async () => {
    if (!freqTarget?.device) return;
    const minutes = parseInt(freqTarget.minutes, 10) || 0;
    const retention_days = parseInt(freqTarget.retention_days, 10) || 0;
    setSavingFreq(true);
    try {
      await api.put(
        `/api/instrument-registry/${encodeURIComponent(freqTarget.device.hardware_id)}/data-frequency`,
        { minutes, retention_days },
      );
      const bits = [];
      if (minutes) bits.push(`freq ${minutes} min`);
      if (retention_days) bits.push(`retention ${retention_days} d`);
      toast.success(bits.length ? `Saved — ${bits.join(', ')}` : 'Throttling & retention disabled');
      setFreqTarget(null);
      refresh();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Save failed');
    } finally { setSavingFreq(false); }
  };

  const handleWipeDemo = async () => {
    try {
      const { data } = await api.post('/api/instrument-registry/wipe-demo');
      toast.success(`Demo data wiped (${data.wiped?.device_count || 0} devices cleaned)`);
      setWipeOpen(false);
      refresh();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    }
  };

  const handlePurgeOrphans = async () => {
    if (!window.confirm('Permanently delete every reading whose device is NOT in the registry?\n\nThis cleans leftover test data from old simulator runs / QA tests. Registered devices are NOT affected.')) return;
    try {
      const { data } = await api.post('/api/instrument-registry/purge-orphans');
      const total = Object.values(data.purged || {}).reduce((a, b) => a + (b || 0), 0);
      toast.success(`Purged ${total} orphan records — only your ${data.registered_devices} registered device(s) remain`);
      refresh();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    }
  };

  // ---------- MQTT simulate helpers ----------
  const openSimulate = (it = null) => {
    // Prefill topic + payload from the selected instrument (if any) so the admin
    // can just click send and see it flow through.
    setSimResult(null);
    const imei = it?.imei || '860738070478155';
    if (!it || it.instrument_type === 'flowmeter') {
      const idPart = it?.hardware_id?.replace(/\D+/g, '').slice(-3) || '673';
      setSimForm({
        topic: `${idPart}/0`,
        payload: JSON.stringify(
          {
            TOT1: '0.00', IMEI: imei, VER: '4G-1', TIME: '260630130649', SIGNAL: 13,
            FLOW: '40.97', IMSI: '404980524791050', RTOT1: '0.00', TOT2: '0.00',
            UNT: 1.0, RTOT2: '0.00',
          },
          null,
          2
        ),
      });
    } else {
      const idPart = it?.hardware_id?.replace(/\D+/g, '').slice(-3) || '673';
      setSimForm({
        topic: `P${idPart}/0`,
        payload: JSON.stringify(
          {
            TIME: '260630130834', SIGNAL: 13, UNT: 1.0, LEVEL: '40.97',
            IMSI: '404980524791050', IMEI: imei, VER: '4G-1', FLOW: '40.97',
          },
          null,
          2
        ),
      });
    }
    setSimOpen(true);
  };

  const submitSimulate = async () => {
    setSimSubmitting(true);
    setSimResult(null);
    try {
      // Parse payload — accept either raw JSON string or an object literal.
      let payloadValue;
      try {
        payloadValue = JSON.parse(simForm.payload);
      } catch {
        // Fall back to sending as a raw string — backend also handles that.
        payloadValue = simForm.payload;
      }
      const { data } = await api.post('/api/devices/mqtt-simulate', {
        topic: simForm.topic.trim(),
        payload: payloadValue,
      });
      setSimResult(data);
      if (data.dispatched) {
        toast.success(`Delivered to ${data.hardware_id} (${data.instrument_type}) — check the dashboard`);
        refresh();
      } else {
        toast.error(data.reason || 'Not delivered');
      }
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    } finally {
      setSimSubmitting(false);
    }
  };

  const totals = {
    total: items.length,
    flowmeters: items.filter((i) => i.instrument_type === 'flowmeter').length,
    instruments: items.filter((i) => i.instrument_type !== 'flowmeter').length,
    clients: new Set(items.map((i) => i.owner_user_id).filter(Boolean)).size,
  };

  return (
    <div className="p-6 space-y-6" data-testid="instruments-management-page">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Instrument Registry</h1>
          <p className="text-gray-600 mt-1">Admin-only — register physical devices and assign them to client accounts.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => openSimulate(null)} data-testid="simulate-mqtt-btn" title="Simulate an incoming IoT message end-to-end">
            <Radio className="h-4 w-4 mr-2" /> Simulate Device Message
          </Button>
          <Button variant="outline" className="text-red-600 border-red-500" onClick={handlePurgeOrphans} data-testid="purge-orphans-btn">
            <Trash2 className="h-4 w-4 mr-2" /> Purge Orphan Data
          </Button>
          <Button variant="outline" className="text-amber-700 border-amber-500" onClick={() => setWipeOpen(true)} data-testid="wipe-demo-data-btn">
            <RotateCcw className="h-4 w-4 mr-2" /> Wipe Demo Data
          </Button>
          <Button style={{ backgroundColor: '#4a9fd8' }} onClick={() => { setForm(EMPTY_FORM); setCreateOpen(true); }} data-testid="add-instrument-btn">
            <Plus className="mr-2 h-4 w-4" /> Add Instrument
          </Button>
          <Button variant="outline" onClick={() => setBulkOpen(true)} data-testid="bulk-add-btn" title="Register multiple instruments for one site in one flow">
            <Layers className="mr-2 h-4 w-4" /> Bulk Add
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-6"><div className="flex items-center justify-between"><div><p className="text-sm text-gray-600">Registered</p><p className="text-3xl font-bold">{totals.total}</p></div><Cpu className="h-8 w-8 text-blue-500" /></div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="flex items-center justify-between"><div><p className="text-sm text-gray-600">Flowmeters</p><p className="text-3xl font-bold">{totals.flowmeters}</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="flex items-center justify-between"><div><p className="text-sm text-gray-600">Other Instruments</p><p className="text-3xl font-bold">{totals.instruments}</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="flex items-center justify-between"><div><p className="text-sm text-gray-600">Assigned Clients</p><p className="text-3xl font-bold">{totals.clients}</p></div></div></CardContent></Card>
      </div>

      {/* ============ LIVE MQTT TRAFFIC PANEL ============ */}
      <Card className="border-t-4" style={{ borderTopColor: '#4a9fd8' }} data-testid="mqtt-traffic-card">
        <CardHeader className="cursor-pointer" onClick={() => setTrafficOpen((v) => !v)}>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Activity className={`h-5 w-5 ${traffic?.connected ? 'text-emerald-500 animate-pulse' : 'text-gray-400'}`} />
              Live MQTT Traffic
              {traffic?.connected ? (
                <span className="text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-medium">Connected</span>
              ) : (
                <span className="text-xs bg-red-100 text-red-800 px-2 py-0.5 rounded-full font-medium">Disconnected</span>
              )}
            </span>
            <span className="text-sm font-normal text-gray-500">
              {trafficOpen ? 'Hide ▲' : 'Show ▼'}
            </span>
          </CardTitle>
          <CardDescription>
            Shows the last 50 messages received by the backend from the MQTT broker. Auto-refreshes every 5&nbsp;seconds. Unregistered IMEIs appear in amber — click <em>Register this</em> to add them.
          </CardDescription>
        </CardHeader>
        {trafficOpen && (
          <CardContent>
            {traffic?.error ? (
              <div className="p-3 rounded bg-red-50 text-red-700 text-sm">{traffic.error}</div>
            ) : !traffic ? (
              <p className="text-center py-6 text-gray-500 text-sm">Loading traffic…</p>
            ) : (
              <div className="space-y-4">
                {/* Counters */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="mqtt-traffic-counters">
                  <div className="p-3 bg-blue-50 rounded-lg">
                    <p className="text-xs text-gray-600">Broker</p>
                    <p className="text-sm font-mono font-semibold break-all">{traffic.broker || '—'}</p>
                  </div>
                  <div className="p-3 bg-emerald-50 rounded-lg">
                    <p className="text-xs text-gray-600">Total received</p>
                    <p className="text-2xl font-bold tabular-nums text-emerald-700">{traffic.total_received ?? 0}</p>
                  </div>
                  <div className="p-3 bg-amber-50 rounded-lg">
                    <p className="text-xs text-gray-600">Dropped (unknown IMEI)</p>
                    <p className="text-2xl font-bold tabular-nums text-amber-700">{traffic.total_dropped_unknown ?? 0}</p>
                  </div>
                  <div className="p-3 bg-purple-50 rounded-lg">
                    <p className="text-xs text-gray-600">Subscribed topics</p>
                    <p className="text-sm font-mono font-semibold">{(traffic.subscribed_topics || []).join(', ') || '—'}</p>
                  </div>
                </div>

                {/* Unregistered IMEIs — call to action */}
                {traffic.unregistered_imeis?.length > 0 && (
                  <div className="p-4 border-2 border-amber-300 bg-amber-50 rounded-lg" data-testid="mqtt-unregistered-block">
                    <div className="flex items-start gap-2 mb-2">
                      <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-amber-900">Devices transmitting but NOT registered</p>
                        <p className="text-xs text-amber-800">These IMEIs are reaching the backend but their data is being dropped. Register them to start persisting readings.</p>
                      </div>
                    </div>
                    <div className="space-y-1.5 mt-2">
                      {traffic.unregistered_imeis.map((u) => (
                        <div key={u.imei} className="flex items-center justify-between bg-white rounded px-3 py-2 border border-amber-200" data-testid={`unregistered-imei-${u.imei}`}>
                          <div className="text-xs">
                            <span className="font-mono font-semibold text-gray-900">{u.imei}</span>
                            <span className="text-gray-500"> · topic <span className="font-mono">{u.topic}</span> · {u.count} msg{u.count === 1 ? '' : 's'}</span>
                            {u.last_seen && (
                              <div className="text-[10px] text-gray-500 font-mono mt-0.5" data-testid={`unregistered-lastseen-${u.imei}`}>
                                Last seen: {new Date(u.last_seen).toLocaleString([], { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                              </div>
                            )}
                          </div>
                          <Button size="sm" onClick={() => adoptUnknownImei(u.imei)} data-testid={`register-imei-${u.imei}`} className="bg-amber-600 hover:bg-amber-700 text-white">
                            <Plus className="h-3 w-3 mr-1" /> Register this
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Message log */}
                <div className="overflow-x-auto border rounded-lg">
                  <table className="w-full text-xs" data-testid="mqtt-traffic-table">
                    <thead className="bg-gray-50 border-b sticky top-0">
                      <tr>
                        <th className="text-left p-2 w-44">Time</th>
                        <th className="text-left p-2 w-8"></th>
                        <th className="text-left p-2 w-24">Topic</th>
                        <th className="text-left p-2 w-40">IMEI</th>
                        <th className="text-left p-2 w-32">Device</th>
                        <th className="text-left p-2">Result</th>
                        <th className="text-right p-2 w-16">Bytes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(traffic.recent || []).length === 0 ? (
                        <tr><td colSpan={7} className="text-center py-6 text-gray-500">
                          No traffic yet. Waiting for MQTT messages…
                        </td></tr>
                      ) : (
                        (traffic.recent || []).map((m) => (
                          <tr key={m.seq} className={`border-b ${m.dispatched ? 'bg-white' : 'bg-amber-50/50'}`}>
                            <td className="p-2 font-mono text-gray-600 whitespace-nowrap">
                              {new Date(m.ts).toLocaleString([], { year: '2-digit', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                              {m.source === 'simulate' && (
                                <span className="ml-1 text-[10px] px-1 rounded bg-purple-100 text-purple-700">SIM</span>
                              )}
                            </td>
                            <td className="p-2">
                              {m.dispatched
                                ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                : <XCircle className="h-4 w-4 text-amber-500" />}
                            </td>
                            <td className="p-2 font-mono">{m.topic}</td>
                            <td className="p-2 font-mono">{m.imei || <span className="text-gray-400">—</span>}</td>
                            <td className="p-2">
                              {m.hardware_id ? (
                                <span className="text-gray-900">{cleanLabel(m.hardware_id)}<span className="ml-1 text-[10px] text-gray-500">({m.instrument_type})</span></span>
                              ) : (
                                <span className="text-gray-400">—</span>
                              )}
                            </td>
                            <td className="p-2">
                              {m.dispatched
                                ? <span className="text-emerald-700 font-medium">Stored</span>
                                : <span className="text-amber-700">{m.reason || 'dropped'}</span>}
                            </td>
                            <td className="p-2 text-right font-mono text-gray-600">{m.bytes}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        )}
      </Card>


      {/* ============ LIVE HTTP TRAFFIC — ESPL ============ */}
      <Card className="border-t-4" style={{ borderTopColor: '#f59e0b' }} data-testid="espl-traffic-card">
        <CardHeader className="cursor-pointer" onClick={() => setEsplOpen((v) => !v)}>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Activity className={`h-5 w-5 ${espl?.recent?.some?.((r) => r.ok) ? 'text-emerald-500 animate-pulse' : 'text-gray-400'}`} />
              Live HTTP Traffic — ESPL
              {espl && (
                <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-medium">
                  {(espl.total || 0) === 0 ? 'Idle' : `${espl.ok || 0}/${espl.total || 0} ok`}
                </span>
              )}
            </span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); esplExportCsv(); }} data-testid="espl-export-csv-btn">
                Export CSV
              </Button>
              <Button size="sm" onClick={(e) => { e.stopPropagation(); esplPollNow(); }} disabled={esplPolling} data-testid="espl-poll-now-btn">
                {esplPolling ? 'Polling…' : 'Poll now'}
              </Button>
              <span className="text-sm font-normal text-gray-500">
                {esplOpen ? 'Hide ▲' : 'Show ▼'}
              </span>
            </div>
          </CardTitle>
          <CardDescription>
            Shows the last 50 REST polls to <span className="font-mono">api.qenggonline.com</span>. Poller runs every 5 min per device. Failed polls appear in amber.
          </CardDescription>
          {/* Auto-Suggest Registration probe input */}
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-1 text-xs text-gray-600">
              <Radio className="h-3.5 w-3.5" /> <span>Probe deviceId:</span>
            </div>
            <Input
              value={probeDeviceId}
              onChange={(e) => setProbeDeviceId(e.target.value)}
              placeholder="e.g. DTU10020426"
              className="h-8 w-56 font-mono text-xs"
              data-testid="probe-device-input"
              onKeyDown={(e) => { if (e.key === 'Enter') runProbe(); }}
            />
            <Button size="sm" variant="outline" onClick={runProbe} disabled={probing} data-testid="probe-device-btn">
              {probing ? 'Probing…' : 'Probe'}
            </Button>
            <span className="text-[11px] text-gray-500">
              Check whether a suspected deviceId returns data on QESPL — one-click register if it does.
            </span>
          </div>
        </CardHeader>
        {/* Probe result callout (rendered inside the card body only when open, else above the table) */}
        {esplOpen && probeResult && (
          <div className={`mx-6 mt-3 mb-1 rounded-lg border p-3 ${
            probeResult.already_registered ? 'bg-blue-50 border-blue-200' :
            probeResult.ok ? 'bg-emerald-50 border-emerald-300' :
            'bg-amber-50 border-amber-300'
          }`} data-testid="probe-result">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 space-y-1">
                <p className="text-sm font-semibold">
                  {probeResult.already_registered ? '✓ Already registered' :
                   probeResult.ok ? '🎯 Live data found — unregistered deviceId' :
                   '⚠ Probe result'}
                </p>
                <p className="text-xs text-gray-700">
                  <span className="font-mono">{probeResult.device_id}</span>
                  {probeResult.http_status ? ` · HTTP ${probeResult.http_status}` : ''} · {probeResult.result}
                </p>
                {probeResult.already_registered && (
                  <p className="text-xs text-blue-800">
                    Registered as <strong>{probeResult.already_registered.label || probeResult.already_registered.hardware_id}</strong>
                    {' '}({probeResult.already_registered.instrument_type}) · source: {probeResult.already_registered.source || 'mqtt'}
                  </p>
                )}
                {probeResult.ok && probeResult.values && Object.keys(probeResult.values).length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-1">
                    {Object.entries(probeResult.values).map(([k, v]) => (
                      <span key={k} className="text-[11px] bg-white border rounded px-2 py-0.5 font-mono">
                        {k}: <strong>{typeof v === 'number' ? v.toFixed(2) : String(v)}</strong>
                      </span>
                    ))}
                  </div>
                )}
                {probeResult.ok && probeResult.inferred_instrument_type && !probeResult.already_registered && (
                  <p className="text-xs text-emerald-800 mt-1">
                    Suggested type: <strong>{probeResult.inferred_instrument_type}</strong>
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                {probeResult.ok && !probeResult.already_registered && (
                  <Button size="sm" onClick={registerProbeResult} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="probe-register-btn">
                    <Plus className="h-3.5 w-3.5 mr-1" /> Register this device
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setProbeResult(null)} data-testid="probe-dismiss-btn">
                  Dismiss
                </Button>
              </div>
            </div>
          </div>
        )}
        {esplOpen && (
          <CardContent>
            {espl?.error ? (
              <div className="p-3 rounded bg-red-50 text-red-700 text-sm">{espl.error}</div>
            ) : !espl ? (
              <p className="text-center py-6 text-gray-500 text-sm">Loading traffic…</p>
            ) : (
              <div className="space-y-4">
                {/* Counters */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="espl-traffic-counters">
                  <div className="p-3 bg-blue-50 rounded-lg">
                    <p className="text-xs text-gray-600">Endpoint</p>
                    <p className="text-sm font-mono font-semibold break-all">{espl.endpoint || '—'}</p>
                  </div>
                  <div className="p-3 bg-emerald-50 rounded-lg">
                    <p className="text-xs text-gray-600">Total polls</p>
                    <p className="text-2xl font-bold tabular-nums text-emerald-700">{espl.total ?? 0}</p>
                  </div>
                  <div className="p-3 bg-green-50 rounded-lg">
                    <p className="text-xs text-gray-600">OK</p>
                    <p className="text-2xl font-bold tabular-nums text-green-700">{espl.ok ?? 0}</p>
                  </div>
                  <div className="p-3 bg-amber-50 rounded-lg">
                    <p className="text-xs text-gray-600">Failed</p>
                    <p className="text-2xl font-bold tabular-nums text-amber-700">{espl.failed ?? 0}</p>
                  </div>
                </div>

                {/* Poll log */}
                <div className="overflow-x-auto border rounded-lg">
                  <table className="w-full text-xs" data-testid="espl-traffic-table">
                    <thead className="bg-gray-50 border-b sticky top-0">
                      <tr>
                        <th className="text-left p-2 w-44">Time</th>
                        <th className="text-left p-2 w-36">ESPL Device</th>
                        <th className="text-left p-2 w-32">Hardware ID</th>
                        <th className="text-left p-2 w-24">Device</th>
                        <th className="text-left p-2">Result</th>
                        <th className="text-right p-2 w-16">HTTP</th>
                        <th className="text-right p-2 w-16">Bytes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(espl.recent || []).length === 0 ? (
                        <tr><td colSpan={7} className="text-center py-6 text-gray-500">
                          Idle — no polls yet. Poller runs every 5 min per device.
                        </td></tr>
                      ) : (
                        (espl.recent || []).map((r) => (
                          <tr key={r.seq} className={`border-b ${r.ok ? 'bg-white' : 'bg-amber-50/70'} ${r.probe ? 'ring-1 ring-emerald-200' : ''}`} data-testid={`espl-row-${r.seq}`}>
                            <td className="p-2 font-mono text-gray-600 whitespace-nowrap">
                              {new Date(r.ts).toLocaleString([], { year: '2-digit', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                              {r.probe && <span className="ml-1 text-[9px] uppercase bg-emerald-100 text-emerald-700 rounded px-1">probe</span>}
                            </td>
                            <td className="p-2 font-mono">{r.device_id}</td>
                            <td className="p-2 font-mono">{r.hardware_id ? cleanLabel(r.hardware_id) : <span className="text-gray-400">—</span>}</td>
                            <td className="p-2">
                              <span className="text-[10px] uppercase tracking-wide bg-gray-100 rounded px-1.5 py-0.5">{r.instrument_type || '—'}</span>
                            </td>
                            <td className="p-2">
                              {r.ok ? (
                                <span className="text-emerald-700 font-medium">{r.result}</span>
                              ) : (
                                <span className="text-amber-700">{r.result}{r.error ? ` · ${r.error.slice(0, 60)}` : ''}</span>
                              )}
                            </td>
                            <td className="p-2 text-right font-mono">{r.http_status || '—'}</td>
                            <td className="p-2 text-right font-mono">{r.bytes ?? 0}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        )}
      </Card>


      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle>All Registered Instruments</CardTitle>
          {selected.size > 0 && (
            <Button
              variant="destructive"
              onClick={bulkDeleteSelected}
              disabled={bulkDeleting}
              data-testid="bulk-delete-btn"
            >
              {bulkDeleting ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Delete {selected.size} selected
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center py-8 text-gray-500">Loading…</p>
          ) : items.length === 0 ? (
            <div className="text-center py-12 space-y-3">
              <Cpu className="h-12 w-12 mx-auto text-gray-300" />
              <p className="text-gray-600">No instruments registered yet.</p>
              <p className="text-gray-500 text-sm">Click <strong>Add Instrument</strong> to register your first device and assign it to a client.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full" data-testid="instruments-table">
                <thead>
                  <tr className="border-b">
                    <th className="p-3 w-10">
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        checked={items.length > 0 && items.every((it) => selected.has(it.hardware_id))}
                        onChange={() => toggleSelectAll(items.map((it) => it.hardware_id))}
                        data-testid="instruments-select-all"
                      />
                    </th>
                    <th className="text-left p-3">Hardware ID</th>
                    <th className="text-left p-3">Type</th>
                    <th className="text-left p-3">Label</th>
                    <th className="text-left p-3">IMEI</th>
                    <th className="text-left p-3">Owner</th>
                    <th className="text-left p-3">Location</th>
                    <th className="text-left p-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.hardware_id} className={`border-b hover:bg-gray-50 ${selected.has(it.hardware_id) ? 'bg-blue-50' : ''}`}>
                      <td className="p-3">
                        <input
                          type="checkbox"
                          checked={selected.has(it.hardware_id)}
                          onChange={() => toggleSelect(it.hardware_id)}
                          data-testid={`instruments-select-${it.hardware_id}`}
                        />
                      </td>
                      <td className="p-3 font-mono text-sm">{cleanLabel(it.hardware_id)}</td>
                      <td className="p-3">
                        <Badge className="bg-blue-500 capitalize">{it.instrument_type}</Badge>
                        {it.instrument_type === 'flowmeter' && it.category && (
                          <div className="text-xs text-gray-500 mt-1">{it.category.replace(/_/g, ' ')}</div>
                        )}
                      </td>
                      <td className="p-3">{cleanLabel(it.label) || '—'}</td>
                      <td className="p-3 font-mono text-xs">
                        {it.imei ? (
                          <span className="text-gray-800">{it.imei}</span>
                        ) : (
                          <span className="text-amber-600" title="IMEI not set — device cannot be matched to MQTT messages">⚠ not set</span>
                        )}
                        {it.instrument_type === 'dwlr' && it.manual_water_temp_c != null && (
                          <div className="text-gray-500 mt-0.5">temp: {it.manual_water_temp_c}°C</div>
                        )}
                      </td>
                      <td className="p-3 text-sm">
                        {it.owner_name ? <div className="font-medium">{it.owner_name}</div> : <span className="text-gray-400">unassigned</span>}
                        {it.owner_email && <div className="text-gray-500 text-xs">{it.owner_email}</div>}
                      </td>
                      <td className="p-3 text-sm text-gray-600">
                        {it.location_name || '—'}
                        {it.latitude != null && it.longitude != null && (
                          <div className="text-gray-400 text-xs mt-0.5 font-mono">{Number(it.latitude).toFixed(6)}, {Number(it.longitude).toFixed(6)}</div>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => setKeyTarget(it)} data-testid={`key-instrument-${it.hardware_id}`} title="Show HTTPS ingestion key">
                            <KeyRound className="h-3 w-3 mr-1" /> Key
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => openSimulate(it)} data-testid={`simulate-instrument-${it.hardware_id}`} title="Simulate an MQTT message from this device">
                            <Radio className="h-3 w-3 mr-1" /> Simulate
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => openDummyDialog(it)} data-testid={`dummy-instrument-${it.hardware_id}`} title="Configure dummy-data automation for this instrument" className={it.dummy_config?.enabled ? 'border-amber-500 text-amber-700' : ''}>
                            <Dices className="h-3 w-3 mr-1" />{it.dummy_config?.enabled ? 'Dummy: ON' : 'Dummy'}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => openEdit(it)} data-testid={`edit-instrument-${it.hardware_id}`}>
                            <Edit3 className="h-3 w-3 mr-1" /> Edit
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setRenameTarget({ device: it, new_id: '' })} data-testid={`rename-instrument-${it.hardware_id}`} title="Rename this device's hardware ID across every collection">
                            <Hash className="h-3 w-3 mr-1" /> Rename ID
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setFreqTarget({ device: it, minutes: it.data_frequency_minutes || 0, retention_days: it.data_retention_days || 0 })} data-testid={`freq-instrument-${it.hardware_id}`} title="How often incoming readings should be stored + auto-purge retention">
                            <Clock className="h-3 w-3 mr-1" /> Data freq{it.data_frequency_minutes ? ` (${it.data_frequency_minutes}m)` : ''}{it.data_retention_days ? ` · ${it.data_retention_days}d` : ''}
                          </Button>
                          {it.retention_purge_count > 0 && (
                            <Badge variant="outline" className="text-amber-700 border-amber-300" title={`${it.retention_purge_count} readings older than ${it.data_retention_days} days — will be purged on the next daily tick`}>
                              <Eraser className="h-3 w-3 mr-1" /> {it.retention_purge_count.toLocaleString()} will be purged today
                            </Badge>
                          )}
                          <Button size="sm" variant="outline" className="text-red-600" onClick={() => setClearTarget({ device: it, from: '', to: '' })} data-testid={`clear-history-${it.hardware_id}`} title="Delete historical readings for this device">
                            <Eraser className="h-3 w-3 mr-1" /> Clear history
                          </Button>
                          <Button size="sm" variant="outline" className="text-red-600 border-red-600" onClick={() => handleDelete(it)} data-testid={`delete-instrument-${it.hardware_id}`}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <BulkAddInstruments
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        users={users}
        onCreated={refresh}
      />


      <CreateInstrumentDialog
        open={createOpen} onOpenChange={setCreateOpen}
        form={form} setForm={setForm} users={users} onSubmit={handleCreate}
      />
      {/* Edit Dialog */}
      <EditInstrumentDialog
        open={editOpen} onOpenChange={setEditOpen}
        form={form} setForm={setForm} users={users} editTarget={editTarget}
        thresholdForm={thresholdForm} setThresholdForm={setThresholdForm}
        saveThresholds={saveThresholds} savingThresholds={savingThresholds}
        onSubmit={handleEdit}
      />

      {/* MQTT Simulate Dialog — end-to-end verification without a broker */}
      <SimulateMessageDialog
        open={simOpen} onClose={() => { setSimOpen(false); setSimResult(null); }}
        simForm={simForm} setSimForm={setSimForm} simResult={simResult}
        simSubmitting={simSubmitting} onSubmit={submitSimulate}
      />

      {/* Rename hardware_id — cascades across every FK collection */}
      <RenameHardwareIdDialog
        renameTarget={renameTarget} setRenameTarget={setRenameTarget}
        onClose={() => setRenameTarget(null)} renaming={renaming} onSubmit={doRename}
      />

      {/* Data receiving frequency (down-sampling) */}
      <DataFrequencyDialog
        freqTarget={freqTarget} setFreqTarget={setFreqTarget}
        onClose={() => setFreqTarget(null)} savingFreq={savingFreq} onSubmit={doSaveFrequency}
      />

      {/* Clear history — deletes readings in a date range (or all) */}
      <ClearHistoryDialog
        clearTarget={clearTarget} setClearTarget={setClearTarget}
        onClose={() => setClearTarget(null)} clearing={clearing} onSubmit={doClearHistory}
      />

      {/* Device key + HTTPS ingestion instructions */}
      <HttpsIngestionDialog
        keyTarget={keyTarget} onClose={() => setKeyTarget(null)}
        backendUrl={backendUrl} copyToClipboard={copyToClipboard} rotateKey={rotateKey}
      />

      {/* Wipe Demo Confirm */}

      {/* Dummy Mode Dialog — per-instrument dummy-data automation + historical backfill */}
      <DummyModeDialog
        open={dummyOpen} onClose={() => { setDummyOpen(false); setBackfillResult(null); }}
        dummyTarget={dummyTarget} dummyTab={dummyTab} setDummyTab={setDummyTab}
        dummyForm={dummyForm} setDummyForm={setDummyForm}
        backfillForm={backfillForm} setBackfillForm={setBackfillForm}
        backfillResult={backfillResult} dummySubmitting={dummySubmitting}
        submitDummyLive={submitDummyLive} submitBackfill={submitBackfill}
      />

      <Dialog open={wipeOpen} onOpenChange={setWipeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-amber-700 flex items-center gap-2"><AlertTriangle className="h-5 w-5" /> Wipe Demo Data</DialogTitle>
            <DialogDescription>Permanently deletes all readings, categories and registry entries for the hardcoded demo device IDs.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p>This will permanently delete every reading, category and registry entry for the canonical demo devices:</p>
            <code className="block bg-gray-100 p-2 rounded text-xs">FM_GW_001, FM_STP_IN, FM_STP_OUT, DWLR001, PH001, TDS001, COND001</code>
            <p className="text-sm text-gray-600">Use this before your first real production demo to clear out development data.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWipeOpen(false)}>Cancel</Button>
            <Button className="bg-amber-600 hover:bg-amber-700" onClick={handleWipeDemo} data-testid="wipe-demo-confirm">Yes, wipe demo data</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Instruments;

