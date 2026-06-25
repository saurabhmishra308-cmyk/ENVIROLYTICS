import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from './ui/dialog';
import { GaugeCircle, Plus, Pencil, Trash2, MailCheck, PlayCircle, AlertTriangle, Eye, EyeOff, TrendingDown } from 'lucide-react';
import { toast } from 'sonner';
import api, { formatApiError } from '../lib/api';

const emptyForm = () => ({
  hardware_id: '',
  label: '',
  monthly_limit_kl: '',
  min_limit_kl: '',
  customer_email: '',
  is_active: true,
  visible_to_client: false,
});

const LimitsCard = ({ canManage }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [editTarget, setEditTarget] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/limits');
      setItems(data?.limits || []);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Failed to load limits');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCreate = async () => {
    try {
      await api.post('/api/limits', {
        ...form,
        monthly_limit_kl: Number(form.monthly_limit_kl) || 0,
        min_limit_kl: Number(form.min_limit_kl) || 0,
      });
      toast.success('Limit added');
      setCreateOpen(false);
      setForm(emptyForm());
      fetchData();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Create failed');
    }
  };

  const handleSaveEdit = async () => {
    try {
      await api.put(`/api/limits/${editTarget.hardware_id}`, {
        label: editTarget.label,
        monthly_limit_kl: Number(editTarget.monthly_limit_kl) || 0,
        min_limit_kl: Number(editTarget.min_limit_kl) || 0,
        customer_email: editTarget.customer_email,
        is_active: editTarget.is_active,
        visible_to_client: editTarget.visible_to_client,
      });
      toast.success('Limit updated');
      setEditTarget(null);
      fetchData();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Update failed');
    }
  };

  const toggleVisibility = async (it) => {
    try {
      await api.put(`/api/limits/${it.hardware_id}`, { visible_to_client: !it.visible_to_client });
      toast.success(`Limit ${!it.visible_to_client ? 'shown to' : 'hidden from'} client`);
      fetchData();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Failed to toggle visibility');
    }
  };

  const handleRemove = async (it) => {
    if (!window.confirm(`Remove limit for ${it.hardware_id}?`)) return;
    try {
      await api.delete(`/api/limits/${it.hardware_id}`);
      toast.success('Limit removed');
      fetchData();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Delete failed');
    }
  };

  const runScan = async () => {
    try {
      const { data } = await api.post('/api/limits/check-now');
      toast.success(`Scan complete · checked ${data.checked} · emails sent ${data.sent}`);
      fetchData();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Scan failed');
    }
  };

  return (
    <Card data-testid="limits-card">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <GaugeCircle className="h-5 w-5 text-amber-600" /> Monthly Abstraction Limits
          </CardTitle>
          <CardDescription>
            Each borewell can be capped with a <strong>maximum</strong> and (optionally) a <strong>minimum</strong> KL/month.
            When this month&apos;s draw is above the max or below the min, the device owner is emailed automatically
            (the limit is also surfaced on their dashboard if <em>Visible to client</em> is on).
          </CardDescription>
        </div>
        <div className="flex gap-2">
          {canManage && (
            <Button variant="outline" size="sm" onClick={runScan} data-testid="limits-scan-btn">
              <PlayCircle className="h-4 w-4 mr-1" /> Run scan
            </Button>
          )}
          {canManage && (
            <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="limits-add-btn">
              <Plus className="h-4 w-4 mr-1" /> Add limit
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-gray-500 italic" data-testid="limits-empty">
            No limits configured yet. {canManage && 'Click "Add limit" to create one.'}
          </p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3" data-testid="limits-list">
            {items.map((it) => {
              const maxKl = Number(it.monthly_limit_kl) || 0;
              const minKl = Number(it.min_limit_kl) || 0;
              const cons = Number(it.consumption_kl_this_month) || 0;
              const pct = maxKl > 0 ? Math.min(100, (cons / maxKl) * 100) : 0;
              const breachClass = it.exceeded
                ? 'border-red-300 bg-red-50 dark:bg-red-950/30'
                : it.below_minimum
                  ? 'border-amber-300 bg-amber-50 dark:bg-amber-950/30'
                  : 'bg-white dark:bg-gray-800';
              return (
                <div
                  key={it.hardware_id}
                  data-testid={`limit-row-${it.hardware_id}`}
                  className={`rounded-lg border p-3 ${breachClass}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold truncate" title={it.label || it.hardware_id}>
                          {it.label || it.hardware_id}
                        </p>
                        <Badge variant="outline" className="text-[10px] font-mono">{it.hardware_id}</Badge>
                        {!it.is_active && <Badge variant="outline">Disabled</Badge>}
                        {it.visible_to_client
                          ? <Badge className="bg-blue-500 inline-flex items-center gap-1 text-[10px]"><Eye className="h-3 w-3" /> Visible</Badge>
                          : <Badge variant="outline" className="inline-flex items-center gap-1 text-[10px] text-gray-500"><EyeOff className="h-3 w-3" /> Hidden</Badge>}
                        {it.exceeded && (
                          <Badge className="bg-red-600 inline-flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" /> Exceeded
                          </Badge>
                        )}
                        {it.below_minimum && (
                          <Badge className="bg-amber-600 inline-flex items-center gap-1">
                            <TrendingDown className="h-3 w-3" /> Below min
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                        <MailCheck className="h-3 w-3" /> {it.customer_email}
                      </p>
                    </div>
                    {canManage && (
                      <div className="flex shrink-0 gap-1">
                        <Button size="sm" variant="outline" onClick={() => toggleVisibility(it)} title={it.visible_to_client ? 'Hide from client' : 'Show to client'} data-testid={`limit-visibility-${it.hardware_id}`}>
                          {it.visible_to_client ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEditTarget({ ...it })} data-testid={`limit-edit-${it.hardware_id}`}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="outline" className="text-red-600" onClick={() => handleRemove(it)} data-testid={`limit-remove-${it.hardware_id}`}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="mt-3">
                    <div className="flex justify-between text-xs mb-1">
                      <span>This month</span>
                      <span className={(it.exceeded || it.below_minimum) ? 'text-red-600 font-semibold' : 'font-medium'}>
                        {cons.toFixed(2)} / {maxKl.toFixed(2)} KL
                      </span>
                    </div>
                    <Progress value={pct} className="h-2" />
                    {minKl > 0 && (
                      <p className="text-[11px] text-gray-500 mt-1">Min: {minKl.toFixed(2)} KL</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add monthly abstraction limit</DialogTitle>
            <DialogDescription>
              Set the maximum (and optionally minimum) monthly draw (KL). The device owner is emailed
              automatically on any breach. Toggle <em>Visible to client</em> to surface the limit on
              their dashboard.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>Hardware ID</Label><Input value={form.hardware_id} onChange={(e) => setForm({ ...form, hardware_id: e.target.value })} placeholder="e.g. FM_GW_001" data-testid="limit-create-hw" /></div>
            <div><Label>Label (optional)</Label><Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Main Borewell" data-testid="limit-create-label" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Max limit (KL/month)</Label><Input type="number" min="0" value={form.monthly_limit_kl} onChange={(e) => setForm({ ...form, monthly_limit_kl: e.target.value })} data-testid="limit-create-kl" /></div>
              <div><Label>Min limit (KL/month, optional)</Label><Input type="number" min="0" value={form.min_limit_kl} onChange={(e) => setForm({ ...form, min_limit_kl: e.target.value })} data-testid="limit-create-min" /></div>
            </div>
            <div><Label>Customer email</Label><Input type="email" value={form.customer_email} onChange={(e) => setForm({ ...form, customer_email: e.target.value })} data-testid="limit-create-email" /></div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="limit-create-visible" checked={!!form.visible_to_client} onChange={(e) => setForm({ ...form, visible_to_client: e.target.checked })} data-testid="limit-create-visible" />
              <Label htmlFor="limit-create-visible" className="cursor-pointer">Visible to client (show on their dashboard)</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} data-testid="limit-create-submit">Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editTarget} onOpenChange={(o) => { if (!o) setEditTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit limit · {editTarget?.hardware_id}</DialogTitle>
          </DialogHeader>
          {editTarget && (
            <div className="space-y-3 py-2">
              <div><Label>Label</Label><Input value={editTarget.label || ''} onChange={(e) => setEditTarget({ ...editTarget, label: e.target.value })} data-testid="limit-edit-label" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Max limit (KL/month)</Label><Input type="number" value={editTarget.monthly_limit_kl} onChange={(e) => setEditTarget({ ...editTarget, monthly_limit_kl: e.target.value })} data-testid="limit-edit-kl" /></div>
                <div><Label>Min limit (KL/month)</Label><Input type="number" value={editTarget.min_limit_kl || ''} onChange={(e) => setEditTarget({ ...editTarget, min_limit_kl: e.target.value })} data-testid="limit-edit-min" /></div>
              </div>
              <div><Label>Customer email</Label><Input type="email" value={editTarget.customer_email} onChange={(e) => setEditTarget({ ...editTarget, customer_email: e.target.value })} data-testid="limit-edit-email" /></div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="limit-edit-active" checked={!!editTarget.is_active} onChange={(e) => setEditTarget({ ...editTarget, is_active: e.target.checked })} data-testid="limit-edit-active" />
                <Label htmlFor="limit-edit-active" className="cursor-pointer">Active (send emails when breached)</Label>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="limit-edit-visible" checked={!!editTarget.visible_to_client} onChange={(e) => setEditTarget({ ...editTarget, visible_to_client: e.target.checked })} data-testid="limit-edit-visible" />
                <Label htmlFor="limit-edit-visible" className="cursor-pointer">Visible to client (show on their dashboard)</Label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button onClick={handleSaveEdit} data-testid="limit-edit-submit">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default LimitsCard;
