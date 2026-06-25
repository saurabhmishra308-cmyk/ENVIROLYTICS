import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from './ui/dialog';
import { CalendarClock, PlayCircle, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import api, { formatApiError } from '../lib/api';

const statusBadge = (status, daysLeft) => {
  if (status === 'expired')  return <Badge className="bg-red-600">Expired</Badge>;
  if (status === 'expiring') return <Badge className="bg-amber-500">Expiring · {daysLeft}d</Badge>;
  if (status === 'active')   return <Badge className="bg-emerald-600">Active · {daysLeft}d</Badge>;
  return <Badge variant="outline">Unknown</Badge>;
};

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString() : '—');

const RenewalsCard = () => {
  const [items, setItems] = useState([]);
  const [window, setWindow] = useState(60);
  const [loading, setLoading] = useState(true);
  const [editTarget, setEditTarget] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/renewals');
      setItems(data?.users || []);
      setWindow(data?.reminder_window_days || 60);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Failed to load renewals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const runScan = async () => {
    try {
      const { data } = await api.post('/api/renewals/run-now');
      toast.success(`Scan: checked ${data.checked}, due ${data.due}, emailed ${data.sent}`);
      fetchData();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Scan failed');
    }
  };

  const saveEdit = async () => {
    const payload = {};
    if (editTarget.service_expiry_date) payload.service_expiry_date = editTarget.service_expiry_date;
    if (editTarget.service_term_years)  payload.service_term_years  = Number(editTarget.service_term_years);
    try {
      await api.put(`/api/renewals/${editTarget.id}`, payload);
      toast.success('Renewal updated');
      setEditTarget(null);
      fetchData();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Save failed');
    }
  };

  return (
    <Card data-testid="renewals-card">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-blue-600" /> Subscription Renewal Reminders
          </CardTitle>
          <CardDescription>
            Each user&apos;s online data-hosting subscription is automatically tracked from their account
            creation date plus the configured term (default 1 year). An email reminder fires once when
            the user enters the {window}-day renewal window.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={runScan} data-testid="renewals-scan-btn">
          <PlayCircle className="h-4 w-4 mr-1" /> Run scan
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No users yet.</p>
        ) : (
          <div className="overflow-x-auto" data-testid="renewals-list">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 dark:bg-gray-800">
                <tr>
                  <th className="px-3 py-2 text-left">User</th>
                  <th className="px-3 py-2 text-left">Created</th>
                  <th className="px-3 py-2 text-left">Term (yrs)</th>
                  <th className="px-3 py-2 text-left">Expires</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Edit</th>
                </tr>
              </thead>
              <tbody>
                {items.map((u) => (
                  <tr key={u.id} className="border-b" data-testid={`renewal-row-${u.id}`}>
                    <td className="px-3 py-2">
                      <div className="font-medium">{u.full_name || '—'}</div>
                      <div className="text-xs text-gray-500 font-mono">{u.email}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">{fmtDate(u.created_at)}</td>
                    <td className="px-3 py-2 text-xs">{u.service_term_years}</td>
                    <td className="px-3 py-2 text-xs">{fmtDate(u.service_expiry_date)}</td>
                    <td className="px-3 py-2 text-center">{statusBadge(u.status, u.days_until_expiry)}</td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="sm" variant="outline"
                        onClick={() => setEditTarget({
                          id: u.id,
                          email: u.email,
                          service_expiry_date: u.service_expiry_date ? u.service_expiry_date.slice(0, 10) : '',
                          service_term_years: u.service_term_years,
                        })}
                        data-testid={`renewal-edit-${u.id}`}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <Dialog open={!!editTarget} onOpenChange={(o) => { if (!o) setEditTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set renewal · {editTarget?.email}</DialogTitle>
            <DialogDescription>Either a custom expiry date OR a service term (years from account creation).</DialogDescription>
          </DialogHeader>
          {editTarget && (
            <div className="space-y-3 py-2">
              <div>
                <Label>Expiry date</Label>
                <Input
                  type="date"
                  value={editTarget.service_expiry_date || ''}
                  onChange={(e) => setEditTarget({ ...editTarget, service_expiry_date: e.target.value })}
                  data-testid="renewal-edit-date"
                />
              </div>
              <div>
                <Label>Service term (years)</Label>
                <Input
                  type="number" step="0.1" min="0.1" max="10"
                  value={editTarget.service_term_years || ''}
                  onChange={(e) => setEditTarget({ ...editTarget, service_term_years: e.target.value })}
                  data-testid="renewal-edit-term"
                />
              </div>
              <p className="text-xs text-gray-500">
                Saving will also reset any prior reminder marker so a fresh reminder can fire if the new
                date falls in the {window}-day window.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button onClick={saveEdit} data-testid="renewal-edit-submit">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default RenewalsCard;
