import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import { Video, Shield, Search, Cpu, Upload, CheckCircle2, XCircle } from 'lucide-react';
import api, { formatApiError } from '../lib/api';
import { isAdmin } from '../mockData';
import { toast } from 'sonner';
import { cleanLabel } from '../utils/labels';
import { LiveCameraWidget } from '../components/LiveCameraWidget';

/**
 * Admin Cameras Manager — single page listing every registered instrument
 * across all clients, each embedded with the LiveCameraWidget so admin can
 * upload / edit videos for any device without hopping between clients.
 *
 * Filters:
 *   * client dropdown (owner)
 *   * instrument-type dropdown
 *   * free-text search on hardware_id / label
 */
export default function Cameras() {
  const admin = isAdmin();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [clientFilter, setClientFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [search, setSearch] = useState('');
  // Bulk upload dialog state — attaches ONE video to N devices in one shot.
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkFile, setBulkFile] = useState(null);
  const [bulkSelected, setBulkSelected] = useState(new Set());
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);
  const fileRef = useRef(null);

  const refresh = useCallback(async () => {
    if (!admin) { setLoading(false); return; }
    setLoading(true);
    try {
      const { data } = await api.get('/api/instrument-registry');
      setItems(data.instruments || []);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Failed to load instruments');
    } finally {
      setLoading(false);
    }
  }, [admin]);

  useEffect(() => { refresh(); }, [refresh]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return items.filter((it) => {
      if (clientFilter && it.owner_user_id !== clientFilter) return false;
      if (typeFilter && it.instrument_type !== typeFilter) return false;
      if (s) {
        const blob = `${it.hardware_id} ${it.label || ''} ${it.owner_name || ''} ${it.owner_email || ''}`.toLowerCase();
        if (!blob.includes(s)) return false;
      }
      return true;
    });
  }, [items, clientFilter, typeFilter, search]);

  const clients = useMemo(() => {
    const seen = new Map();
    for (const it of items) {
      if (it.owner_user_id && !seen.has(it.owner_user_id)) {
        seen.set(it.owner_user_id, {
          id: it.owner_user_id,
          label: it.owner_name || it.owner_email || it.owner_user_id,
        });
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [items]);

  const types = useMemo(() => {
    const seen = new Set();
    for (const it of items) if (it.instrument_type) seen.add(it.instrument_type);
    return Array.from(seen).sort();
  }, [items]);

  const openBulk = () => {
    setBulkFile(null);
    setBulkResult(null);
    setBulkSelected(new Set(filtered.map((it) => it.hardware_id)));
    setBulkOpen(true);
  };

  const toggleBulkPick = (hw) => {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(hw)) next.delete(hw); else next.add(hw);
      return next;
    });
  };

  const submitBulk = async () => {
    if (!bulkFile) return toast.error('Pick a video file first');
    if (bulkSelected.size === 0) return toast.error('Pick at least one device');
    const form = new FormData();
    form.append('file', bulkFile);
    form.append('hardware_ids', Array.from(bulkSelected).join(','));
    setBulkUploading(true);
    try {
      const { data } = await api.post('/api/camera-streams/bulk-upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setBulkResult(data);
      toast.success(`Attached to ${data.attached_count} device(s)${data.skipped_count ? ` · ${data.skipped_count} skipped` : ''}`);
      refresh();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Bulk upload failed');
    } finally {
      setBulkUploading(false);
    }
  };

  if (!admin) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <Shield className="h-12 w-12 mx-auto text-gray-400" />
            <h2 className="text-xl font-semibold">Admin access required</h2>
            <p className="text-gray-600">Only administrators can manage cameras and demo videos.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" data-testid="admin-cameras-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Video className="h-6 w-6" /> Live Camera Feed — Admin Manager</h1>
          <p className="text-sm text-gray-600">Upload or link videos for every registered device across every client. Clients see the video as their live feed.</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search hardware/label/client"
              className="pl-8 w-64"
              data-testid="cameras-search"
            />
          </div>
          <select
            className="border rounded px-3 py-2 h-10"
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            data-testid="cameras-client-filter"
          >
            <option value="">All clients</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <select
            className="border rounded px-3 py-2 h-10"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            data-testid="cameras-type-filter"
          >
            <option value="">All types</option>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <Button onClick={openBulk} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="bulk-upload-open-btn">
            <Upload className="h-4 w-4 mr-1" /> Bulk Upload Video
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-center py-16 text-gray-500">Loading instruments…</p>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-2">
            <Cpu className="h-10 w-10 mx-auto text-gray-300" />
            <p className="text-gray-600">No instruments match the current filters.</p>
            <p className="text-xs text-gray-500">
              Register devices via the <a href="/instruments" className="text-blue-600 hover:underline">Instruments</a> page, then come back to attach a camera.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="cameras-grid">
          {filtered.map((it) => (
            <Card key={it.hardware_id} className="border-t-4" style={{ borderTopColor: '#0284c7' }} data-testid={`camera-tile-${it.hardware_id}`}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between gap-2">
                  <span className="truncate">{cleanLabel(it.label || it.hardware_id)}</span>
                  <Badge className="bg-blue-500 capitalize text-[10px]">{it.instrument_type}</Badge>
                </CardTitle>
                <CardDescription className="text-xs">
                  <span className="font-mono text-gray-500">{it.hardware_id}</span>
                  {(it.owner_name || it.owner_email) && (
                    <span className="ml-2 text-gray-600">· {it.owner_name || it.owner_email}</span>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <LiveCameraWidget
                  hardwareId={it.hardware_id}
                  deviceLabel={it.label || it.hardware_id}
                  canManage={true}
                  onChanged={refresh}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ============ BULK UPLOAD VIDEO ============ */}
      <Dialog open={bulkOpen} onOpenChange={(v) => !v && setBulkOpen(false)}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto" data-testid="bulk-upload-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" /> Bulk Upload Camera Video
            </DialogTitle>
            <DialogDescription>
              Upload one video file and attach it to multiple instruments at once — ideal for a site with several identical
              aeration tanks / DO probes that should show the same footage.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Video file (MP4 / WebM, max 120 MB)</Label>
              <Input
                ref={fileRef}
                type="file"
                accept="video/mp4,video/webm,.mp4,.webm"
                onChange={(e) => setBulkFile(e.target.files?.[0] || null)}
                data-testid="bulk-file-input"
              />
              {bulkFile && (
                <p className="text-[11px] text-gray-600 mt-1">
                  Selected: <strong>{bulkFile.name}</strong> · {(bulkFile.size / 1024 / 1024).toFixed(1)} MB
                </p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Attach to devices ({bulkSelected.size} of {filtered.length} selected)</Label>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setBulkSelected(new Set(filtered.map((it) => it.hardware_id)))}>Select all</Button>
                  <Button size="sm" variant="outline" onClick={() => setBulkSelected(new Set())}>Clear</Button>
                </div>
              </div>
              <div className="max-h-72 overflow-y-auto border rounded">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="p-2 w-8"></th>
                      <th className="text-left p-2">Device</th>
                      <th className="text-left p-2">Type</th>
                      <th className="text-left p-2">Client</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((it) => (
                      <tr
                        key={it.hardware_id}
                        className={`border-t cursor-pointer ${bulkSelected.has(it.hardware_id) ? 'bg-emerald-50' : ''}`}
                        onClick={() => toggleBulkPick(it.hardware_id)}
                        data-testid={`bulk-pick-${it.hardware_id}`}
                      >
                        <td className="p-2 text-center">
                          <input type="checkbox" readOnly checked={bulkSelected.has(it.hardware_id)} />
                        </td>
                        <td className="p-2">
                          <div className="font-medium">{cleanLabel(it.label || it.hardware_id)}</div>
                          <div className="text-[10px] font-mono text-gray-500">{it.hardware_id}</div>
                        </td>
                        <td className="p-2 text-xs">{it.instrument_type}</td>
                        <td className="p-2 text-xs">{it.owner_name || it.owner_email || '—'}</td>
                      </tr>
                    ))}
                    {filtered.length === 0 && (
                      <tr><td colSpan={4} className="text-center py-6 text-gray-500 text-sm">Adjust the filters to select devices.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {bulkResult && (
              <div className="rounded-lg border p-3 bg-gray-50" data-testid="bulk-upload-result">
                <div className="flex items-center gap-4 text-sm">
                  <span className="flex items-center gap-1 text-green-700"><CheckCircle2 className="h-4 w-4" /> Attached: {bulkResult.attached_count}</span>
                  <span className="flex items-center gap-1 text-red-700"><XCircle className="h-4 w-4" /> Skipped: {bulkResult.skipped_count}</span>
                </div>
                <p className="text-[11px] text-gray-600 mt-1 break-all">Shared URL: <code>{bulkResult.shared_url}</code></p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setBulkOpen(false)}>Close</Button>
            <Button
              onClick={submitBulk}
              disabled={bulkUploading || !bulkFile || bulkSelected.size === 0}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              data-testid="bulk-upload-submit-btn"
            >
              {bulkUploading ? 'Uploading…' : (<><Upload className="h-4 w-4 mr-1" /> Upload & attach to {bulkSelected.size} device{bulkSelected.size === 1 ? '' : 's'}</>)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
