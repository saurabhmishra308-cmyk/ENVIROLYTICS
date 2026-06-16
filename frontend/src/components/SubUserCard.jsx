import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from './ui/dialog';
import { UserPlus, ShieldCheck, Trash2, Pencil, PowerOff, Power } from 'lucide-react';
import { toast } from 'sonner';
import api, { formatApiError } from '../lib/api';

const ALL_PERMS = [
  { key: 'dashboard',    label: 'Dashboard'    },
  { key: 'reports',      label: 'Reports'      },
  { key: 'analysis',     label: 'Analysis'     },
  { key: 'certificates', label: 'Certificates' },
  { key: 'audit',        label: 'Audit log'    },
  { key: 'limits',       label: 'Flow limits'  },
];

const emptyForm = () => ({
  email: '',
  password: '',
  full_name: '',
  permissions: Object.fromEntries(ALL_PERMS.map((p) => [p.key, false])),
});

const PermissionCheckboxes = ({ value, onChange, idPrefix = 'sub' }) => (
  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
    {ALL_PERMS.map((p) => (
      <label
        key={p.key}
        className="inline-flex items-center gap-2 text-sm rounded-md border px-2 py-1.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
      >
        <input
          type="checkbox"
          checked={!!value[p.key]}
          onChange={(e) => onChange({ ...value, [p.key]: e.target.checked })}
          data-testid={`${idPrefix}-perm-${p.key}`}
        />
        {p.label}
      </label>
    ))}
  </div>
);

const SubUserCard = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [editTarget, setEditTarget] = useState(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/users/subusers');
      setUsers(data?.users || []);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Failed to load sub-users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleCreate = async () => {
    try {
      await api.post('/api/users/subusers', form);
      toast.success('Sub-user created');
      setCreateOpen(false);
      setForm(emptyForm());
      fetchUsers();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Create failed');
    }
  };

  const handleSaveEdit = async () => {
    try {
      await api.put(`/api/users/subusers/${editTarget.id}`, {
        full_name: editTarget.full_name,
        is_active: editTarget.is_active,
        permissions: editTarget.permissions,
      });
      toast.success('Sub-user updated');
      setEditTarget(null);
      fetchUsers();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Update failed');
    }
  };

  const handleRemove = async (u) => {
    if (!window.confirm(`Remove ${u.email}?`)) return;
    try {
      await api.delete(`/api/users/subusers/${u.id}`);
      toast.success('Sub-user removed');
      fetchUsers();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Delete failed');
    }
  };

  const toggleActive = async (u) => {
    try {
      await api.put(`/api/users/subusers/${u.id}`, { is_active: !u.is_active });
      fetchUsers();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Update failed');
    }
  };

  return (
    <Card data-testid="subuser-card">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-600" /> Sub-users & Permissions
          </CardTitle>
          <CardDescription>Create sub-users and pick exactly what they can see (dashboard, reports, analysis, certificates, audit, flow limits).</CardDescription>
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="add-subuser-btn">
          <UserPlus className="h-4 w-4 mr-1" /> Add sub-user
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-gray-500 italic" data-testid="subuser-empty">No sub-users yet.</p>
        ) : (
          <div className="overflow-x-auto" data-testid="subuser-list">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 dark:bg-gray-800">
                <tr>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Email</th>
                  <th className="px-3 py-2">Permissions</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b" data-testid={`subuser-row-${u.id}`}>
                    <td className="px-3 py-2">{u.full_name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{u.email}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1 justify-center">
                        {ALL_PERMS.filter((p) => u.permissions?.[p.key]).map((p) => (
                          <Badge key={p.key} variant="outline" className="text-[10px]">{p.label}</Badge>
                        ))}
                        {ALL_PERMS.every((p) => !u.permissions?.[p.key]) && (
                          <span className="text-xs italic text-gray-500">No access</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center">
                      {u.is_active
                        ? <Badge className="bg-emerald-600">Active</Badge>
                        : <Badge variant="outline">Disabled</Badge>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" variant="outline" onClick={() => toggleActive(u)} className="mr-1" data-testid={`subuser-toggle-${u.id}`}>
                        {u.is_active ? <PowerOff className="h-3 w-3" /> : <Power className="h-3 w-3" />}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditTarget({ ...u })} className="mr-1" data-testid={`subuser-edit-${u.id}`}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handleRemove(u)} className="text-red-600" data-testid={`subuser-remove-${u.id}`}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      {/* Create */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add sub-user</DialogTitle>
            <DialogDescription>Sub-user will only see the sections you enable below.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>Full name</Label><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} data-testid="subuser-create-name" /></div>
            <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="subuser-create-email" /></div>
            <div><Label>Password (min 8 chars)</Label><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="subuser-create-password" /></div>
            <div>
              <Label>Permissions</Label>
              <PermissionCheckboxes value={form.permissions} onChange={(p) => setForm({ ...form, permissions: p })} idPrefix="create" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} data-testid="subuser-create-submit">Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit */}
      <Dialog open={!!editTarget} onOpenChange={(o) => { if (!o) setEditTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit sub-user</DialogTitle>
            <DialogDescription>{editTarget?.email}</DialogDescription>
          </DialogHeader>
          {editTarget && (
            <div className="space-y-3 py-2">
              <div><Label>Full name</Label><Input value={editTarget.full_name || ''} onChange={(e) => setEditTarget({ ...editTarget, full_name: e.target.value })} data-testid="subuser-edit-name" /></div>
              <div>
                <Label>Permissions</Label>
                <PermissionCheckboxes
                  value={editTarget.permissions || {}}
                  onChange={(p) => setEditTarget({ ...editTarget, permissions: p })}
                  idPrefix="edit"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button onClick={handleSaveEdit} data-testid="subuser-edit-submit">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default SubUserCard;
