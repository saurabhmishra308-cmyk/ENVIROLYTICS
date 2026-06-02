import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { Award, Upload, Download, Trash2, Loader2, FileText, Droplets, Wrench, FlaskConical } from 'lucide-react';
import api, { formatApiError } from '../lib/api';
import { isAdmin, getToken } from '../mockData';
import { toast } from 'sonner';

const CERT_TYPES = [
  { key: 'installation', label: 'Installation Certificate', icon: Wrench, color: '#4a9fd8' },
  { key: 'calibration', label: 'Calibration Certificate', icon: Award, color: '#f5a623' },
  { key: 'water_pre', label: 'Water Quality — Pre-Monsoon', icon: Droplets, color: '#27ae60' },
  { key: 'water_post', label: 'Water Quality — Post-Monsoon', icon: FlaskConical, color: '#8e44ad' },
];

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => currentYear - i);

const Certificates = () => {
  const admin = isAdmin();
  const [activeTab, setActiveTab] = useState('installation');
  const [filterYear, setFilterYear] = useState('');
  const [certs, setCerts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const [form, setForm] = useState({
    year: currentYear,
    instrument_id: '',
    instrument_type: '',
    notes: '',
  });

  const fetchCerts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ cert_type: activeTab });
      if (filterYear) params.append('year', filterYear);
      const { data } = await api.get(`/api/certificates/list?${params.toString()}`);
      setCerts(data.certificates || []);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  }, [activeTab, filterYear]);

  useEffect(() => { fetchCerts(); }, [fetchCerts]);

  const openUpload = () => {
    setForm({ year: currentYear, instrument_id: '', instrument_type: '', notes: '' });
    if (fileRef.current) fileRef.current.value = '';
    setUploadOpen(true);
  };

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) { toast.error('Please pick a file'); return; }
    if (!form.year) { toast.error('Year is required'); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('cert_type', activeTab);
      fd.append('year', String(form.year));
      if (form.instrument_id) fd.append('instrument_id', form.instrument_id);
      if (form.instrument_type) fd.append('instrument_type', form.instrument_type);
      if (form.notes) fd.append('notes', form.notes);
      await api.post('/api/certificates/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('Certificate uploaded');
      setUploadOpen(false);
      fetchCerts();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (cert) => {
    try {
      const url = `${process.env.REACT_APP_BACKEND_URL}/api/certificates/download/${cert.id}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = cert.original_filename || `${cert.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      toast.error(e.message || 'Download failed');
    }
  };

  const handleDelete = async (cert) => {
    if (!window.confirm(`Delete certificate "${cert.original_filename}"?`)) return;
    try {
      await api.delete(`/api/certificates/${cert.id}`);
      toast.success('Deleted');
      fetchCerts();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    }
  };

  const ActiveIcon = CERT_TYPES.find((c) => c.key === activeTab)?.icon || Award;

  return (
    <div className="p-6 space-y-6" data-testid="certificates-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Certificates</h1>
          <p className="text-gray-600 mt-1">Installation, calibration, and water-quality (pre/post monsoon) documents</p>
        </div>
        {admin && (
          <Button style={{ backgroundColor: '#4a9fd8' }} onClick={openUpload} data-testid="cert-upload-btn">
            <Upload className="h-4 w-4 mr-2" /> Upload {CERT_TYPES.find((c) => c.key === activeTab)?.label}
          </Button>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-2 lg:grid-cols-4 gap-2 h-auto bg-transparent p-0">
          {CERT_TYPES.map((t) => {
            const Icon = t.icon;
            return (
              <TabsTrigger
                key={t.key}
                value={t.key}
                data-testid={`cert-tab-${t.key}`}
                className="flex items-center gap-2 p-3 data-[state=active]:text-white"
                style={{
                  backgroundColor: activeTab === t.key ? t.color : '#f3f4f6',
                  color: activeTab === t.key ? 'white' : '#374151',
                }}
              >
                <Icon className="h-4 w-4" />
                <span className="text-sm font-medium">{t.label}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        {CERT_TYPES.map((t) => (
          <TabsContent key={t.key} value={t.key} className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="flex items-center gap-2"><ActiveIcon className="h-5 w-5" /> {t.label}</span>
                  <div className="flex items-center gap-2">
                    <Label className="text-sm text-gray-500">Filter by year:</Label>
                    <select
                      className="border rounded px-2 py-1 text-sm"
                      value={filterYear}
                      onChange={(e) => setFilterYear(e.target.value)}
                      data-testid="cert-filter-year"
                    >
                      <option value="">All years</option>
                      {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>
                </CardTitle>
                <CardDescription>{certs.length} document{certs.length === 1 ? '' : 's'} found</CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-center py-12 text-gray-500"><Loader2 className="h-5 w-5 animate-spin inline mr-2" />Loading…</p>
                ) : certs.length === 0 ? (
                  <div className="text-center py-12">
                    <FileText className="h-12 w-12 mx-auto mb-3 text-gray-400" />
                    <p className="text-gray-600">No {t.label.toLowerCase()} uploaded yet.</p>
                    {admin && (
                      <Button variant="outline" className="mt-4" onClick={openUpload} data-testid="cert-upload-btn-empty">
                        <Upload className="h-4 w-4 mr-2" /> Upload first document
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2" data-testid="cert-list">
                    {certs.map((c) => (
                      <div key={c.id} className="flex items-center justify-between p-3 border rounded hover:bg-gray-50">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <FileText className="h-5 w-5 text-gray-500 shrink-0" />
                          <div className="min-w-0">
                            <p className="font-medium truncate">{c.original_filename}</p>
                            <p className="text-xs text-gray-500">
                              {c.year} · {c.instrument_type || '—'} · {c.instrument_id || 'No device ID'}
                              {c.notes ? ` · ${c.notes}` : ''}
                            </p>
                            <p className="text-xs text-gray-400">Uploaded {new Date(c.uploaded_at).toLocaleString()} · {Math.round((c.size_bytes || 0) / 1024)} KB</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge variant="outline">{c.year}</Badge>
                          <Button size="sm" variant="outline" onClick={() => handleDownload(c)} data-testid={`cert-download-${c.id}`}>
                            <Download className="h-3 w-3 mr-1" /> Download
                          </Button>
                          {admin && (
                            <Button size="sm" variant="outline" className="text-red-600" onClick={() => handleDelete(c)} data-testid={`cert-delete-${c.id}`}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      {/* Upload Dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload {CERT_TYPES.find((c) => c.key === activeTab)?.label}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>File (PDF / JPG / PNG, max 10 MB)</Label>
              <Input type="file" ref={fileRef} accept=".pdf,.jpg,.jpeg,.png" data-testid="cert-upload-file" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Year</Label>
                <select
                  className="w-full border rounded px-3 py-2"
                  value={form.year}
                  onChange={(e) => setForm({ ...form, year: parseInt(e.target.value, 10) })}
                  data-testid="cert-upload-year"
                >
                  {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <div>
                <Label>Instrument Type (optional)</Label>
                <select
                  className="w-full border rounded px-3 py-2"
                  value={form.instrument_type}
                  onChange={(e) => setForm({ ...form, instrument_type: e.target.value })}
                  data-testid="cert-upload-instr-type"
                >
                  <option value="">—</option>
                  <option value="flowmeter">Flowmeter</option>
                  <option value="dwlr">DWLR</option>
                  <option value="ph">pH</option>
                  <option value="conductivity">Conductivity</option>
                  <option value="tds">TDS</option>
                </select>
              </div>
            </div>
            <div>
              <Label>Instrument ID (optional)</Label>
              <Input value={form.instrument_id} onChange={(e) => setForm({ ...form, instrument_id: e.target.value })} placeholder="e.g. FM001" data-testid="cert-upload-instr-id" />
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Any remarks…" data-testid="cert-upload-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)} disabled={uploading}>Cancel</Button>
            <Button onClick={handleUpload} disabled={uploading} data-testid="cert-upload-submit">
              {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Certificates;
