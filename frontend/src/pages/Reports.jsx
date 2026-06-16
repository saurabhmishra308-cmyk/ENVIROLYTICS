import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Popover, PopoverTrigger, PopoverContent } from '../components/ui/popover';
import { Calendar } from '../components/ui/calendar';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../components/ui/dialog';
import { Download, FileSpreadsheet, FileText, Upload, Loader2, RefreshCw, CalendarIcon, Pencil, Trash2, AlertCircle } from 'lucide-react';
import api, { formatApiError } from '../lib/api';
import { isAdmin, getToken } from '../mockData';
import { toast } from 'sonner';
import ReportsCharts from '../components/ReportsCharts';

const formatDate = (d) => (d ? d.toISOString().split('T')[0] : '');
const fmt = (n, d = 2) => (n == null || isNaN(n) ? '—' : Number(n).toFixed(d));

const Reports = () => {
  const admin = isAdmin();
  const [section, setSection] = useState('flowmeter'); // flowmeter | dwlr | ph | tds | conductivity

  const [hardwareId, setHardwareId] = useState('');
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);

  const [readings, setReadings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);

  const fetchReadings = useCallback(async () => {
    setLoading(true);
    try {
      if (section === 'flowmeter') {
        if (!hardwareId) {
          const { data } = await api.get('/api/flowmeter/latest');
          setReadings(data.flowmeters || []);
        } else {
          const { data } = await api.get(`/api/flowmeter/history/${hardwareId}?limit=200`);
          setReadings(data.readings || []);
        }
      } else {
        if (!hardwareId) {
          const { data } = await api.get(`/api/instruments/${section}/latest`);
          setReadings(data.readings || []);
        } else {
          const { data } = await api.get(`/api/instruments/${section}/${hardwareId}/history?limit=200`);
          setReadings(data.readings || []);
        }
      }
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  }, [section, hardwareId]);

  useEffect(() => { fetchReadings(); }, [fetchReadings]);

  const triggerDownload = async (format) => {
    if (!admin) { toast.error('Admin only'); return; }
    try {
      const params = new URLSearchParams({ format });
      if (hardwareId) params.append('hardware_id', hardwareId);
      if (startDate) params.append('start_date', formatDate(startDate));
      if (endDate) params.append('end_date', formatDate(endDate));
      const url = `${process.env.REACT_APP_BACKEND_URL}/api/admin/data/export?${params.toString()}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = format === 'csv' ? 'data.csv' : 'report.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.success(`${format.toUpperCase()} downloaded`);
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
      const { data } = await api.post('/api/admin/data/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      if (data.success) toast.success(`Imported ${data.inserted_count} rows`);
      else toast.error(`Validation errors: ${data.error_count}`);
      fetchReadings();
    } catch (e2) {
      toast.error(formatApiError(e2?.response?.data?.detail));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
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

  // Column definitions per section
  const renderRow = (r, i) => {
    if (section === 'flowmeter') {
      return (
        <tr key={r._id || i} className="border-b hover:bg-gray-50 text-sm">
          <td className="p-2">{new Date(r.timestamp || r.received_at || Date.now()).toLocaleString()}</td>
          <td className="p-2 font-mono text-xs">{r.hardware_id}</td>
          <td className="p-2 text-right">{fmt(r.flow_rate_lph)}</td>
          <td className="p-2 text-right">{fmt(r.flow_rate_lpm)}</td>
          <td className="p-2 text-right font-semibold">{fmt(r.forward_totalizer)}</td>
          <td className="p-2 text-right">{fmt(r.reverse_totalizer)}</td>
          <td className="p-2 text-right">{fmt(r.temperature, 1)}</td>
          {admin && (
            <td className="p-2 text-right">
              <Button size="sm" variant="outline" className="mr-1" onClick={() => openEdit(r)} data-testid={`edit-reading-${r._id}`}><Pencil className="h-3 w-3" /></Button>
              <Button size="sm" variant="outline" className="text-red-600" onClick={() => deleteReading(r)} data-testid={`delete-reading-${r._id}`}><Trash2 className="h-3 w-3" /></Button>
            </td>
          )}
        </tr>
      );
    }
    // generic instrument
    return (
      <tr key={r._id || i} className="border-b hover:bg-gray-50 text-sm">
        <td className="p-2">{new Date(r.timestamp || r.received_at || Date.now()).toLocaleString()}</td>
        <td className="p-2 font-mono text-xs">{r.hardware_id}</td>
        <td className="p-2 font-mono text-xs">{JSON.stringify(r.values || {})}</td>
        {admin && (
          <td className="p-2 text-right">
            <Button size="sm" variant="outline" className="mr-1" onClick={() => openEdit(r)} data-testid={`edit-reading-${r._id}`}><Pencil className="h-3 w-3" /></Button>
            <Button size="sm" variant="outline" className="text-red-600" onClick={() => deleteReading(r)} data-testid={`delete-reading-${r._id}`}><Trash2 className="h-3 w-3" /></Button>
          </td>
        )}
      </tr>
    );
  };

  return (
    <div className="p-6 space-y-6" data-testid="reports-page">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Reports &amp; Historical Data</h1>
          <p className="text-gray-600 mt-1">View, filter, edit, export and import instrument readings.</p>
        </div>
        <div className="flex gap-2">
          {admin && (
            <>
              <Button variant="outline" onClick={() => triggerDownload('csv')} data-testid="download-csv-btn"><Download className="h-4 w-4 mr-2" /> CSV</Button>
              <Button style={{ backgroundColor: '#4a9fd8' }} onClick={() => triggerDownload('pdf')} data-testid="download-pdf-btn"><FileText className="h-4 w-4 mr-2" /> PDF</Button>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleUpload} className="hidden" data-testid="upload-excel-input" />
              <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading} data-testid="upload-excel-btn">
                {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}Upload Excel
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
          <TabsTrigger value="charts" data-testid="reports-tab-charts">Graphs & Combined</TabsTrigger>
        </TabsList>

        <TabsContent value="charts" className="mt-4">
          <ReportsCharts />
        </TabsContent>

        <TabsContent value={section === 'charts' ? '__hide__' : section} className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Filters</CardTitle>
              <CardDescription>
                Enter a hardware ID to fetch history (200 most recent). Admins can edit individual readings.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div><Label>Hardware ID</Label><Input value={hardwareId} onChange={(e) => setHardwareId(e.target.value)} placeholder="e.g. FM_GW_001" data-testid="filter-hardware-id" /></div>
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
                <div className="flex items-end"><Button onClick={fetchReadings} className="w-full" data-testid="apply-filters-btn"><RefreshCw className="h-4 w-4 mr-2" /> Refresh</Button></div>
              </div>
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5" /> {section.toUpperCase()} data ({readings.length})</CardTitle>
              {section === 'flowmeter' && (
                <CardDescription className="flex items-center gap-2 text-amber-700"><AlertCircle className="h-3 w-3" />Totaliser values must be monotonically non-decreasing — server will reject inconsistent edits.</CardDescription>
              )}
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-center py-8 text-gray-500">Loading…</p>
              ) : readings.length === 0 ? (
                <p className="text-center py-8 text-gray-500">No readings. Enter a Hardware ID to fetch history.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="readings-table">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-2">Time</th>
                        <th className="text-left p-2">Hardware ID</th>
                        {section === 'flowmeter' ? (
                          <>
                            <th className="text-right p-2">Flow (L/h)</th>
                            <th className="text-right p-2">Flow (L/min)</th>
                            <th className="text-right p-2">Forward Tot.</th>
                            <th className="text-right p-2">Reverse Tot.</th>
                            <th className="text-right p-2">Temp (°C)</th>
                          </>
                        ) : (
                          <th className="text-left p-2">Values</th>
                        )}
                        {admin && <th className="text-right p-2">Actions</th>}
                      </tr>
                    </thead>
                    <tbody>{readings.slice(0, 200).map(renderRow)}</tbody>
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
