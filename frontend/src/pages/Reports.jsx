import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Popover, PopoverTrigger, PopoverContent } from '../components/ui/popover';
import { Calendar } from '../components/ui/calendar';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../components/ui/dialog';
import { Download, FileSpreadsheet, FileText, Upload, Loader2, Filter, CalendarIcon, Pencil, Trash2, AlertCircle } from 'lucide-react';
import api, { formatApiError, apiUrl } from '../lib/api';
import { isAdmin, getToken, getCurrentUser } from '../mockData';
import { toast } from 'sonner';
import ReportsCharts from '../components/ReportsCharts';
import { cleanLabel } from '../utils/labels';

const formatDate = (d) => (d ? d.toISOString().split('T')[0] : '');
const fmt = (n, d = 2) => (n == null || isNaN(n) ? '—' : Number(n).toFixed(d));

// Parse the many timestamp shapes we see from MQTT payloads / vendor uploads.
// `received_at` (server ingestion time, always UTC ISO with a `Z`) is
// preferred over the device's own `timestamp` string because some device
// firmwares emit naive datetimes without a timezone, which the browser then
// mis-interprets and displays 5-6 hours off from what the Live MQTT Traffic
// panel shows. Preferring `received_at` keeps the Reports column consistent
// with the traffic view.
const parseReadingDate = (r) => {
  const cands = [r?.received_at, r?.timestamp, r?.values?.timestamp, r?.values?.DATE_TIME, r?.values?.datetime];
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
      // matches how the backend actually stored it (raw MQTT `TIME` frames
      // are UTC on the ingestion side).
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
      // Pull up to 20k rows (~200 days of 15-min DWLR data). Sort is
      // handled server-side by `received_at DESC` so newest ingestion
      // always wins, even if a device's own clock has drifted.
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
  const fwdTotaliser = (r) => {
    if (r == null) return null;
    if (typeof r.forward_totalizer === 'number') return r.forward_totalizer;
    const v = r.values || {};
    const t1 = pickNum(v, ['TOT1', 'tot1']);
    const t2 = pickNum(v, ['TOT2', 'tot2']);
    if (t1 == null || t2 == null) return pickNum(v, ['FORWARD_TOT', 'FWD_TOT']);
    return t2 * 65535 + t1;
  };
  const revTotaliser = (r) => {
    if (r == null) return null;
    if (typeof r.reverse_totalizer === 'number') return r.reverse_totalizer;
    const v = r.values || {};
    const t1 = pickNum(v, ['RTOT1', 'rtot1']);
    const t2 = pickNum(v, ['RTOT2', 'rtot2']);
    if (t1 == null || t2 == null) return pickNum(v, ['REVERSE_TOT', 'REV_TOT']);
    return t2 * 65535 + t1;
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
    const withDate = readings
      .map((r) => ({ r, d: parseReadingDate(r) }))
      .filter(({ d }) => d && (!s || d >= s) && (!e || d <= e))
      .sort((a, b) => a.d.getTime() - b.d.getTime()); // ascending for correct initial/final assignment

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
      let prevFinalFwd = null;
      let prevFinalRev = null;
      for (let idx = 0; idx < ordered.length; idx++) {
        const [key, arr] = ordered[idx];
        const first = arr[0];
        const last = arr[arr.length - 1];
        const flows = arr.map(({ r }) => pickNum(r, ['flow_rate_lph']) ?? pickNum(r.values || {}, ['FLOW'])).filter((n) => n != null);
        const avgFlow = flows.length ? flows.reduce((a, b) => a + b, 0) / flows.length : null;
        const initFwd = fwdTotaliser(first.r);
        const finalFwd = fwdTotaliser(last.r);
        const initRev = revTotaliser(first.r);
        const finalRev = revTotaliser(last.r);
        // Preferred: last-of-current − last-of-previous (spans the *whole*
        // bucket even if there's only one reading in it). Fallback: within-
        // bucket delta on the very first bucket (nothing to compare to).
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
          timestamp: last.r.timestamp || last.r.received_at,
          received_at: last.r.received_at,
          _bucket_start: first.d.toISOString(),
          _bucket_end: last.d.toISOString(),
          flow_rate_lph_avg: avgFlow,
          flow_rate_lph_last: pickNum(last.r, ['flow_rate_lph']) ?? pickNum(last.r.values || {}, ['FLOW']),
          initial_forward_totalizer: prevFinalFwd != null ? prevFinalFwd : initFwd,
          final_forward_totalizer: finalFwd,
          forward_consumption: forwardConsumption,
          initial_reverse_totalizer: prevFinalRev != null ? prevFinalRev : initRev,
          final_reverse_totalizer: finalRev,
          reverse_consumption: reverseConsumption,
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
      cols = ['S.No.', 'Site Name', 'Location', 'Device', 'Date', 'Time', 'Flow rate (L/h)', 'Initial Totaliser (KL)', 'Final Totaliser (KL)', 'Consumption (KL)'];
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
          r.flow_rate_lph_avg != null ? Number(r.flow_rate_lph_avg).toFixed(2) : '—',
          r.initial_forward_totalizer != null ? Number(r.initial_forward_totalizer).toFixed(2) : '—',
          r.final_forward_totalizer != null ? Number(r.final_forward_totalizer).toFixed(2) : '—',
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
        timestamp: row.timestamp || row.received_at || '',
        flow_rate_lph: row.flow_rate_lph != null ? String(row.flow_rate_lph) : '',
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
        ['flow_rate_lph', 'forward_totalizer', 'reverse_totalizer', 'temperature'].forEach((k) => {
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

  // ---- Table row rendering removed — inlined into the JSX below to keep the
  // professional-CSV column layout (S.No. / Site / Location / …) in sync.

  return (
    <div className="p-6 space-y-6" data-testid="reports-page">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Reports &amp; Historical Data</h1>
          <p className="text-gray-600 mt-1">View, filter, edit, export and import instrument readings.</p>
        </div>
        <div className="flex gap-2">
          {/* Downloads — both admin and clients can download their own data (backend scopes by owner) */}
          <Button variant="outline" onClick={() => triggerDownload('csv')} data-testid="download-csv-btn"><Download className="h-4 w-4 mr-2" /> CSV</Button>
          <Button style={{ backgroundColor: '#4a9fd8' }} onClick={() => triggerDownload('pdf')} data-testid="download-pdf-btn"><FileText className="h-4 w-4 mr-2" /> PDF</Button>
          {/* Excel/CSV import — admin only (data ingestion is a privileged action) */}
          {admin && (section === 'flowmeter' || section === 'dwlr') && (
            <>
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleUpload} className="hidden" data-testid="upload-excel-input" />
              <Button variant="outline" onClick={downloadTemplate} data-testid="download-template-btn" title="Download the empty CSV template for manual data entry">
                <FileSpreadsheet className="h-4 w-4 mr-2" /> Template
              </Button>
              <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading} data-testid="upload-excel-btn">
                {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}Import CSV/Excel
              </Button>
            </>
          )}
        </div>
      </div>

      <Tabs value={section} onValueChange={(v) => { setSection(v); setHardwareId(''); }}>
        <TabsList>
          <TabsTrigger value="flowmeter" data-testid="reports-tab-flowmeter">Flowmeter</TabsTrigger>
          <TabsTrigger value="dwlr" data-testid="reports-tab-dwlr">DWLR</TabsTrigger>
          <TabsTrigger value="ph" data-testid="reports-tab-ph">pH</TabsTrigger>
          <TabsTrigger value="tds" data-testid="reports-tab-tds">TDS</TabsTrigger>
          <TabsTrigger value="conductivity" data-testid="reports-tab-conductivity">Conductivity</TabsTrigger>
          <TabsTrigger value="charts" data-testid="reports-tab-charts">Graphs &amp; Combined</TabsTrigger>
        </TabsList>

        <TabsContent value="charts" className="mt-4">
          <ReportsCharts />
        </TabsContent>

        <TabsContent value={section === 'charts' ? '__hide__' : section} className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Filters</CardTitle>
              <CardDescription>
                Select a device, pick a date range and frequency, then click <b>Filter</b> to populate the table below.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                <div>
                  <Label>Device</Label>
                  <select
                    className="w-full border rounded h-10 px-2 bg-white"
                    value={hardwareId}
                    onChange={(e) => {
                      const hw = e.target.value;
                      setHardwareId(hw);
                      setSelectedDevice(devices.find((d) => d.hardware_id === hw) || null);
                      setReadings([]);
                    }}
                    data-testid="filter-device-select"
                  >
                    <option value="">— Select {section.toUpperCase()} device —</option>
                    {devices.map((d) => (
                      <option key={d.hardware_id} value={d.hardware_id}>
                        {cleanLabel(d.label || d.hardware_id)}{d.location_name ? ` · ${d.location_name}` : ''} ({d.hardware_id})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Start Date</Label>
                  <Popover>
                    <PopoverTrigger asChild><Button variant="outline" className="w-full justify-start font-normal" data-testid="filter-start-date"><CalendarIcon className="h-4 w-4 mr-2" />{startDate ? startDate.toLocaleDateString() : <span className="text-gray-400">Pick date</span>}</Button></PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={startDate} onSelect={setStartDate} initialFocus /></PopoverContent>
                  </Popover>
                </div>
                <div>
                  <Label>End Date</Label>
                  <Popover>
                    <PopoverTrigger asChild><Button variant="outline" className="w-full justify-start font-normal" data-testid="filter-end-date"><CalendarIcon className="h-4 w-4 mr-2" />{endDate ? endDate.toLocaleDateString() : <span className="text-gray-400">Pick date</span>}</Button></PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={endDate} onSelect={setEndDate} initialFocus /></PopoverContent>
                  </Popover>
                </div>
                <div>
                  <Label>Frequency</Label>
                  <select
                    className="w-full border rounded h-10 px-2 bg-white"
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value)}
                    data-testid="filter-frequency-select"
                  >
                    <option value="raw">All raw readings</option>
                    <option value="daily">Daily (1 row / day)</option>
                    <option value="weekly">Weekly (1 row / week)</option>
                    <option value="monthly">Monthly (1 row / month)</option>
                    <option value="quarterly">Quarterly (1 row / quarter)</option>
                    <option value="yearly">Yearly (1 row / year)</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <Button
                    onClick={() => {
                      // Enforce mandatory date bounds for period reports so the
                      // aggregate is unambiguous.
                      const needsBounds = ['weekly', 'monthly', 'quarterly', 'yearly'].includes(frequency);
                      if (needsBounds && (!startDate || !endDate)) {
                        toast.error(`${frequency.charAt(0).toUpperCase() + frequency.slice(1)} reports require both a start date and an end date`);
                        return;
                      }
                      fetchReadings();
                    }}
                    className="w-full"
                    disabled={!hardwareId || loading}
                    data-testid="apply-filters-btn"
                  >
                    {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Filter className="h-4 w-4 mr-2" />}
                    Filter
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5" /> {section.toUpperCase()} data ({filteredReadings.length})</CardTitle>
              {section === 'flowmeter' && (
                <CardDescription className="flex items-center gap-2 text-amber-700"><AlertCircle className="h-3 w-3" />Totaliser values must be monotonically non-decreasing — server will reject inconsistent edits.</CardDescription>
              )}
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-center py-8 text-gray-500">Loading…</p>
              ) : !hardwareId ? (
                <p className="text-center py-8 text-gray-500">Select a device above and click <b>Filter</b> to load readings.</p>
              ) : filteredReadings.length === 0 ? (
                <p className="text-center py-8 text-gray-500">No readings match the selected filters.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="readings-table">
                    <thead>
                      <tr className="border-b bg-gray-50">
                        <th className="text-left p-2">S.No.</th>
                        <th className="text-left p-2">Site Name</th>
                        <th className="text-left p-2">Location</th>
                        <th className="text-left p-2">Device</th>
                        <th className="text-left p-2">Date</th>
                        <th className="text-left p-2">Time</th>
                        {section === 'flowmeter' ? (
                          <>
                            <th className="text-right p-2">Flow rate (L/h)</th>
                            <th className="text-right p-2">Initial Totaliser (KL)</th>
                            <th className="text-right p-2">Final Totaliser (KL)</th>
                            <th className="text-right p-2">Consumption (KL)</th>
                          </>
                        ) : section === 'dwlr' ? (
                          <>
                            <th className="text-right p-2">Water Level (mWC)</th>
                            <th className="text-right p-2">Temperature (°C)</th>
                          </>
                        ) : (
                          <th className="text-left p-2">Values</th>
                        )}
                        {admin && <th className="text-right p-2">Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredReadings.slice(0, 500).map((r, i) => {
                        const d = parseReadingDate(r);
                        const siteName = cleanLabel(selectedDevice?.label || selectedDevice?.hardware_id || '—');
                        const locationName = selectedDevice?.location_name || selectedDevice?.owner_location_name || '—';
                        const deviceLbl = cleanLabel(selectedDevice?.label || selectedDevice?.hardware_id || hardwareId || '—');
                        const level = section === 'dwlr' ? pickNum(r.values, ['LEVEL', 'LVL', 'level', 'WATER_LEVEL', 'RAW']) : null;
                        const temp = section === 'dwlr'
                          ? (selectedDevice?.manual_water_temp_c ?? pickNum(r.values, ['WTEMP'], { skipZero: true }) ?? pickNum(r.values, ['ATEMP', 'TEMPER', 'TEMP', 'temperature']))
                          : null;
                        return (
                          <tr key={r._id || i} className="border-b hover:bg-gray-50 text-sm">
                            <td className="p-2 tabular-nums">{i + 1}</td>
                            <td className="p-2">{siteName}</td>
                            <td className="p-2">{locationName}</td>
                            <td className="p-2 font-mono text-xs">{deviceLbl}</td>
                            <td className="p-2 whitespace-nowrap">{humanDate(d)}</td>
                            <td className="p-2 whitespace-nowrap font-mono text-xs">{humanTime(d)}</td>
                            {section === 'flowmeter' ? (
                              <>
                                <td className="p-2 text-right">{r.flow_rate_lph_avg != null ? Number(r.flow_rate_lph_avg).toFixed(2) : '—'}</td>
                                <td className="p-2 text-right">{r.initial_forward_totalizer != null ? Number(r.initial_forward_totalizer).toFixed(2) : '—'}</td>
                                <td className="p-2 text-right">{r.final_forward_totalizer != null ? Number(r.final_forward_totalizer).toFixed(2) : '—'}</td>
                                <td className="p-2 text-right font-semibold text-emerald-700">{r.forward_consumption != null ? Number(r.forward_consumption).toFixed(2) : '—'}</td>
                              </>
                            ) : section === 'dwlr' ? (
                              <>
                                <td className="p-2 text-right">{level != null ? Number(level).toFixed(2) : '—'}</td>
                                <td className="p-2 text-right">{temp != null ? Number(temp).toFixed(1) : '—'}</td>
                              </>
                            ) : (
                              <td className="p-2 font-mono text-xs truncate max-w-md">{JSON.stringify(r.values || {})}</td>
                            )}
                            {admin && (
                              <td className="p-2 text-right whitespace-nowrap">
                                <Button size="sm" variant="outline" className="mr-1" onClick={() => openEdit(r)} data-testid={`edit-reading-${r._id}`}><Pencil className="h-3 w-3" /></Button>
                                <Button size="sm" variant="outline" className="text-red-600" onClick={() => deleteReading(r)} data-testid={`delete-reading-${r._id}`}><Trash2 className="h-3 w-3" /></Button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

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
                <div><Label>Flow rate (L/h)</Label><Input type="number" step="0.01" value={editForm.flow_rate_lph || ''} onChange={(e) => setEditForm({ ...editForm, flow_rate_lph: e.target.value })} data-testid="edit-flow-lph" /></div>
                <div><Label>Temperature (°C)</Label><Input type="number" step="0.1" value={editForm.temperature || ''} onChange={(e) => setEditForm({ ...editForm, temperature: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Forward Totaliser (L)</Label><Input type="number" step="0.01" value={editForm.forward_totalizer || ''} onChange={(e) => setEditForm({ ...editForm, forward_totalizer: e.target.value })} data-testid="edit-forward-totaliser" /></div>
                <div><Label>Reverse Totaliser (L)</Label><Input type="number" step="0.01" value={editForm.reverse_totalizer || ''} onChange={(e) => setEditForm({ ...editForm, reverse_totalizer: e.target.value })} data-testid="edit-reverse-totaliser" /></div>
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
