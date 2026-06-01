import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Popover, PopoverTrigger, PopoverContent } from '../components/ui/popover';
import { Calendar } from '../components/ui/calendar';
import { Download, FileSpreadsheet, FileText, Upload, Loader2, RefreshCw, CalendarIcon } from 'lucide-react';
import api, { formatApiError } from '../lib/api';
import { isAdmin, getToken } from '../mockData';
import { toast } from 'sonner';

const formatDate = (d) => (d ? d.toISOString().split('T')[0] : '');

const Reports = () => {
  const [readings, setReadings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hardwareId, setHardwareId] = useState('');
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const admin = isAdmin();

  const fetchReadings = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (hardwareId) params.hardware_id = hardwareId;
      if (startDate) params.start_date = formatDate(startDate);
      if (endDate) params.end_date = formatDate(endDate);
      // Use the public history endpoint for client view; admin can also see full data via export
      let url = '/api/flowmeter/latest';
      const { data } = await api.get(url);
      let rows = data.flowmeters || [];
      if (hardwareId) {
        const hist = await api.get(`/api/flowmeter/history/${hardwareId}?limit=200`);
        rows = hist.data.readings || [];
      }
      setReadings(rows);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  }, [hardwareId, startDate, endDate]);

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
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `Download failed: ${res.status}`);
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = format === 'csv' ? 'flowmeter_data.csv' : 'flowmeter_report.pdf';
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
      const { data } = await api.post('/api/admin/data/import', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (data.success) {
        toast.success(`Imported ${data.inserted_count} rows`);
      } else {
        toast.error(`Validation errors: ${data.error_count}`);
      }
      fetchReadings();
    } catch (e2) {
      toast.error(formatApiError(e2?.response?.data?.detail));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="p-6 space-y-6" data-testid="reports-page">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Reports & Historical Data</h1>
          <p className="text-gray-600 mt-1">View, filter, export and edit instrument readings</p>
        </div>
        <div className="flex gap-2">
          {admin && (
            <>
              <Button variant="outline" onClick={() => triggerDownload('csv')} data-testid="download-csv-btn">
                <Download className="h-4 w-4 mr-2" /> CSV
              </Button>
              <Button style={{ backgroundColor: '#4a9fd8' }} onClick={() => triggerDownload('pdf')} data-testid="download-pdf-btn">
                <FileText className="h-4 w-4 mr-2" /> PDF
              </Button>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleUpload} className="hidden" data-testid="upload-excel-input" />
              <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading} data-testid="upload-excel-btn">
                {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                Upload Excel
              </Button>
            </>
          )}
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Filters</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <Label>Hardware ID</Label>
              <Input value={hardwareId} onChange={(e) => setHardwareId(e.target.value)} placeholder="e.g. FM001" data-testid="filter-hardware-id" />
            </div>
            <div>
              <Label>Start Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left font-normal" data-testid="filter-start-date">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {startDate ? startDate.toLocaleDateString() : <span className="text-gray-400">Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={startDate} onSelect={setStartDate} initialFocus />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label>End Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left font-normal" data-testid="filter-end-date">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {endDate ? endDate.toLocaleDateString() : <span className="text-gray-400">Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={endDate} onSelect={setEndDate} initialFocus />
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex items-end">
              <Button onClick={fetchReadings} className="w-full" data-testid="apply-filters-btn">
                <RefreshCw className="h-4 w-4 mr-2" /> Refresh
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" /> Data ({readings.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center py-8 text-gray-500">Loading…</p>
          ) : readings.length === 0 ? (
            <p className="text-center py-8 text-gray-500">No readings yet. Filter by Hardware ID to fetch history.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="readings-table">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">Time</th>
                    <th className="text-left p-2">Hardware ID</th>
                    <th className="text-right p-2">Flow (L/min)</th>
                    <th className="text-right p-2">Forward Tot.</th>
                    <th className="text-right p-2">Reverse Tot.</th>
                    <th className="text-right p-2">Temp (°C)</th>
                    <th className="text-right p-2">Signal</th>
                  </tr>
                </thead>
                <tbody>
                  {readings.slice(0, 200).map((r, i) => (
                    <tr key={r._id || i} className="border-b hover:bg-gray-50">
                      <td className="p-2">{new Date(r.timestamp || r.received_at || Date.now()).toLocaleString()}</td>
                      <td className="p-2 font-mono text-xs">{r.hardware_id}</td>
                      <td className="p-2 text-right">{Number(r.flow_rate_lpm || 0).toFixed(2)}</td>
                      <td className="p-2 text-right">{Number(r.forward_totalizer || 0).toFixed(2)}</td>
                      <td className="p-2 text-right">{Number(r.reverse_totalizer || 0).toFixed(2)}</td>
                      <td className="p-2 text-right">{Number(r.temperature || 0).toFixed(1)}</td>
                      <td className="p-2 text-right">{r.signal_strength || 0}</td>
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

export default Reports;
