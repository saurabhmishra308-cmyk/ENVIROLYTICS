import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { History, User, Calendar, Hash, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import api, { formatApiError } from '../lib/api';
import { isAdmin } from '../mockData';
import { toast } from 'sonner';

const TYPE_OPTIONS = [
  { value: '', label: 'All sources' },
  { value: 'flowmeter', label: 'Flowmeter' },
  { value: 'dwlr', label: 'DWLR' },
  { value: 'ph', label: 'pH' },
  { value: 'tds', label: 'TDS' },
  { value: 'conductivity', label: 'Conductivity' },
];

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
  const [filters, setFilters] = useState({ instrument_type: '', hardware_id: '', limit: 100 });

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
                onChange={(e) => setFilters({ ...filters, instrument_type: e.target.value })}
                data-testid="audit-filter-source"
              >
                {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <Label>Hardware ID</Label>
              <Input value={filters.hardware_id} onChange={(e) => setFilters({ ...filters, hardware_id: e.target.value })} placeholder="e.g. FM_GW_001" data-testid="audit-filter-hardware" />
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
                    <th className="text-left p-2"><Hash className="h-3 w-3 inline mr-1" />Hardware ID</th>
                    <th className="text-left p-2">Reading timestamp</th>
                    <th className="text-left p-2">Values after edit</th>
                  </tr>
                </thead>
                <tbody>
                  {edits.map((e) => (
                    <tr key={e.reading_id} className="border-b hover:bg-gray-50" data-testid={`audit-row-${e.reading_id}`}>
                      <td className="p-2 whitespace-nowrap">{e.edited_at ? new Date(e.edited_at).toLocaleString() : '—'}</td>
                      <td className="p-2">
                        <div className="text-sm font-medium">{e.editor?.full_name || '—'}</div>
                        <div className="text-xs text-gray-500">{e.editor?.email}</div>
                      </td>
                      <td className="p-2"><Badge className={e.source === 'flowmeter' ? 'bg-blue-500' : 'bg-purple-500'}>{e.source}</Badge></td>
                      <td className="p-2 font-mono text-xs">{e.hardware_id || '—'}</td>
                      <td className="p-2 text-xs text-gray-600 whitespace-nowrap">{e.timestamp ? new Date(e.timestamp).toLocaleString() : '—'}</td>
                      <td className="p-2 text-xs text-gray-700">{formatValuesSnapshot(e.values_snapshot, e.source)}</td>
                    </tr>
                  ))}
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
