import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Popover, PopoverTrigger, PopoverContent } from '../components/ui/popover';
import { Calendar } from '../components/ui/calendar';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../components/ui/dialog';
import { Download, FileSpreadsheet, FileText, Upload, Loader2, Filter, CalendarIcon, Pencil, Trash2, AlertCircle, BarChart3, Droplets, Gauge, Sigma, Search, RotateCcw, Columns3, ChevronLeft, ChevronRight, Activity, Database, ArrowUpDown } from 'lucide-react';
import api, { formatApiError, apiUrl } from '../lib/api';
import { isAdmin, getToken, getCurrentUser } from '../mockData';
import { toast } from 'sonner';
import ReportsCharts from '../components/ReportsCharts';
import { cleanLabel } from '../utils/labels';

const formatDate = (d) => (d ? d.toISOString().split('T')[0] : '');
const fmt = (n, d = 2) => (n == null || isNaN(n) ? '—' : Number(n).toFixed(d));

/**
 * Customer-facing device label for Reports.
 * The registry keeps hardware_id as the immutable technical identifier;
 * the UI should show the assigned client/customer name and configured
 * device label first, with hardware_id retained as a clear identifier.
 */
const reportDeviceLabel = (device) => {
  if (!device) return '—';
  const owner = cleanLabel(device.owner_name || device.company_name || '');
  const label = cleanLabel(device.label || '');
  const hardware = cleanLabel(device.hardware_id || '');
  const genericTypes = new Set(['DWLR', 'DWLR DEVICE', 'FLOWMETER', 'FLOWMETER DEVICE', 'PH', 'TDS', 'CONDUCTIVITY']);
  const usableLabel = label && !genericTypes.has(label.toUpperCase()) ? label : '';
  const parts = [owner, usableLabel, hardware].filter(Boolean);
  return parts.length ? parts.join(' • ') : hardware || '—';
};

// Parse report timestamps with device measurement time as the authoritative
// reporting clock. received_at is transport/ingestion time and is only a
// legacy fallback when a record has no measurement timestamp. This keeps
// report date ranges and buckets consistent with history/latest/SCADA.
const parseReadingDate = (r) => {
  const cands = [
    r?.measurement_timestamp,
    r?.timestamp,
    r?.values?.timestamp,
    r?.values?.DATE_TIME,
    r?.values?.datetime,
    r?.received_at,
  ];
  for (const raw of cands) {
    if (!raw) continue;
    // number in seconds or milliseconds
    if (typeof raw === 'number') {
      const ms = raw > 1e12 ? raw : raw * 1000;
      const d = new Date(ms);
      if (!isNaN(d)) return d;
    }
    if (typeof raw === 'string') {
      let s = raw.trim();
      if (!s.includes('T')) s = s.replace(' ', 'T');
      // If the string carries no explicit timezone marker, assume UTC — this
      // matches how the backend stores device timestamps for report ordering.
      if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) s = s + 'Z';
      const d = new Date(s);
      if (!isNaN(d)) return d;
    }
  }
  return null;
};

// "24 July 2026"
const humanDate = (d) => (d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—');
const humanTime = (d) => (d ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');

// Pick the first numeric value found under any of the given keys.
// `skipZero` mirrors the DWLR quirk where the sensor reports WTEMP: 0.00 when
// it isn't actually measuring — treating 0 as "unset" lets us fall through
// to a more reliable source (admin `manual_water_temp_c`, or ATEMP).
const pickNum = (obj, keys, { skipZero = false } = {}) => {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && !isNaN(v)) {
      if (skipZero && v === 0) continue;
      return v;
    }
    if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) {
      const n = Number(v);
      if (skipZero && n === 0) continue;
      return n;
    }
  }
  return null;
};

