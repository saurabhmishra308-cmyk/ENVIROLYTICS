import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '../components/ui/dialog';
import {
  Cpu, Plus, Trash2, Edit3, Shield, RotateCcw, AlertTriangle,
} from 'lucide-react';
import api, { formatApiError } from '../lib/api';
import { isAdmin } from '../mockData';
import { toast } from 'sonner';

const TYPE_OPTIONS = [
  { value: 'flowmeter', label: 'Flowmeter' },
  { value: 'dwlr', label: 'DWLR (Water Level)' },
  { value: 'ph', label: 'pH Sensor' },
  { value: 'tds', label: 'TDS Sensor' },
  { value: 'conductivity', label: 'Conductivity Sensor' },
];

const CATEGORY_OPTIONS = [
  { value: 'groundwater_abstraction', label: 'Groundwater Abstraction' },
  { value: 'stp_inlet', label: 'STP Inlet' },
  { value: 'stp_outlet', label: 'STP Outlet' },
];

const EMPTY_FORM = {
  hardware_id: '',
  instrument_type: 'flowmeter',
  owner_user_id: '',
  label: '',
  location_name: '',
  latitude: '',
  longitude: '',
  category: 'groundwater_abstraction',
};

const Instruments = () => {
  const admin = isAdmin();
  const [items, setItems] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editTarget, setEditTarget] = useState(null);

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
    if (out.instrument_type !== 'flowmeter') {
      delete out.category;
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
    });
    setEditOpen(true);
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
          <Button variant="outline" className="text-red-600 border-red-500" onClick={handlePurgeOrphans} data-testid="purge-orphans-btn">
            <Trash2 className="h-4 w-4 mr-2" /> Purge Orphan Data
          </Button>
          <Button variant="outline" className="text-amber-700 border-amber-500" onClick={() => setWipeOpen(true)} data-testid="wipe-demo-data-btn">
            <RotateCcw className="h-4 w-4 mr-2" /> Wipe Demo Data
          </Button>
          <Button style={{ backgroundColor: '#4a9fd8' }} onClick={() => { setForm(EMPTY_FORM); setCreateOpen(true); }} data-testid="add-instrument-btn">
            <Plus className="mr-2 h-4 w-4" /> Add Instrument
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-6"><div className="flex items-center justify-between"><div><p className="text-sm text-gray-600">Registered</p><p className="text-3xl font-bold">{totals.total}</p></div><Cpu className="h-8 w-8 text-blue-500" /></div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="flex items-center justify-between"><div><p className="text-sm text-gray-600">Flowmeters</p><p className="text-3xl font-bold">{totals.flowmeters}</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="flex items-center justify-between"><div><p className="text-sm text-gray-600">Other Instruments</p><p className="text-3xl font-bold">{totals.instruments}</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="flex items-center justify-between"><div><p className="text-sm text-gray-600">Assigned Clients</p><p className="text-3xl font-bold">{totals.clients}</p></div></div></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>All Registered Instruments</CardTitle></CardHeader>
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
                    <th className="text-left p-3">Hardware ID</th>
                    <th className="text-left p-3">Type</th>
                    <th className="text-left p-3">Label</th>
                    <th className="text-left p-3">Owner</th>
                    <th className="text-left p-3">Location</th>
                    <th className="text-left p-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.hardware_id} className="border-b hover:bg-gray-50">
                      <td className="p-3 font-mono text-sm">{it.hardware_id}</td>
                      <td className="p-3">
                        <Badge className="bg-blue-500 capitalize">{it.instrument_type}</Badge>
                        {it.instrument_type === 'flowmeter' && it.category && (
                          <div className="text-xs text-gray-500 mt-1">{it.category.replace(/_/g, ' ')}</div>
                        )}
                      </td>
                      <td className="p-3">{it.label || '—'}</td>
                      <td className="p-3 text-sm">
                        {it.owner_name ? <div className="font-medium">{it.owner_name}</div> : <span className="text-gray-400">unassigned</span>}
                        {it.owner_email && <div className="text-gray-500 text-xs">{it.owner_email}</div>}
                      </td>
                      <td className="p-3 text-sm text-gray-600">
                        {it.location_name || '—'}
                        {it.latitude != null && it.longitude != null && (
                          <div className="text-gray-400 text-xs mt-0.5">{Number(it.latitude).toFixed(4)}, {Number(it.longitude).toFixed(4)}</div>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => openEdit(it)} data-testid={`edit-instrument-${it.hardware_id}`}>
                            <Edit3 className="h-3 w-3 mr-1" /> Edit
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
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Instrument</DialogTitle>
            <DialogDescription>Register a new physical device and assign it to a client account.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Hardware ID *</Label>
              <Input value={form.hardware_id} onChange={(e) => setForm({ ...form, hardware_id: e.target.value })} placeholder="e.g. FM_PLANT_A_01" data-testid="instrument-hw-id" />
              <p className="text-xs text-gray-500 mt-1">Must match the device&apos;s MQTT topic ID.</p>
            </div>
            <div>
              <Label>Instrument Type *</Label>
              <select className="w-full border rounded px-3 py-2" value={form.instrument_type} onChange={(e) => setForm({ ...form, instrument_type: e.target.value })} data-testid="instrument-type">
                {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            {form.instrument_type === 'flowmeter' && (
              <div>
                <Label>Category *</Label>
                <select className="w-full border rounded px-3 py-2" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} data-testid="instrument-category">
                  {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            )}
            <div>
              <Label>Owner (Client) *</Label>
              <select className="w-full border rounded px-3 py-2" value={form.owner_user_id} onChange={(e) => setForm({ ...form, owner_user_id: e.target.value })} data-testid="instrument-owner">
                <option value="">— Select a user —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{`${u.full_name || u.email} (${u.role})`}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Display Label</Label>
              <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Friendly name shown on dashboard" data-testid="instrument-label" />
            </div>
            <div>
              <Label>Location Name</Label>
              <Input value={form.location_name} onChange={(e) => setForm({ ...form, location_name: e.target.value })} placeholder="e.g. Borewell #3" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Latitude</Label><Input value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} placeholder="26.8467" /></div>
              <div><Label>Longitude</Label><Input value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} placeholder="80.9462" /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} data-testid="create-instrument-submit">Register</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Instrument — {editTarget?.hardware_id}</DialogTitle>
            <DialogDescription>Update assignment, label, or location for this device.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Instrument Type</Label>
              <select className="w-full border rounded px-3 py-2" value={form.instrument_type} onChange={(e) => setForm({ ...form, instrument_type: e.target.value })}>
                {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            {form.instrument_type === 'flowmeter' && (
              <div>
                <Label>Category</Label>
                <select className="w-full border rounded px-3 py-2" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            )}
            <div>
              <Label>Owner (Client)</Label>
              <select className="w-full border rounded px-3 py-2" value={form.owner_user_id} onChange={(e) => setForm({ ...form, owner_user_id: e.target.value })}>
                <option value="">— Select a user —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{`${u.full_name || u.email} (${u.role})`}</option>
                ))}
              </select>
            </div>
            <div><Label>Display Label</Label><Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></div>
            <div><Label>Location Name</Label><Input value={form.location_name} onChange={(e) => setForm({ ...form, location_name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Latitude</Label><Input value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} /></div>
              <div><Label>Longitude</Label><Input value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleEdit} data-testid="edit-instrument-submit">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Wipe Demo Confirm */}
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
