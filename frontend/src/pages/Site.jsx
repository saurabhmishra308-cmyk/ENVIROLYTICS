import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { MapPin, ShieldCheck, Calendar, Clock } from 'lucide-react';
import api, { formatApiError } from '../lib/api';
import { isAdmin } from '../mockData';
import { toast } from 'sonner';

const Site = () => {
  const [users, setUsers] = useState([]);
  const [activations, setActivations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activateOpen, setActivateOpen] = useState(false);
  const [form, setForm] = useState({ user_id: '', subscription_type: 'monthly' });
  const admin = isAdmin();

  const refresh = useCallback(async () => {
    if (!admin) {
      // Non-admin clients can still see their own activations via the public status endpoint;
      // skip the admin-only calls entirely to avoid 403 console noise.
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const promises = [api.get('/api/admin/site/activations'), api.get('/api/admin/users/list')];
      const results = await Promise.all(promises);
      setActivations(results[0].data.activations || []);
      setUsers(results[1].data.users || []);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  }, [admin]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleActivate = async () => {
    if (!form.user_id) { toast.error('Pick a user'); return; }
    try {
      await api.post('/api/admin/site/activate', form);
      toast.success('Site activated');
      setActivateOpen(false);
      setForm({ user_id: '', subscription_type: 'monthly' });
      refresh();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    }
  };

  const userById = (id) => users.find((u) => u.id === id);
  const isExpired = (endIso) => endIso && new Date(endIso) < new Date();

  return (
    <div className="p-6 space-y-6" data-testid="site-management-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Site Activation</h1>
          <p className="text-gray-600 mt-1">Manage monthly / quarterly / yearly site licenses</p>
        </div>
        {admin && (
          <Button style={{ backgroundColor: '#4a9fd8' }} onClick={() => setActivateOpen(true)} data-testid="activate-site-btn">
            <ShieldCheck className="h-4 w-4 mr-2" /> Activate Site
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Activations</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center text-gray-500 py-8">Loading…</p>
          ) : activations.length === 0 ? (
            <div className="text-center py-12">
              <MapPin className="h-10 w-10 mx-auto mb-3 text-gray-400" />
              <p className="text-gray-600">No site activations yet.</p>
            </div>
          ) : (
            <div className="space-y-3" data-testid="activations-list">
              {activations.map((a) => {
                const user = userById(a.user_id);
                const expired = isExpired(a.end_date);
                return (
                  <div key={a.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-4">
                      <MapPin className="h-5 w-5 text-blue-600" />
                      <div>
                        <p className="font-semibold">{user?.full_name || user?.email || a.user_id}</p>
                        <p className="text-sm text-gray-600 flex items-center gap-2">
                          <Calendar className="h-3 w-3" /> {new Date(a.start_date).toLocaleDateString()} → {new Date(a.end_date).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge className="bg-blue-500 capitalize">{a.subscription_type}</Badge>
                      <Badge className={expired ? 'bg-gray-500' : 'bg-green-500'}>
                        {expired ? 'Expired' : 'Active'}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={activateOpen} onOpenChange={setActivateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Activate Site License</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>User</Label>
              <select
                className="w-full border rounded px-3 py-2"
                value={form.user_id}
                onChange={(e) => setForm({ ...form, user_id: e.target.value })}
                data-testid="activate-user-select"
              >
                <option value="">-- Select user --</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.email} ({u.role})</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Subscription Period</Label>
              <select
                className="w-full border rounded px-3 py-2"
                value={form.subscription_type}
                onChange={(e) => setForm({ ...form, subscription_type: e.target.value })}
                data-testid="activate-period-select"
              >
                <option value="monthly">Monthly (30 days)</option>
                <option value="quarterly">Quarterly (90 days)</option>
                <option value="yearly">Yearly (365 days)</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActivateOpen(false)}>Cancel</Button>
            <Button onClick={handleActivate} data-testid="activate-submit">Activate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Site;
