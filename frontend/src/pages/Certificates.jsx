import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { Award, Upload, Download, Trash2, Loader2, FileText, Droplets, Wrench, FlaskConical } from 'lucide-react';
import api, { formatApiError, apiUrl } from '../lib/api';
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
const MONTHS = [
  { v: 1, n: 'Jan' }, { v: 2, n: 'Feb' }, { v: 3, n: 'Mar' }, { v: 4, n: 'Apr' },
  { v: 5, n: 'May' }, { v: 6, n: 'Jun' }, { v: 7, n: 'Jul' }, { v: 8, n: 'Aug' },
  { v: 9, n: 'Sep' }, { v: 10, n: 'Oct' }, { v: 11, n: 'Nov' }, { v: 12, n: 'Dec' },
];

const Certificates = () => {
  const admin = isAdmin();
  const [activeTab, setActiveTab] = useState('installation');
  const [filterYear, setFilterYear] = useState('');
  const [certs, setCerts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const [form, setForm] = useState({    year: currentYear,
    month: '',
    instrument_id: '',
    instrument_type: '',
    notes: '',
    client_id: '',      // admin picks the target client; empty = attach to self
  });
  // Client list for the admin picker on both upload dialogs.
  const [clientList, setClientList] = useState([]);
  useEffect(() => {
    if (!admin) return;
    (async () => {
      try {
        const { data } = await api.get('/api/customer-profile/list');
        setClientList((data.users || []).filter((u) => u.role !== 'admin'));
      } catch { /* silent */ }
    })();
  }, [admin]);

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
    setForm({ year: currentYear, month: '', instrument_id: '', instrument_type: '', notes: '', client_id: '' });
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
      if (form.month) fd.append('month', String(form.month));
      if (form.instrument_id) fd.append('instrument_id', form.instrument_id);
      if (form.instrument_type) fd.append('instrument_type', form.instrument_type);
      if (form.notes) fd.append('notes', form.notes);
      if (admin && form.client_id) fd.append('client_id', form.client_id);
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
      const url = apiUrl(`/api/certificates/download/${cert.id}`);
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
          <h1 className="text-3xl font-bold text-gray-900">Certificate &amp; Instrument Photos</h1>
          <p className="text-gray-600 mt-1">Installation / calibration / water-quality documents (PDF or JPEG) + on-site photos of every installed instrument</p>
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
                              {c.month ? `${MONTHS.find((m) => m.v === c.month)?.n || c.month} ${c.year}` : c.year} · {c.instrument_type || '—'} · {c.instrument_id || 'No device ID'}
                              {c.notes ? ` · ${c.notes}` : ''}
                            </p>
                            <p className="text-xs text-gray-400">Uploaded {new Date(c.uploaded_at).toLocaleString()} · {Math.round((c.size_bytes || 0) / 1024)} KB</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge variant="outline">{c.month ? `${MONTHS.find((m) => m.v === c.month)?.n || c.month} ${c.year}` : c.year}</Badge>
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

      {/* Instrument Photos gallery — JPEG-only per installed instrument */}
      <InstrumentPhotosSection admin={admin} />
      {/* Upload Dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload {CERT_TYPES.find((c) => c.key === activeTab)?.label}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>File (PDF or JPEG, max 10 MB)</Label>
              <Input type="file" ref={fileRef} accept=".pdf,.jpg,.jpeg" data-testid="cert-upload-file" />
            </div>
            {admin && (
              <div>
                <Label>Attach to client (optional — leave empty to attach to your own account)</Label>
                <select
                  className="w-full border rounded px-3 py-2"
                  value={form.client_id}
                  onChange={(e) => setForm({ ...form, client_id: e.target.value })}
                  data-testid="cert-upload-client"
                >
                  <option value="">— My own account —</option>
                  {clientList.map((c) => (
                    <option key={c.id} value={c.id}>{c.customer_name || c.full_name || c.email}{c.unit_name ? ` — ${c.unit_name}` : ''}</option>
                  ))}
                </select>
              </div>
            )}
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
                <Label>Month (optional)</Label>
                <select
                  className="w-full border rounded px-3 py-2"
                  value={form.month}
                  onChange={(e) => setForm({ ...form, month: e.target.value })}
                  data-testid="cert-upload-month"
                >
                  <option value="">—</option>
                  {MONTHS.map((m) => <option key={m.v} value={m.v}>{m.n}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
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
              <div>
                <Label>Instrument ID (optional)</Label>
                <Input value={form.instrument_id} onChange={(e) => setForm({ ...form, instrument_id: e.target.value })} placeholder="e.g. FM001" data-testid="cert-upload-instr-id" />
              </div>
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

// ============================================================================
// Instrument Photos — per-instrument JPEG gallery with location / GPS / landmark.
// Admins can upload / delete; clients see photos for their own instruments only.
// ============================================================================
const PHOTO_INSTRUMENT_TYPES = [
  { value: 'flowmeter', label: 'Flowmeter' },
  { value: 'dwlr', label: 'DWLR / Piezometer' },
  { value: 'ocems', label: 'OCEMS' },
  { value: 'do_meter', label: 'DO Analyzer' },
  { value: 'chlorine_analyzer', label: 'Chlorine Analyzer' },
  { value: 'wq_stp', label: 'STP water quality' },
  { value: 'rwh', label: 'Rainwater harvesting structure' },
  { value: 'other', label: 'Other' },
];

const InstrumentPhotosSection = ({ admin }) => {
  const [instruments, setInstruments] = React.useState([]);
  const [photos, setPhotos] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState('');
  const [clientFilter, setClientFilter] = React.useState('');   // admin scoping
  const [clients, setClients] = React.useState([]);
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [uForm, setUForm] = React.useState({
    hardware_id: '', location_name: '', latitude: '', longitude: '', landmark: '', caption: '',
  });
  const uFileRef = React.useRef(null);
  const [lightbox, setLightbox] = React.useState(null); // { url }

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [regRes, photoRes] = await Promise.all([
        api.get('/api/instrument-registry'),
        api.get('/api/instrument-photos'),
      ]);
      setInstruments(regRes.data?.instruments || []);
      setPhotos(photoRes.data?.photos || []);
      if (admin) {
        try {
          const { data } = await api.get('/api/customer-profile/list');
          setClients((data.users || []).filter((u) => u.role !== 'admin'));
        } catch { /* silent */ }
      }
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Failed to load photos');
    } finally { setLoading(false); }
  }, [admin]);

  React.useEffect(() => { load(); }, [load]);

  const grouped = React.useMemo(() => {
    const map = {};
    for (const p of photos) {
      const hw = p.hardware_id;
      if (!map[hw]) map[hw] = [];
      map[hw].push(p);
    }
    return map;
  }, [photos]);

  const filteredInstruments = React.useMemo(() => {
    let arr = instruments;
    if (clientFilter) arr = arr.filter((i) => i.owner_user_id === clientFilter);
    if (filter) arr = arr.filter((i) => (i.instrument_type || '').toLowerCase() === filter);
    return arr;
  }, [instruments, filter, clientFilter]);

  const openUpload = (inst) => {
    setUForm({ hardware_id: inst.hardware_id, location_name: inst.location_name || '', latitude: inst.latitude ?? '', longitude: inst.longitude ?? '', landmark: '', caption: '' });
    setUploadOpen(true);
  };

  const submitUpload = async () => {
    const file = uFileRef.current?.files?.[0];
    if (!file) { toast.error('Choose a JPEG image'); return; }
    if (!/image\/jpe?g/i.test(file.type)) { toast.error('JPEG only'); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      Object.entries(uForm).forEach(([k, v]) => { if (v !== '' && v !== null) fd.append(k, String(v)); });
      await api.post('/api/instrument-photos', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Photo uploaded');
      setUploadOpen(false);
      load();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Upload failed');
    } finally { setUploading(false); }
  };

  const deletePhoto = async (photo) => {
    if (!window.confirm('Delete this photo?')) return;
    try {
      await api.delete(`/api/instrument-photos/${photo.id}`);
      toast.success('Deleted');
      load();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Delete failed');
    }
  };

  return (
    <div className="pt-4 border-t space-y-4" data-testid="instrument-photos-section">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Instrument Photographs</h2>
          <p className="text-sm text-gray-600">Site photos of every installed instrument with location and GPS coordinates. JPEG only, ≤ 8 MB.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {admin && clients.length > 0 && (
            <>
              <Label className="text-xs uppercase tracking-wide text-gray-500">Client</Label>
              <select className="border rounded px-3 py-2 text-sm" value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} data-testid="iph-client-filter">
                <option value="">All clients</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.customer_name || c.full_name || c.email}{c.unit_name ? ` — ${c.unit_name}` : ''}</option>
                ))}
              </select>
            </>
          )}
          <Label className="text-xs uppercase tracking-wide text-gray-500">Type</Label>
          <select className="border rounded px-3 py-2 text-sm" value={filter} onChange={(e) => setFilter(e.target.value)} data-testid="iph-type-filter">
            <option value="">All types</option>
            {PHOTO_INSTRUMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <p className="text-center py-10 text-gray-500"><Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Loading photos…</p>
      ) : filteredInstruments.length === 0 ? (
        <p className="text-sm italic text-gray-500 text-center py-6">No installed instruments yet — register a device first.</p>
      ) : (
        <div className="space-y-4">
          {filteredInstruments.map((inst) => {
            const arr = grouped[inst.hardware_id] || [];
            return (
              <Card key={inst.hardware_id} data-testid={`iph-inst-${inst.hardware_id}`}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        {inst.label || inst.hardware_id}
                        <Badge variant="outline" className="capitalize">{inst.instrument_type}</Badge>
                      </CardTitle>
                      <CardDescription className="text-xs">
                        <span className="font-mono">{inst.hardware_id}</span>
                        {inst.location_name ? ` · ${inst.location_name}` : ''}
                        {arr.length ? ` · ${arr.length} photo${arr.length === 1 ? '' : 's'}` : ' · no photos yet'}
                      </CardDescription>
                    </div>
                    {admin && (
                      <Button size="sm" variant="outline" onClick={() => openUpload(inst)} data-testid={`iph-upload-${inst.hardware_id}`}>
                        <Upload className="h-3 w-3 mr-1" /> Add photo
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {arr.length === 0 ? (
                    <p className="text-xs italic text-gray-500">No site photos captured yet.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                      {arr.map((p) => <PhotoTile key={p.id} photo={p} admin={admin} onDelete={deletePhoto} onZoom={setLightbox} />)}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add instrument photograph</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>JPEG file (≤ 8 MB)</Label><Input type="file" ref={uFileRef} accept="image/jpeg,.jpg,.jpeg" data-testid="iph-file" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Location name</Label><Input value={uForm.location_name} onChange={(e) => setUForm({ ...uForm, location_name: e.target.value })} placeholder="e.g. Block A rooftop" data-testid="iph-loc" /></div>
              <div><Label>Landmark</Label><Input value={uForm.landmark} onChange={(e) => setUForm({ ...uForm, landmark: e.target.value })} placeholder="Nearby reference" data-testid="iph-landmark" /></div>
              <div><Label>Latitude</Label><Input type="number" step="0.000001" value={uForm.latitude} onChange={(e) => setUForm({ ...uForm, latitude: e.target.value })} data-testid="iph-lat" /></div>
              <div><Label>Longitude</Label><Input type="number" step="0.000001" value={uForm.longitude} onChange={(e) => setUForm({ ...uForm, longitude: e.target.value })} data-testid="iph-lng" /></div>
            </div>
            <div><Label>Caption (optional)</Label><Input value={uForm.caption} onChange={(e) => setUForm({ ...uForm, caption: e.target.value })} data-testid="iph-caption" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)} disabled={uploading}>Cancel</Button>
            <Button onClick={submitUpload} disabled={uploading} data-testid="iph-submit">
              {uploading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Uploading…</> : <><Upload className="h-4 w-4 mr-2" /> Upload</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lightbox — click a thumbnail to zoom; click backdrop or × to close */}
      {lightbox && (
        <div
          role="dialog"
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 cursor-zoom-out"
          onClick={() => { if (lightbox.revoke) URL.revokeObjectURL(lightbox.revoke); setLightbox(null); }}
          data-testid="iph-lightbox"
        >
          <img
            src={lightbox.url}
            alt={lightbox.caption || 'Instrument photograph'}
            className="max-h-[90vh] max-w-[90vw] rounded-lg shadow-2xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            aria-label="Close"
            className="absolute top-6 right-6 h-10 w-10 rounded-full bg-white/90 hover:bg-white text-black text-xl font-bold shadow-lg"
            onClick={() => { if (lightbox.revoke) URL.revokeObjectURL(lightbox.revoke); setLightbox(null); }}
          >×</button>
        </div>
      )}
    </div>
  );
};

const PhotoTile = ({ photo, admin, onDelete, onZoom }) => {
  const [blobUrl, setBlobUrl] = React.useState(null);
  React.useEffect(() => {
    let revoke = null;
    (async () => {
      try {
        const res = await api.get(`/api/instrument-photos/file/${photo.id}`, { responseType: 'blob' });
        const url = URL.createObjectURL(res.data);
        revoke = url;
        setBlobUrl(url);
      } catch { setBlobUrl(null); }
    })();
    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, [photo.id]);
  const openZoom = async () => {
    if (!onZoom) return;
    try {
      const res = await api.get(`/api/instrument-photos/file/${photo.id}`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      onZoom({ url, revoke: url, caption: photo.caption });
    } catch { /* silent */ }
  };
  return (
    <div className="border rounded-lg overflow-hidden bg-white flex flex-col">
      <button
        type="button"
        onClick={openZoom}
        className="bg-gray-100 h-40 flex items-center justify-center overflow-hidden cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-blue-500"
        data-testid={`iph-zoom-${photo.id}`}
        aria-label="Zoom photograph"
      >
        {blobUrl ? <img src={blobUrl} alt={photo.caption || 'Instrument'} className="h-full w-full object-cover" /> : <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
      </button>
      <div className="p-2 text-xs text-gray-700 space-y-0.5">
        {photo.caption && <p className="font-medium truncate" title={photo.caption}>{photo.caption}</p>}
        {photo.location_name && <p><span className="text-gray-500">Location:</span> {photo.location_name}</p>}
        {photo.landmark && <p><span className="text-gray-500">Landmark:</span> {photo.landmark}</p>}
        {(photo.latitude != null || photo.longitude != null) && (
          <p><span className="text-gray-500">GPS:</span> <span className="font-mono">{photo.latitude ?? '—'}, {photo.longitude ?? '—'}</span></p>
        )}
        <p className="text-[10px] text-gray-400 pt-1">{new Date(photo.created_at).toLocaleString('en-GB', { hour12: false })}</p>
      </div>
      {admin && (
        <div className="p-2 border-t bg-gray-50 flex justify-end">
          <Button size="sm" variant="ghost" className="text-red-600" onClick={() => onDelete(photo)} data-testid={`iph-delete-${photo.id}`}>
            <Trash2 className="h-3 w-3 mr-1" /> Delete
          </Button>
        </div>
      )}
    </div>
  );
};