// Aggregate readings into fixed-frequency buckets (daily / weekly / monthly / quarterly / yearly).
// Bucket keys are computed in LOCAL time so that a reading which arrives at
// 05:30 IST on 25-Jul is bucketed as 25-Jul (not 24-Jul UTC). This matches
// what operators see on the timestamp column and what CGWA/CPCB reports
// expect (calendar days in the plant's own timezone).
const bucketKey = (d, freq) => {
  if (!d) return null;
  const y = d.getFullYear();
  const m = d.getMonth();
  const day = d.getDate();
  switch (freq) {
    case 'weekly': {
      // ISO-ish week: Monday-start. Snap to the Monday of that local week.
      const tmp = new Date(y, m, day);
      const dayNum = (tmp.getDay() + 6) % 7; // 0 = Monday
      tmp.setDate(tmp.getDate() - dayNum);
      return `${tmp.getFullYear()}-${String(tmp.getMonth() + 1).padStart(2, '0')}-${String(tmp.getDate()).padStart(2, '0')}`;
    }
    case 'monthly':   return `${y}-${String(m + 1).padStart(2, '0')}`;
    case 'quarterly': return `${y}-Q${Math.floor(m / 3) + 1}`;
    case 'yearly':    return `${y}`;
    case 'daily':
    default:          return `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
};

const Reports = () => {
  const admin = isAdmin();
  const currentUser = getCurrentUser();
  const [section, setSection] = useState('flowmeter'); // flowmeter | dwlr | ph | tds | conductivity

  // Devices dropdown — populated from /api/instrument-registry (scoped by role).
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState(null); // full registry doc, not just id
  const [hardwareId, setHardwareId] = useState('');
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [frequency, setFrequency] = useState('daily'); // daily|weekly|monthly|quarterly|yearly

  const [readings, setReadings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);

  // Load the device dropdown once + whenever the section (instrument type) changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/api/instrument-registry');
        const rows = (data.instruments || data.items || []).filter((it) => it.instrument_type === section);
        if (cancelled) return;
        setDevices(rows);
        // Preserve the current selection if it matches; otherwise clear.
        if (!rows.some((r) => r.hardware_id === hardwareId)) {
          setSelectedDevice(null);
          setHardwareId('');
          setReadings([]);
        }
      } catch (e) { toast.error(formatApiError(e?.response?.data?.detail)); }
    })();
    return () => { cancelled = true; };
  }, [section]);

  const fetchReadings = useCallback(async () => {
    if (section === 'charts') { setReadings([]); return; }
    if (!hardwareId) {
      toast.error('Please select a device first');
      return;
    }
    setLoading(true);
    try {
      // Pull up to 20k rows (~200 days of 15-min DWLR data). The backend
      // orders history by device measurement time; received_at is transport
      // metadata only and must not become the reporting clock.
      const url = section === 'flowmeter'
        ? `/api/flowmeter/history/${hardwareId}?limit=20000`
        : `/api/instruments/${section}/${hardwareId}/history?limit=20000`;
      const { data } = await api.get(url);
      setReadings(data.readings || []);
      toast.success(`${(data.readings || []).length} reading${(data.readings || []).length === 1 ? '' : 's'} loaded`);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  }, [section, hardwareId]);

  // Compute Forward / Reverse totaliser from raw payload if the backend
  // pre-computed field is missing. Formula from the vendor spec:
  //   Forward = TOT2 × 65535 + TOT1
  //   Reverse = RTOT2 × 65535 + RTOT1
  // Canonical reporting volume is KL. Production devices used m³
  // totalisers before 27-Aug-2026 and litres from 27-Aug-2026 onward.
  // Normalize at the reporting boundary so mixed historical data remains
  // continuous and every client/user sees one unit.
  const TOTALISER_LITRE_CUTOFF = Date.parse('2026-08-27T00:00:00Z');
  const FLOW_LITRE_CUTOFF = Date.parse('2026-08-27T00:00:00Z');

  // Canonical report flow is always m³/h. From 27-Aug-2026 the device FLOW
  // field is L/h; raw_flow is the most authoritative source when present.
  const flowRateToM3h = (r) => {
    if (!r) return null;
    const rawTs = r.measurement_timestamp || r.timestamp || r.received_at || '';
    const ts = Date.parse(rawTs);
    const postCutoff = Number.isFinite(ts) && ts >= FLOW_LITRE_CUTOFF;
    const rawFlow = pickNum(r, ['raw_flow']);
    if (postCutoff && rawFlow != null) return rawFlow / 1000;
    const lph = pickNum(r, ['flow_rate_lph']);
    if (postCutoff && lph != null) return lph / 1000;
    const canonical = pickNum(r, ['flow_rate_m3h']);
    if (canonical != null) return canonical;
    const v = r.values || {};
    const flowRaw = pickNum(v, ['FLOW_M3H', 'FLOW']);
    if (flowRaw == null) return null;
    return postCutoff ? flowRaw / 1000 : flowRaw;
  };
  const totaliserToKl = (value, r) => {
    if (value == null || Number.isNaN(Number(value))) return null;
    const ts = Date.parse(r?.measurement_timestamp || r?.timestamp || r?.received_at || '');
    return Number(value) / (Number.isFinite(ts) && ts >= TOTALISER_LITRE_CUTOFF ? 1000 : 1);
  };

  const fwdTotaliser = (r) => {
    if (r == null) return null;
    if (typeof r.final_forward_totalizer_kl === 'number') return r.final_forward_totalizer_kl;
    if (typeof r.totaliser_end_reading === 'number') return totaliserToKl(r.totaliser_end_reading, r);
    if (typeof r.forward_totalizer === 'number') return totaliserToKl(r.forward_totalizer, r);
    const v = r.values || {};
    const t1 = pickNum(v, ['TOT1', 'tot1']);
    const t2 = pickNum(v, ['TOT2', 'tot2']);
    if (t1 == null || t2 == null) return totaliserToKl(pickNum(v, ['FORWARD_TOT', 'FWD_TOT']), r);
    return totaliserToKl(t2 * 65535 + t1, r);
  };
  const revTotaliser = (r) => {
    if (r == null) return null;
    if (typeof r.final_reverse_totalizer_kl === 'number') return r.final_reverse_totalizer_kl;
    if (typeof r.reverse_totalizer === 'number') return totaliserToKl(r.reverse_totalizer, r);
    const v = r.values || {};
    const t1 = pickNum(v, ['RTOT1', 'rtot1']);
    const t2 = pickNum(v, ['RTOT2', 'rtot2']);
    if (t1 == null || t2 == null) return totaliserToKl(pickNum(v, ['REVERSE_TOT', 'REV_TOT']), r);
    return totaliserToKl(t2 * 65535 + t1, r);
  };

  // Client-side filter + frequency-bucketing applied to whatever's in `readings`.
  //
  // Non-flowmeter sections: keep the latest reading per bucket (a point-in-time
  // snapshot is what an operator wants for water-level / pH etc.).
  //
  // Flowmeter section: emit a *period summary* per bucket with initial
  // (earliest reading in the bucket) and final (latest) totaliser values so
  // the report shows real consumption between two totaliser reads —
  // exactly what CGWA-style compliance reports need.
  const filteredReadings = useMemo(() => {
    if (!readings?.length) return [];
    const s = startDate ? new Date(new Date(startDate).setHours(0, 0, 0, 0)) : null;
    const e = endDate ? new Date(new Date(endDate).setHours(23, 59, 59, 999)) : null;
    const allDated = readings
      .map((r) => ({ r, d: parseReadingDate(r) }))
      .filter(({ d }) => d)
      .sort((a, b) => a.d.getTime() - b.d.getTime());
    // For flowmeter reports, retain the last chronological reading before the
    // selected window as a boundary only. Its final totaliser is the first
    // displayed day's initial totaliser. This guarantees continuity even when
    // the user starts a report on 27-Aug or any later date.
    const flowBoundary = section === 'flowmeter' && s
      ? [...allDated].reverse().find(({ d }) => d < s)
      : null;
    const withDate = allDated.filter(({ d }) => (!s || d >= s) && (!e || d <= e));

    if (section === 'flowmeter') {
      // Group by bucket then compute period consumption as the delta between
      // consecutive buckets' final totaliser values. Falls back to
      // (final − initial) within the bucket when there's no previous bucket
      // to compare against. That way a daily report shows the *change* in
      // totaliser from yesterday to today, a weekly report shows the change
      // week-over-week, etc.
      const groups = new Map();
      for (const { r, d } of withDate) {
        const key = bucketKey(d, frequency);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ r, d });
      }
      // Ordered ascending by bucket key so we can look back one bucket for
      // the delta.
      const ordered = Array.from(groups.entries()).sort((a, b) => (a[0] > b[0] ? 1 : -1));
      const summaries = [];
      let prevFinalFwd = flowBoundary ? fwdTotaliser(flowBoundary.r) : null;
      let prevFinalRev = flowBoundary ? revTotaliser(flowBoundary.r) : null;
      for (let idx = 0; idx < ordered.length; idx++) {
        const [key, arr] = ordered[idx];
        const first = arr[0];
        const last = arr[arr.length - 1];
        const flows = arr.map(({ r }) => flowRateToM3h(r)).filter((n) => n != null);
        const avgFlow = flows.length ? flows.reduce((a, b) => a + b, 0) / flows.length : null;
        const initFwd = fwdTotaliser(first.r);
        const finalFwd = fwdTotaliser(last.r);
        const initRev = revTotaliser(first.r);
        const finalRev = revTotaliser(last.r);
        // Daily/period invariant:
        //   current Initial = previous period Final
        //   current Consumption = current Final − current Initial
        // For the first visible period, use the preceding boundary reading
        // when available; otherwise use that period's first reading.
        const forwardConsumption =
          finalFwd != null && prevFinalFwd != null
            ? Math.max(0, finalFwd - prevFinalFwd)
            : (initFwd != null && finalFwd != null ? Math.max(0, finalFwd - initFwd) : null);
        const reverseConsumption =
          finalRev != null && prevFinalRev != null
            ? Math.max(0, finalRev - prevFinalRev)
            : (initRev != null && finalRev != null ? Math.max(0, finalRev - initRev) : null);

        summaries.push({
          _bucket_key: key,
          _bucket_size: arr.length,
          hardware_id: last.r.hardware_id,
          timestamp: last.r.measurement_timestamp || last.r.timestamp || last.r.received_at,
          received_at: last.r.received_at,
          _bucket_start: first.d.toISOString(),
          _bucket_end: last.d.toISOString(),
          flow_rate_m3h_avg: avgFlow,
          flow_rate_m3h_last: flowRateToM3h(last.r),
          initial_forward_totalizer: prevFinalFwd != null ? prevFinalFwd : initFwd,
          final_forward_totalizer: finalFwd,
          forward_consumption: forwardConsumption,
          initial_forward_totalizer_kl: prevFinalFwd != null ? prevFinalFwd : initFwd,
          final_forward_totalizer_kl: finalFwd,
          initial_reverse_totalizer: prevFinalRev != null ? prevFinalRev : initRev,
          final_reverse_totalizer: finalRev,
          reverse_consumption: reverseConsumption,
          initial_reverse_totalizer_kl: prevFinalRev != null ? prevFinalRev : initRev,
          final_reverse_totalizer_kl: finalRev,
          _raw: last.r,
        });
        if (finalFwd != null) prevFinalFwd = finalFwd;
        if (finalRev != null) prevFinalRev = finalRev;
      }
      return summaries.sort((a, b) => new Date(b._bucket_end) - new Date(a._bucket_end));
    }

    // Non-flowmeter (DWLR / pH / TDS / Conductivity):
    // "raw"      → every reading, newest first (no bucketing)
    // "daily"    → latest reading per day
    // "weekly"   → latest reading per ISO week
    // "monthly"  → latest reading per month
    // "quarterly" and "yearly" behave the same way.
    if (frequency === 'raw') {
      return withDate.map(({ r }) => r).reverse(); // newest first
    }
    const byBucket = new Map();
    for (const { r, d } of withDate) {
      const key = bucketKey(d, frequency);
      byBucket.set(key, r); // ascending order → last write wins = latest reading of that bucket
    }
    return Array.from(byBucket.values()).sort((a, b) => (parseReadingDate(b)?.getTime() || 0) - (parseReadingDate(a)?.getTime() || 0));
  }, [readings, startDate, endDate, frequency, section]);

  // ─────────── Professional CSV export ───────────
  const downloadProfessionalCSV = () => {
    if (!filteredReadings.length) { toast.error('No data to export'); return; }
    const dev = selectedDevice || {};
    const siteName = cleanLabel(dev.label || dev.hardware_id || '—');
    const locationName = dev.location_name || dev.owner_location_name || '—';
    const deviceLabel = cleanLabel(dev.label || dev.hardware_id || hardwareId || '—');
    const rows = [];
    // Header block — client name + report meta (each on its own row so Excel keeps them)
    rows.push([`ENVIROLYTICS — ${section.toUpperCase()} REPORT`]);
    rows.push([`Client:`, currentUser?.fullName || currentUser?.email || '—']);
    rows.push([`Device:`, deviceLabel]);
    rows.push([`Site Name:`, siteName]);
    rows.push([`Location:`, locationName]);
    rows.push([`Date range:`, startDate ? humanDate(startDate) : 'All', 'to', endDate ? humanDate(endDate) : 'All']);
    rows.push([`Frequency:`, frequency.charAt(0).toUpperCase() + frequency.slice(1)]);
    rows.push([`Generated:`, humanDate(new Date()) + ' ' + humanTime(new Date())]);
    rows.push([]);
    // Column header — depends on section
    let cols;
    if (section === 'flowmeter') {
      cols = ['S.No.', 'Site Name', 'Location', 'Device', 'Date', 'Time', 'Flow rate (m³/h)', 'Initial Totaliser (KL)', 'Final Totaliser (KL)', 'Consumption (KL)'];
    } else if (section === 'dwlr') {
      cols = ['S.No.', 'Site Name', 'Location', 'Device', 'Date', 'Time', 'Water Level (mWC)', 'Temperature (°C)'];
    } else {
      cols = ['S.No.', 'Site Name', 'Location', 'Device', 'Date', 'Time', `${section.toUpperCase()} Value`, 'Extra Params (JSON)'];
    }
    rows.push(cols);
    filteredReadings.forEach((r, i) => {
      const d = parseReadingDate(r);
      const base = [i + 1, siteName, locationName, deviceLabel, humanDate(d), humanTime(d)];
      if (section === 'flowmeter') {
        rows.push([
          ...base,
          r.flow_rate_m3h_avg != null ? Number(r.flow_rate_m3h_avg).toFixed(3) : '—',
          r.initial_forward_totalizer_kl != null ? Number(r.initial_forward_totalizer_kl).toFixed(3) : '—',
          r.final_forward_totalizer_kl != null ? Number(r.final_forward_totalizer_kl).toFixed(3) : '—',
          r.forward_consumption != null ? Number(r.forward_consumption).toFixed(2) : '—',
        ]);
      } else if (section === 'dwlr') {
        const level = pickNum(r.values, ['LEVEL', 'LVL', 'level', 'WATER_LEVEL', 'RAW']);
        const temp = dev.manual_water_temp_c ?? pickNum(r.values, ['WTEMP'], { skipZero: true }) ?? pickNum(r.values, ['ATEMP', 'TEMPER', 'TEMP', 'temperature']);
        rows.push([...base, level != null ? level : '—', temp != null ? Number(temp).toFixed(1) : '—']);
      } else {
        const primary = pickNum(r.values, [section.toUpperCase(), 'value', 'READING']);
        rows.push([...base, primary != null ? primary : '—', JSON.stringify(r.values || {})]);
      }
    });
    // Escape + emit CSV
    const csv = rows.map((row) => row.map((c) => {
      const v = c == null ? '' : String(c);
      return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    }).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10);
    a.download = `envirolytics_${section}_${hardwareId}_${frequency}_${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.success('CSV downloaded');
  };

  const triggerDownload = async (format) => {
    if (format === 'csv') { downloadProfessionalCSV(); return; }
    try {
      const params = new URLSearchParams({ format });
      if (hardwareId) params.append('hardware_id', hardwareId);
      if (startDate) params.append('start_date', formatDate(startDate));
      if (endDate) params.append('end_date', formatDate(endDate));
      const url = apiUrl(`/api/flowmeter-mgmt/export?${params.toString()}`);
      const res = await fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.detail || `Download failed: ${res.status}`);
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'flowmeter_report.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.success('PDF downloaded');
    } catch (e) {
      toast.error(e.message || 'Download failed');
    }
  };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      // Pass the current section (`flowmeter` | `dwlr` | …) as instrument_type so the
      // importer picks the right validator + collection. Non-fm/dwlr sections fall
      // back to `flowmeter` server-side.
      const iType = (section === 'dwlr') ? 'dwlr' : 'flowmeter';
      const { data } = await api.post(
        `/api/admin/data/import?instrument_type=${iType}`,
        fd,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      if (data.success) {
        toast.success(
          data.inserted_count
            ? `Imported ${data.inserted_count} row${data.inserted_count === 1 ? '' : 's'}${data.error_count ? ` — ${data.error_count} skipped` : ''}`
            : 'File parsed but no valid rows found'
        );
      } else {
        toast.error(`Validation failed — ${data.error_count} error${data.error_count === 1 ? '' : 's'}${data.errors?.[0] ? `: ${data.errors[0]}` : ''}`);
      }
      fetchReadings();
    } catch (e2) {
      toast.error(formatApiError(e2?.response?.data?.detail));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const downloadTemplate = async () => {
    try {
      const iType = (section === 'dwlr') ? 'dwlr' : 'flowmeter';
      const url = apiUrl(`/api/admin/data/template?instrument_type=${iType}`);
      const res = await fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new Error(`Template download failed: ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = iType === 'dwlr' ? 'dwlr_template.csv' : 'flowmeter_template.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.success(`${iType.toUpperCase()} template downloaded`);
    } catch (err) {
      toast.error(err.message || 'Template download failed');
    }
  };

  // ---- Edit a reading ----
  const openEdit = (row) => {
    setEditTarget(row);
    if (section === 'flowmeter') {
      setEditForm({
        timestamp: row.measurement_timestamp || row.timestamp || row.received_at || '',
        flow_rate_m3h: row.flow_rate_m3h != null ? String(row.flow_rate_m3h) : '',
        forward_totalizer: row.forward_totalizer != null ? String(row.forward_totalizer) : '',
        reverse_totalizer: row.reverse_totalizer != null ? String(row.reverse_totalizer) : '',
        temperature: row.temperature != null ? String(row.temperature) : '',
      });
    } else {
      setEditForm({
        timestamp: row.timestamp || row.received_at || '',
        values: JSON.stringify(row.values || {}, null, 2),
      });
    }
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!editTarget) return;
    setSaving(true);
    try {
      if (section === 'flowmeter') {
        const payload = {};
        if (editForm.timestamp) payload.timestamp = editForm.timestamp;
        ['flow_rate_m3h', 'forward_totalizer', 'reverse_totalizer', 'temperature'].forEach((k) => {
          if (editForm[k] !== '' && editForm[k] != null) payload[k] = parseFloat(editForm[k]);
        });
        await api.put(`/api/flowmeter-mgmt/readings/flowmeter/${editTarget._id}`, payload);
      } else {
        let parsedValues;
        try {
          parsedValues = JSON.parse(editForm.values || '{}');
        } catch {
          toast.error('Values must be valid JSON');
          setSaving(false);
          return;
        }
        await api.put(`/api/flowmeter-mgmt/readings/instrument/${editTarget._id}`, {
          timestamp: editForm.timestamp || undefined,
          values: parsedValues,
        });
      }
      toast.success('Reading updated');
      setEditOpen(false);
      setEditTarget(null);
      fetchReadings();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  const deleteReading = async (row) => {
    if (!window.confirm('Delete this reading? This action is irreversible.')) return;
    try {
      const endpoint = section === 'flowmeter'
        ? `/api/flowmeter-mgmt/readings/flowmeter/${row._id}`
        : `/api/flowmeter-mgmt/readings/instrument/${row._id}`;
      await api.delete(endpoint);
      toast.success('Reading deleted');
      fetchReadings();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    }
  };

  const [tableSearch, setTableSearch] = useState('');
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  const reportStats = useMemo(() => {
    const rows = filteredReadings || [];
    const flows = rows.map((r) => Number(r.flow_rate_m3h_avg)).filter(Number.isFinite);
    const consumptions = rows.map((r) => Number(r.forward_consumption)).filter(Number.isFinite);
    const levels = rows.map((r) => pickNum(r.values, ['LEVEL', 'LVL', 'level', 'WATER_LEVEL', 'RAW'])).filter(Number.isFinite);
    const temps = rows.map((r) => selectedDevice?.manual_water_temp_c ?? pickNum(r.values, ['WTEMP'], { skipZero: true }) ?? pickNum(r.values, ['ATEMP', 'TEMPER', 'TEMP', 'temperature'])).filter(Number.isFinite);
    const totalConsumption = consumptions.reduce((a, b) => a + b, 0);
    const averageFlow = flows.length ? flows.reduce((a, b) => a + b, 0) / flows.length : null;
    const peakFlow = flows.length ? Math.max(...flows) : null;
    const latest = rows[0];
    const earliest = rows[rows.length - 1];
    const latestLevel = levels.length ? levels[0] : null;
    const averageLevel = levels.length ? levels.reduce((a, b) => a + b, 0) / levels.length : null;
    const minLevel = levels.length ? Math.min(...levels) : null;
    const maxLevel = levels.length ? Math.max(...levels) : null;
    const averageTemp = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null;
    const totaliserIncrease = consumptions.length ? totalConsumption : null;
    return { totalConsumption, averageFlow, peakFlow, totaliserIncrease, latestLevel, averageLevel, minLevel, maxLevel, averageTemp };
  }, [filteredReadings]);

  const searchableRows = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    if (!q) return filteredReadings || [];
    return (filteredReadings || []).filter((r) => {
      const d = parseReadingDate(r);
      return [
        humanDate(d), humanTime(d), r.flow_rate_m3h_avg, r.forward_consumption,
        r.initial_forward_totalizer_kl, r.final_forward_totalizer_kl,
        selectedDevice?.label, selectedDevice?.hardware_id, selectedDevice?.location_name
      ].join(' ').toLowerCase().includes(q);
    });
  }, [filteredReadings, tableSearch, selectedDevice]);

  useEffect(() => {
    setCurrentPage(1);
  }, [tableSearch, rowsPerPage, frequency, startDate, endDate, hardwareId, section]);

  const pageCount = Math.max(1, Math.ceil(searchableRows.length / rowsPerPage));
  const safePage = Math.min(currentPage, pageCount);
  const pagedRows = searchableRows.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage);

  // ---- Table row rendering removed — inlined into the JSX below to keep the
  // professional-CSV column layout (S.No. / Site / Location / …) in sync.

  return (
    <div className="min-h-full bg-slate-50/70 px-4 py-5 md:px-6 lg:px-8" data-testid="reports-page">
      <div className="mx-auto max-w-[1700px] space-y-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 shadow-sm ring-1 ring-blue-100"><BarChart3 className="h-7 w-7" /></div>
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">Envirolytics / Reports</div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">Reports &amp; Historical Data</h1>
              <p className="mt-1 text-sm text-slate-500">View, analyse, export and manage historical readings from your instruments.</p>
              <div className="mt-2 flex items-center gap-2 text-xs text-slate-400"><Activity className="h-3.5 w-3.5 text-emerald-500" /> Accurate data <span>•</span> Better decisions <span>•</span> A cleaner environment</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-10 border-slate-200 bg-white shadow-sm" onClick={() => triggerDownload('csv')} data-testid="download-csv-btn"><Download className="mr-2 h-4 w-4" /> Export CSV</Button>
            <Button className="h-10 bg-blue-600 shadow-sm hover:bg-blue-700" onClick={() => triggerDownload('pdf')} data-testid="download-pdf-btn"><FileText className="mr-2 h-4 w-4" /> Export PDF</Button>
            {admin && (section === 'flowmeter' || section === 'dwlr') && <>
              <Button variant="outline" className="h-10 border-slate-200 bg-white shadow-sm" onClick={downloadTemplate} data-testid="download-template-btn"><FileSpreadsheet className="mr-2 h-4 w-4" /> Report Template</Button>
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleUpload} className="hidden" data-testid="upload-excel-input" />
              <Button variant="outline" className="h-10 border-slate-200 bg-white shadow-sm" onClick={() => fileRef.current?.click()} disabled={uploading} data-testid="upload-excel-btn">{uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />} Import CSV/Excel</Button>
            </>}
          </div>
        </div>

        <Tabs value={section} onValueChange={(v) => { setSection(v); setHardwareId(''); setReadings([]); }}>
          <div className="overflow-x-auto pb-1">
            <TabsList className="inline-flex h-auto gap-2 rounded-xl bg-transparent p-0">
              {[['flowmeter','Flowmeter'],['dwlr','DWLR'],['ph','pH'],['tds','TDS'],['conductivity','Conductivity'],['charts','Graphs & Combined']].map(([value,label]) => (
                <TabsTrigger key={value} value={value} data-testid={`reports-tab-${value}`} className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-600 shadow-sm data-[state=active]:border-blue-600 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-md">{label}</TabsTrigger>
              ))}
            </TabsList>
          </div>

          <TabsContent value="charts" className="mt-4"><ReportsCharts /></TabsContent>

          <TabsContent value={section === 'charts' ? '__hide__' : section} className="mt-4 space-y-5">
            <Card className="overflow-hidden border-0 bg-white shadow-sm ring-1 ring-slate-200">
              <CardContent className="p-0">
                <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_520px]">
                  <div className="p-5 md:p-6">
                    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><Filter className="h-5 w-5" /></div>
                        <div><h2 className="text-lg font-bold text-slate-900">Report Filters</h2><p className="text-xs text-slate-500">Select a device, date range and reporting frequency.</p></div>
                      </div>
                      <Button variant="ghost" className="text-slate-500 hover:text-blue-600" onClick={() => { setHardwareId(''); setSelectedDevice(null); setStartDate(null); setEndDate(null); setFrequency('daily'); setReadings([]); setTableSearch(''); }}><RotateCcw className="mr-2 h-4 w-4" /> Reset</Button>
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                      <div>
                        <Label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-600">Device</Label>
                        <select className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100" value={hardwareId} onChange={(e) => { const hw=e.target.value; setHardwareId(hw); setSelectedDevice(devices.find((d)=>d.hardware_id===hw)||null); setReadings([]); }} data-testid="filter-device-select">
                          <option value="">Select {section.toUpperCase()} device</option>
                          {devices.map((d) => <option key={d.hardware_id} value={d.hardware_id}>{reportDeviceLabel(d)}</option>)}
                        </select>
                      </div>
                      <div>
                        <Label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-600">Start Date</Label>
                        <Popover><PopoverTrigger asChild><Button variant="outline" className="h-11 w-full justify-start rounded-xl border-slate-200 bg-white font-normal shadow-none" data-testid="filter-start-date"><CalendarIcon className="mr-2 h-4 w-4 text-slate-400" />{startDate ? startDate.toLocaleDateString('en-GB') : <span className="text-slate-400">DD/MM/YYYY</span>}</Button></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={startDate} onSelect={setStartDate} captionLayout="dropdown" fromYear={2000} toYear={new Date().getFullYear() + 1} initialFocus /></PopoverContent></Popover>
                      </div>
                      <div>
                        <Label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-600">End Date</Label>
                        <Popover><PopoverTrigger asChild><Button variant="outline" className="h-11 w-full justify-start rounded-xl border-slate-200 bg-white font-normal shadow-none" data-testid="filter-end-date"><CalendarIcon className="mr-2 h-4 w-4 text-slate-400" />{endDate ? endDate.toLocaleDateString('en-GB') : <span className="text-slate-400">DD/MM/YYYY</span>}</Button></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={endDate} onSelect={setEndDate} captionLayout="dropdown" fromYear={2000} toYear={new Date().getFullYear() + 1} initialFocus /></PopoverContent></Popover>
                      </div>
                      <div>
                        <Label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-600">Frequency</Label>
                        <select className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100" value={frequency} onChange={(e)=>setFrequency(e.target.value)} data-testid="filter-frequency-select">
                          <option value="raw">All raw readings</option><option value="daily">Daily (1 row / day)</option><option value="weekly">Weekly (1 row / week)</option><option value="monthly">Monthly (1 row / month)</option><option value="quarterly">Quarterly (1 row / quarter)</option><option value="yearly">Yearly (1 row / year)</option>
                        </select>
                      </div>
                    </div>
                    <div className="mt-4 flex justify-end">
                      <Button onClick={() => { const needsBounds=['weekly','monthly','quarterly','yearly'].includes(frequency); if (needsBounds && (!startDate || !endDate)) { toast.error(`${frequency.charAt(0).toUpperCase()+frequency.slice(1)} reports require both a start date and an end date`); return; } fetchReadings(); }} className="h-11 min-w-40 rounded-xl bg-blue-600 px-6 shadow-sm hover:bg-blue-700" disabled={!hardwareId || loading} data-testid="apply-filters-btn">{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Filter className="mr-2 h-4 w-4" />} Apply Filter</Button>
                    </div>
                  </div>
                  <div className="relative hidden aspect-[1794/877] w-full overflow-hidden rounded-2xl border border-sky-100 bg-sky-50 shadow-sm lg:flex lg:items-center lg:justify-center">
              <img
                src={section === 'dwlr' ? '/dwlr-banner.webp' : '/flowmeter-banner.svg'}
                alt={section === 'dwlr' ? 'Envirolytics Digital Water Level Recorder — Continuous Groundwater Monitoring' : 'Envirolytics flowmeter'}
                className="h-full w-full object-contain p-0"
                loading="eager"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
              {section !== 'dwlr' && <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-900/75 to-transparent px-5 pb-4 pt-16">
                <div className="text-sm font-semibold text-white">Accurate Flow Monitoring</div>
                <div className="text-xs text-slate-200">Reliable data • Real-time monitoring • Sustainable water management</div>
              </div>}
            </div>
                </div>
              </CardContent>
            </Card>

            {section === 'dwlr' && <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Card className="border-0 bg-white shadow-sm ring-1 ring-sky-100"><CardContent className="p-5"><div className="flex items-start gap-3"><div className="rounded-2xl bg-sky-50 p-3 text-sky-600"><Droplets className="h-6 w-6"/></div><div><p className="text-xs font-semibold uppercase tracking-wide text-sky-600">Current Water Level</p><p className="mt-1 text-2xl font-bold text-slate-900">{fmt(reportStats.latestLevel,2)} <span className="text-sm font-semibold text-slate-500">mWC</span></p><p className="mt-1 text-xs text-slate-400">Latest selected reading</p></div></div></CardContent></Card>
              <Card className="border-0 bg-white shadow-sm ring-1 ring-emerald-100"><CardContent className="p-5"><div className="flex items-start gap-3"><div className="rounded-2xl bg-emerald-50 p-3 text-emerald-600"><Activity className="h-6 w-6"/></div><div><p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">Average Level</p><p className="mt-1 text-2xl font-bold text-slate-900">{fmt(reportStats.averageLevel,2)} <span className="text-sm font-semibold text-slate-500">mWC</span></p><p className="mt-1 text-xs text-slate-400">Across displayed readings</p></div></div></CardContent></Card>
              <Card className="border-0 bg-white shadow-sm ring-1 ring-violet-100"><CardContent className="p-5"><div className="flex items-start gap-3"><div className="rounded-2xl bg-violet-50 p-3 text-violet-600"><Gauge className="h-6 w-6"/></div><div><p className="text-xs font-semibold uppercase tracking-wide text-violet-600">Level Range</p><p className="mt-1 text-xl font-bold text-slate-900">{fmt(reportStats.minLevel,2)} – {fmt(reportStats.maxLevel,2)} <span className="text-sm font-semibold text-slate-500">mWC</span></p><p className="mt-1 text-xs text-slate-400">Minimum to maximum</p></div></div></CardContent></Card>
              <Card className="border-0 bg-white shadow-sm ring-1 ring-orange-100"><CardContent className="p-5"><div className="flex items-start gap-3"><div className="rounded-2xl bg-orange-50 p-3 text-orange-600"><BarChart3 className="h-6 w-6"/></div><div><p className="text-xs font-semibold uppercase tracking-wide text-orange-600">Average Temperature</p><p className="mt-1 text-2xl font-bold text-slate-900">{fmt(reportStats.averageTemp,1)} <span className="text-sm font-semibold text-slate-500">°C</span></p><p className="mt-1 text-xs text-slate-400">Selected period</p></div></div></CardContent></Card>
            </div>}

            {section === 'flowmeter' && <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
              <Card className="border-0 bg-white shadow-sm ring-1 ring-blue-100"><CardContent className="p-5"><div className="flex items-start gap-3"><div className="rounded-2xl bg-blue-50 p-3 text-blue-600"><Droplets className="h-6 w-6"/></div><div><p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Total Consumption</p><p className="mt-1 text-2xl font-bold text-slate-900">{fmt(reportStats.totalConsumption,3)} <span className="text-sm font-semibold text-slate-500">KL</span></p><p className="mt-1 text-xs text-slate-400">Selected period</p></div></div></CardContent></Card>
              <Card className="border-0 bg-white shadow-sm ring-1 ring-emerald-100"><CardContent className="p-5"><div className="flex items-start gap-3"><div className="rounded-2xl bg-emerald-50 p-3 text-emerald-600"><BarChart3 className="h-6 w-6"/></div><div><p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">Average Flow Rate</p><p className="mt-1 text-2xl font-bold text-slate-900">{fmt(reportStats.averageFlow,3)} <span className="text-sm font-semibold text-slate-500">m³/h</span></p><p className="mt-1 text-xs text-slate-400">Across displayed periods</p></div></div></CardContent></Card>
              <Card className="border-0 bg-white shadow-sm ring-1 ring-orange-100"><CardContent className="p-5"><div className="flex items-start gap-3"><div className="rounded-2xl bg-orange-50 p-3 text-orange-600"><Gauge className="h-6 w-6"/></div><div><p className="text-xs font-semibold uppercase tracking-wide text-orange-600">Peak Flow Rate</p><p className="mt-1 text-2xl font-bold text-slate-900">{fmt(reportStats.peakFlow,3)} <span className="text-sm font-semibold text-slate-500">m³/h</span></p><p className="mt-1 text-xs text-slate-400">Highest displayed value</p></div></div></CardContent></Card>
              <Card className="border-0 bg-white shadow-sm ring-1 ring-violet-100"><CardContent className="p-5"><div className="flex items-start gap-3"><div className="rounded-2xl bg-violet-50 p-3 text-violet-600"><Sigma className="h-6 w-6"/></div><div><p className="text-xs font-semibold uppercase tracking-wide text-violet-600">Totaliser Increase</p><p className="mt-1 text-2xl font-bold text-slate-900">{fmt(reportStats.totaliserIncrease,3)} <span className="text-sm font-semibold text-slate-500">KL</span></p><p className="mt-1 text-xs text-slate-400">Selected period</p></div></div></CardContent></Card>
              <Card className="border-0 bg-blue-50/60 shadow-sm ring-1 ring-blue-100"><CardContent className="p-5"><div className="flex items-start gap-3"><div className="rounded-full bg-blue-100 p-2.5 text-blue-600"><AlertCircle className="h-5 w-5"/></div><div><p className="text-sm font-bold text-slate-800">Data integrity</p><p className="mt-1 text-xs leading-5 text-slate-600">Totaliser values must remain monotonically non-decreasing. Server validation protects historical data.</p></div></div></CardContent></Card>
            </div>}

            <Card className="overflow-hidden border-0 bg-white shadow-sm ring-1 ring-slate-200">
              <CardHeader className="border-b border-slate-100 pb-4">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                  <div className="flex items-start gap-3"><div className="rounded-xl bg-blue-50 p-2.5 text-blue-600"><Database className="h-5 w-5"/></div><div><CardTitle className="text-lg text-slate-900">{section === 'flowmeter' ? 'Flowmeter Historical Data' : `${section.toUpperCase()} Historical Data`} <span className="text-slate-400">({searchableRows.length})</span></CardTitle><CardDescription className="mt-1">Showing data for <span className="font-medium text-slate-700">{selectedDevice ? reportDeviceLabel(selectedDevice) : 'Selected device'}</span></CardDescription></div></div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative w-full sm:w-72"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><Input value={tableSearch} onChange={(e)=>setTableSearch(e.target.value)} placeholder="Search date, value or keyword..." className="h-10 rounded-xl border-slate-200 pl-9"/></div>
                    <Button variant="outline" className="h-10 rounded-xl border-slate-200"><Columns3 className="mr-2 h-4 w-4"/> Columns</Button>
                    <Button className="h-10 rounded-xl bg-emerald-600 hover:bg-emerald-700" onClick={()=>triggerDownload('csv')}><Download className="mr-2 h-4 w-4"/> Export</Button>
                  </div>
                </div>
                {section === 'flowmeter' && <div className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700"><AlertCircle className="h-3.5 w-3.5"/>Totaliser values must be monotonically non-decreasing — server will reject inconsistent edits.</div>}
              </CardHeader>
              <CardContent className="p-0">
                {loading ? <div className="py-16 text-center text-sm text-slate-500"><Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-blue-600"/>Loading historical data…</div> :
                !hardwareId ? <div className="py-16 text-center text-sm text-slate-500">Select a device and date range, then click <b>Apply Filter</b>.</div> :
                searchableRows.length===0 ? <div className="py-16 text-center text-sm text-slate-500">No readings match the selected filters.</div> :
                <div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-sm" data-testid="readings-table">
                  <thead><tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="whitespace-nowrap px-4 py-3 text-left">S.No.</th><th className="whitespace-nowrap px-4 py-3 text-left">Date <ArrowUpDown className="ml-1 inline h-3 w-3"/></th><th className="whitespace-nowrap px-4 py-3 text-left">Time</th>
                    {section==='flowmeter'?<><th className="whitespace-nowrap px-4 py-3 text-right">Flow rate (m³/h)</th><th className="whitespace-nowrap px-4 py-3 text-right">Initial Totaliser (KL)</th><th className="whitespace-nowrap px-4 py-3 text-right">Final Totaliser (KL)</th><th className="whitespace-nowrap px-4 py-3 text-right">Consumption (KL)</th></>:section==='dwlr'?<><th className="whitespace-nowrap px-4 py-3 text-right">Water Level (mWC)</th><th className="whitespace-nowrap px-4 py-3 text-right">Temperature (°C)</th></>:<th className="px-4 py-3 text-left">Values</th>}
                    {admin&&<th className="whitespace-nowrap px-4 py-3 text-right">Actions</th>}
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {pagedRows.map((r,i)=>{const d=parseReadingDate(r);const level=section==='dwlr'?pickNum(r.values,['LEVEL','LVL','level','WATER_LEVEL','RAW']):null;const temp=section==='dwlr'?(selectedDevice?.manual_water_temp_c??pickNum(r.values,['WTEMP'],{skipZero:true})??pickNum(r.values,['ATEMP','TEMPER','TEMP','temperature'])):null;const serial=(safePage-1)*rowsPerPage+i+1;return <tr key={r._id||i} className="transition hover:bg-blue-50/40">
                      <td className="px-4 py-3 font-medium tabular-nums text-slate-500">{serial}</td><td className="whitespace-nowrap px-4 py-3 font-medium text-slate-800">{humanDate(d)}</td><td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-500">{humanTime(d)}</td>
                      {section==='flowmeter'?<><td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-800">{fmt(r.flow_rate_m3h_avg,3)}</td><td className="px-4 py-3 text-right tabular-nums text-slate-700">{fmt(r.initial_forward_totalizer_kl,3)}</td><td className="px-4 py-3 text-right tabular-nums text-slate-700">{fmt(r.final_forward_totalizer_kl,3)}</td><td className="px-4 py-3 text-right font-bold tabular-nums text-emerald-600">{fmt(r.forward_consumption,3)}</td></>:section==='dwlr'?<><td className="px-4 py-3 text-right tabular-nums text-slate-700">{level!=null?Number(level).toFixed(2):'—'}</td><td className="px-4 py-3 text-right tabular-nums text-slate-700">{temp!=null?Number(temp).toFixed(1):'—'}</td></>:<td className="max-w-md truncate px-4 py-3 font-mono text-xs text-slate-600">{JSON.stringify(r.values||{})}</td>}
                      {admin&&<td className="px-4 py-3 text-right whitespace-nowrap"><Button size="sm" variant="outline" className="mr-1 h-8 w-8 p-0" onClick={()=>openEdit(r)} data-testid={`edit-reading-${r._id}`}><Pencil className="h-3.5 w-3.5"/></Button><Button size="sm" variant="outline" className="h-8 w-8 p-0 text-red-600 hover:bg-red-50" onClick={()=>deleteReading(r)} data-testid={`delete-reading-${r._id}`}><Trash2 className="h-3.5 w-3.5"/></Button></td>}
                    </tr>})}
                  </tbody>
                </table></div>}
              </CardContent>
              {searchableRows.length>0&&<div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-4"><span>Showing {Math.min((safePage-1)*rowsPerPage+1,searchableRows.length)} to {Math.min(safePage*rowsPerPage,searchableRows.length)} of {searchableRows.length} records</span><label className="flex items-center gap-2">Rows per page<select className="h-8 rounded-lg border border-slate-200 bg-white px-2" value={rowsPerPage} onChange={(e)=>setRowsPerPage(Number(e.target.value))}><option value="8">8</option><option value="10">10</option><option value="20">20</option><option value="50">50</option></select></label></div>
                <div className="flex items-center gap-1"><Button size="sm" variant="outline" className="h-8 w-8 p-0" disabled={safePage===1} onClick={()=>setCurrentPage(1)}>«</Button><Button size="sm" variant="outline" className="h-8 w-8 p-0" disabled={safePage===1} onClick={()=>setCurrentPage(safePage-1)}><ChevronLeft className="h-4 w-4"/></Button>{Array.from({length:Math.min(5,pageCount)},(_,idx)=>{const p=Math.min(Math.max(1,safePage-2)+idx,pageCount);return <Button key={p} size="sm" variant={p===safePage?'default':'outline'} className="h-8 min-w-8 p-0" onClick={()=>setCurrentPage(p)}>{p}</Button>})}<Button size="sm" variant="outline" className="h-8 w-8 p-0" disabled={safePage===pageCount} onClick={()=>setCurrentPage(safePage+1)}><ChevronRight className="h-4 w-4"/></Button><Button size="sm" variant="outline" className="h-8 w-8 p-0" disabled={safePage===pageCount} onClick={()=>setCurrentPage(pageCount)}>»</Button></div>
              </div>}
            </Card>
          </TabsContent>
        </Tabs>
      </div>
      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit reading</DialogTitle>
            <DialogDescription>
              {section === 'flowmeter' ? 'Totaliser values must remain monotonically non-decreasing across timestamps. The server rejects mismatches.' : 'Edit the JSON values dictionary directly.'}
            </DialogDescription>
          </DialogHeader>

          {section === 'flowmeter' ? (
            <div className="space-y-3">
              <div><Label>Timestamp (ISO 8601)</Label><Input value={editForm.timestamp || ''} onChange={(e) => setEditForm({ ...editForm, timestamp: e.target.value })} data-testid="edit-reading-timestamp" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Flow rate (m³/h)</Label><Input type="number" step="0.001" value={editForm.flow_rate_m3h || ''} onChange={(e) => setEditForm({ ...editForm, flow_rate_m3h: e.target.value })} data-testid="edit-flow-m3h" /></div>
                <div><Label>Temperature (°C)</Label><Input type="number" step="0.1" value={editForm.temperature || ''} onChange={(e) => setEditForm({ ...editForm, temperature: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Forward Totaliser (KL)</Label><Input type="number" step="0.01" value={editForm.forward_totalizer || ''} onChange={(e) => setEditForm({ ...editForm, forward_totalizer: e.target.value })} data-testid="edit-forward-totaliser" /></div>
                <div><Label>Reverse Totaliser (KL)</Label><Input type="number" step="0.01" value={editForm.reverse_totalizer || ''} onChange={(e) => setEditForm({ ...editForm, reverse_totalizer: e.target.value })} data-testid="edit-reverse-totaliser" /></div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div><Label>Timestamp (ISO 8601)</Label><Input value={editForm.timestamp || ''} onChange={(e) => setEditForm({ ...editForm, timestamp: e.target.value })} data-testid="edit-reading-timestamp" /></div>
              <div><Label>Values (JSON)</Label><textarea className="w-full border rounded p-2 font-mono text-sm" rows="6" value={editForm.values || '{}'} onChange={(e) => setEditForm({ ...editForm, values: e.target.value })} data-testid="edit-reading-values" /></div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={saveEdit} disabled={saving} data-testid="edit-reading-submit">
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Reports;
