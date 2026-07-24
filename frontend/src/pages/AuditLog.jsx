import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { History, User, Calendar, Hash, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import api, { formatApiError } from '../lib/api';
import { isAdmin } from '../mockData';
import { toast } from 'sonner';
import { cleanLabel } from '../utils/labels';

// Human-readable label for every instrument type the registry can emit.
// The dropdown is populated dynamically from the actual registry, but this
// map decorates known types with a friendly name. Anything unrecognised
// falls back to a Title-Cased version of the raw type.
const TYPE_LABELS = {
  flowmeter: 'Flowmeter',
  dwlr: 'DWLR (Piezometer)',
  ph: 'pH',
  tds: 'TDS',
  conductivity: 'Conductivity',
  wq_stp: 'STP water quality',
  do_meter: 'DO analyzer',
  chlorine_analyzer: 'Chlorine analyzer',
  ocems: 'OCEMS',
};

const prettyType = (t) => TYPE_LABELS[t] || (t ? t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '—');

const formatValuesSnapshot = (snap, source) => {
  if (!snap) return '—';
  if (source === 'flowmeter') {
    const parts = [];
    if (snap.flow_rate_lph != null) parts.push(`Flow ${Number(snap.flow_rate_lph).toFixed(2)} L/h`);
    if (snap.forward_totalizer != null) parts.push(`Fwd ${Number(snap.forward_totalizer).toFixed(2)} L`);
    if (snap.reverse_totalizer != null && snap.reverse_totalizer > 0) parts.push(`Rev ${Number(snap.reverse_totalizer).toFixed(2)} L`);
    if (snap.temperature != null) parts.push(`${Number(snap.temperature).toFixed(1)}°C`);
    return parts.join(' · ') || '—';
  }
  // generic instrument
  if (snap.values && Object.keys(snap.values).length > 0) {
    return Object.entries(snap.values).slice(0, 4).map(([k, v]) => `${k}=${v}`).join(' · ');
  }
  return '—';
};

const AuditLog = () => {
  const admin = isAdmin();
  const [summary, setSummary] = useState(null);
  const [edits, setEdits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [devices, setDevices] = useState([]);
  const [filters, setFilters] = useState({ instrument_type: '', hardware_id: '', limit: 100 });

  // Load the instrument registry once — feeds both the "Instrument source" and
  // "Device" dropdowns with the *actual* instruments/parameters the admin has
  // provisioned (so we never guess at types or expose stale/free-text IDs).
  useEffect(() => {
    if (!admin) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/api/instrument-registry');
        if (cancelled) return;
        setDevices(data?.instruments || []);
      } catch (e) {
        if (process.env.NODE_ENV === 'development') console.warn('[audit-devices]', e?.message);
      }
    })();
    return () => { cancelled = true; };
  }, [admin]);

  // Distinct instrument types across the registry — drives the source dropdown.
  const sourceOptions = useMemo(() => {
    const types = Array.from(new Set(devices.map((d) => d.instrument_type).filter(Boolean))).sort();
    return [{ value: '', label: 'All sources' }, ...types.map((t) => ({ value: t, label: prettyType(t) }))];
  }, [devices]);

  // Device options filtered by the currently selected source.
  const deviceOptions = useMemo(() => {
    const filtered = filters.instrument_type
      ? devices.filter((d) => d.instrument_type === filters.instrument_type)
      : devices;
    return filtered
      .map((d) => ({
        hardware_id: d.hardware_id,
        label: cleanLabel(d.label || d.hardware_id),
        instrument_type: d.instrument_type,
        location_name: d.location_name,
      }))
      .sort((a, b) => (a.label || '').localeCompare(b.label || ''));
  }, [devices, filters.instrument_type]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.instrument_type) params.append('instrument_type', filters.instrument_type);
      if (filters.hardware_id) params.append('hardware_id', filters.hardware_id);
      params.append('limit', String(filters.limit));
      const [s, e] = await Promise.all([
        api.get('/api/admin/audit-log/summary'),
        api.get(`/api/admin/audit-log/reading-edits?${params.toString()}`),
      ]);
      setSummary(s.data);
      setEdits(e.data.edits || []);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    if (admin) fetchAll();
    else setLoading(false);
  }, [admin, fetchAll]);

  if (!admin) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-16 text-center space-y-3">
            <ShieldAlert className="h-12 w-12 mx-auto text-amber-500" />
            <h2 className="text-xl font-semibold">Admin access required</h2>
            <p className="text-gray-600">The audit log is restricted to administrators.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" data-testid="audit-log-page">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Audit Log</h1>
          <p className="text-gray-600 mt-1">Every reading edit/delete — who, what, and when.</p>
        </div>
        <Button onClick={fetchAll} variant="outline" data-testid="audit-refresh-btn">
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total edits</p>
                <p className="text-3xl font-bold text-gray-900" data-testid="audit-total-count">{summary?.total_edits ?? 0}</p>
              </div>
              <History className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-600 mb-2">By source</p>
            <div className="flex gap-2 flex-wrap">
              <Badge className="bg-blue-500">Flowmeter: {summary?.by_instrument?.flowmeter ?? 0}</Badge>
              <Badge className="bg-purple-500">Other instruments: {summary?.by_instrument?.instrument_readings ?? 0}</Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-600 mb-2">Top editors</p>
            {(summary?.top_editors || []).length === 0 ? (
              <p className="text-xs text-gray-400">No edits yet</p>
            ) : (
              <div className="space-y-1">
                {(summary?.top_editors || []).slice(0, 3).map((e) => (
                  <div key={e.user_id} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700 truncate">{e.full_name || e.email}</span>
                    <Badge variant="outline">{e.count}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader><CardTitle>Filters</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <Label>Instrument source</Label>
              <select
                className="w-full border rounded px-3 py-2"
                value={filters.instrument_type}
                onChange={(e) => setFilters({ ...filters, instrument_type: e.target.value, hardware_id: '' })}
                data-testid="audit-filter-source"
              >
                {sourceOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <Label>Device</Label>
              <select
                className="w-full border rounded px-3 py-2"
                value={filters.hardware_id}
                onChange={(e) => setFilters({ ...filters, hardware_id: e.target.value })}
                data-testid="audit-filter-device"
              >
                <option value="">All devices</option>
                {deviceOptions.map((d) => (
                  <option key={d.hardware_id} value={d.hardware_id}>
                    {d.label}{d.location_name ? ` · ${d.location_name}` : ''} ({d.hardware_id})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Limit</Label>
              <select
                className="w-full border rounded px-3 py-2"
                value={filters.limit}
                onChange={(e) => setFilters({ ...filters, limit: parseInt(e.target.value, 10) })}
                data-testid="audit-filter-limit"
              >
                {[25, 50, 100, 200, 500].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="flex items-end">
              <Button onClick={fetchAll} className="w-full" data-testid="audit-apply-btn"><RefreshCw className="h-4 w-4 mr-2" /> Apply</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Edits table */}
      <Card>
        <CardHeader>
          <CardTitle>Edit history ({edits.length})</CardTitle>
          <CardDescription>Sorted by edit time, most recent first.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center py-8 text-gray-500"><Loader2 className="h-5 w-5 animate-spin inline mr-2" />Loading…</p>
          ) : edits.length === 0 ? (
            <div className="text-center py-12">
              <History className="h-10 w-10 mx-auto mb-3 text-gray-400" />
              <p className="text-gray-600">No reading edits recorded yet.</p>
              <p className="text-xs text-gray-500 mt-1">Every time an admin edits a reading on the Reports page, it shows up here.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="audit-table">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2"><Calendar className="h-3 w-3 inline mr-1" />Edited at</th>
                    <th className="text-left p-2"><User className="h-3 w-3 inline mr-1" />Edited by</th>
                    <th className="text-left p-2">Source</th>
                    <th className="text-left p-2"><Hash className="h-3 w-3 inline mr-1" />Device</th>
                    <th className="text-left p-2">Reading timestamp</th>
                    <th className="text-left p-2">Values after edit</th>
                  </tr>
                </thead>
                <tbody>
                  {edits.map((e) => {
                    const dev = devices.find((d) => d.hardware_id === e.hardware_id);
                    const devLabel = dev ? cleanLabel(dev.label || dev.hardware_id) : (e.hardware_id || '—');
                    return (
                    <tr key={e.reading_id} className="border-b hover:bg-gray-50" data-testid={`audit-row-${e.reading_id}`}>
                      <td className="p-2 whitespace-nowrap">{e.edited_at ? new Date(e.edited_at).toLocaleString() : '—'}</td>
                      <td className="p-2">
                        <div className="text-sm font-medium">{e.editor?.full_name || '—'}</div>
                        <div className="text-xs text-gray-500">{e.editor?.email}</div>
                      </td>
                      <td className="p-2"><Badge className={e.source === 'flowmeter' ? 'bg-blue-500' : 'bg-purple-500'}>{prettyType(dev?.instrument_type || e.source)}</Badge></td>
                      <td className="p-2">
                        <div className="text-sm font-medium">{devLabel}</div>
                        {e.hardware_id && dev && <div className="text-[10px] font-mono text-gray-500">{e.hardware_id}</div>}
                      </td>
                      <td className="p-2 text-xs text-gray-600 whitespace-nowrap">{e.timestamp ? new Date(e.timestamp).toLocaleString() : '—'}</td>
                      <td className="p-2 text-xs text-gray-700">{formatValuesSnapshot(e.values_snapshot, e.source)}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AuditLog;
