import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Users as UsersIcon, UserPlus, Shield, KeyRound, Power, Trash2 } from 'lucide-react';
import api, { formatApiError } from '../lib/api';
import { isAdmin, getCurrentUser } from '../mockData';
import { toast } from 'sonner';

const UserPage = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const me = getCurrentUser();
  const admin = isAdmin();

  // Create user state
  const [createOpen, setCreateOpen] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', password: '', full_name: '', role: 'client', company_name: '', phone: '', location_name: '', latitude: '', longitude: '' });

  // Edit user state
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({ full_name: '', company_name: '', phone: '', location_name: '', latitude: '', longitude: '', role: 'client' });

  // Change password modal
  const [pwOpen, setPwOpen] = useState(false);
  const [pwTarget, setPwTarget] = useState(null);
  const [newPassword, setNewPassword] = useState('');

  // Self-change password modal
  const [selfPwOpen, setSelfPwOpen] = useState(false);
  const [selfPw, setSelfPw] = useState({ current_password: '', new_password: '' });

  const fetchUsers = useCallback(async () => {
    if (!admin) { setLoading(false); return; }
    try {
      const { data } = await api.get('/api/admin/users/list');
      setUsers(data.users || []);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  }, [admin]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleCreate = async () => {
    try {
      const payload = { ...newUser };
      if (payload.latitude === '' || payload.latitude == null) delete payload.latitude;
      else payload.latitude = parseFloat(payload.latitude);
      if (payload.longitude === '' || payload.longitude == null) delete payload.longitude;
      else payload.longitude = parseFloat(payload.longitude);
      await api.post('/api/admin/users/create', payload);
      toast.success('User created');
      setCreateOpen(false);
      setNewUser({ email: '', password: '', full_name: '', role: 'client', company_name: '', phone: '', location_name: '', latitude: '', longitude: '' });
      fetchUsers();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    }
  };

  const openEdit = (u) => {
    setEditTarget(u);
    setEditForm({
      full_name: u.full_name || '',
      company_name: u.company_name || '',
      phone: u.phone || '',
      location_name: u.location_name || '',
      latitude: u.latitude != null ? String(u.latitude) : '',
      longitude: u.longitude != null ? String(u.longitude) : '',
      role: u.role || 'client',
    });
    setEditOpen(true);
  };

  const handleEdit = async () => {
    if (!editTarget) return;
    try {
      const payload = { ...editForm };
      if (payload.latitude === '') payload.latitude = null;
      else payload.latitude = parseFloat(payload.latitude);
      if (payload.longitude === '') payload.longitude = null;
      else payload.longitude = parseFloat(payload.longitude);
      // Drop empties so we don't overwrite with null on string fields
      Object.keys(payload).forEach((k) => {
        if (k !== 'latitude' && k !== 'longitude' && (payload[k] === '' || payload[k] == null)) {
          delete payload[k];
        }
      });
      await api.put(`/api/admin/users/${editTarget.id}`, payload);
      toast.success('User updated');
      setEditOpen(false);
      setEditTarget(null);
      fetchUsers();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    }
  };

  const handleAdminResetPassword = async () => {
    if (!pwTarget) return;
    try {
      await api.post('/api/auth/admin/change-user-password', { user_id: pwTarget.id, new_password: newPassword });
      toast.success(`Password updated for ${pwTarget.email}`);
      setPwOpen(false);
      setNewPassword('');
      setPwTarget(null);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    }
  };

  const handleSelfChangePassword = async () => {
    try {
      await api.post('/api/auth/change-password', selfPw);
      toast.success('Your password has been updated');
      setSelfPwOpen(false);
      setSelfPw({ current_password: '', new_password: '' });
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    }
  };

  const toggleStatus = async (u) => {
    try {
      await api.put(`/api/admin/users/${u.id}/status?is_active=${!u.is_active}`);
      toast.success(`User ${!u.is_active ? 'activated' : 'deactivated'}`);
      fetchUsers();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    }
  };

  const deleteUser = async (u) => {
    if (!window.confirm(`Delete user ${u.email}?`)) return;
    try {
      await api.delete(`/api/admin/users/${u.id}`);
      toast.success('User deleted');
      fetchUsers();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    }
  };

  if (!admin) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-12 text-center space-y-4">
            <Shield className="h-12 w-12 mx-auto text-gray-400" />
            <h2 className="text-xl font-semibold">Admin access required</h2>
            <p className="text-gray-600">You can change your own password below.</p>
            <Button onClick={() => setSelfPwOpen(true)} data-testid="user-self-change-password-btn">
              <KeyRound className="h-4 w-4 mr-2" /> Change My Password
            </Button>
          </CardContent>
        </Card>

        <Dialog open={selfPwOpen} onOpenChange={setSelfPwOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Change My Password</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Current Password</Label>
                <Input type="password" value={selfPw.current_password} onChange={(e) => setSelfPw({ ...selfPw, current_password: e.target.value })} data-testid="self-current-password" />
              </div>
              <div>
                <Label>New Password (min 8 chars)</Label>
                <Input type="password" value={selfPw.new_password} onChange={(e) => setSelfPw({ ...selfPw, new_password: e.target.value })} data-testid="self-new-password" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSelfPwOpen(false)}>Cancel</Button>
              <Button onClick={handleSelfChangePassword} data-testid="self-change-password-submit">Update</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  const adminCount = users.filter((u) => u.role === 'admin').length;
  const activeCount = users.filter((u) => u.is_active).length;
  const clientCount = users.filter((u) => u.role === 'client').length;

  return (
    <div className="p-6 space-y-6" data-testid="user-management-page">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">User Management</h1>
          <p className="text-gray-600 mt-1">Manage system users and permissions</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setSelfPwOpen(true)} data-testid="my-change-password-btn">
            <KeyRound className="h-4 w-4 mr-2" /> My Password
          </Button>
          <Button style={{ backgroundColor: '#4a9fd8' }} onClick={() => setCreateOpen(true)} data-testid="add-user-btn">
            <UserPlus className="mr-2 h-4 w-4" /> Add User
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-6"><div className="flex items-center justify-between"><div><p className="text-sm text-gray-600">Total Users</p><p className="text-3xl font-bold">{users.length}</p></div><UsersIcon className="h-8 w-8 text-blue-500" /></div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="flex items-center justify-between"><div><p className="text-sm text-gray-600">Active</p><p className="text-3xl font-bold text-green-600">{activeCount}</p></div><Power className="h-8 w-8 text-green-500" /></div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="flex items-center justify-between"><div><p className="text-sm text-gray-600">Admins</p><p className="text-3xl font-bold text-purple-600">{adminCount}</p></div><Shield className="h-8 w-8 text-purple-500" /></div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="flex items-center justify-between"><div><p className="text-sm text-gray-600">Clients</p><p className="text-3xl font-bold text-blue-600">{clientCount}</p></div><UsersIcon className="h-8 w-8 text-blue-500" /></div></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>All Users</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center py-8 text-gray-500">Loading…</p>
          ) : users.length === 0 ? (
            <p className="text-center py-8 text-gray-500">No users yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full" data-testid="users-table">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-3">Name</th>
                    <th className="text-left p-3">Email</th>
                    <th className="text-left p-3">Role</th>
                    <th className="text-left p-3">Status</th>
                    <th className="text-left p-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b hover:bg-gray-50">
                      <td className="p-3 font-medium">{u.full_name || '—'}</td>
                      <td className="p-3 text-gray-600">{u.email}</td>
                      <td className="p-3"><Badge className={u.role === 'admin' ? 'bg-purple-500' : 'bg-blue-500'}>{u.role}</Badge></td>
                      <td className="p-3"><Badge className={u.is_active ? 'bg-green-500' : 'bg-gray-500'}>{u.is_active ? 'Active' : 'Inactive'}</Badge></td>
                      <td className="p-3">
                        <div className="flex gap-2 flex-wrap">
                          <Button size="sm" variant="outline" onClick={() => openEdit(u)} data-testid={`edit-user-${u.id}`}>
                            Edit
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => { setPwTarget(u); setPwOpen(true); }} data-testid={`reset-pw-${u.id}`}>
                            <KeyRound className="h-3 w-3 mr-1" /> Reset PW
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => toggleStatus(u)} data-testid={`toggle-status-${u.id}`}>
                            <Power className="h-3 w-3 mr-1" /> {u.is_active ? 'Deactivate' : 'Activate'}
                          </Button>
                          {u.id !== me?.id && (
                            <Button size="sm" variant="outline" className="text-red-600 border-red-600" onClick={() => deleteUser(u)} data-testid={`delete-user-${u.id}`}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
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

      {/* Create User Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create New User</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Email</Label><Input type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} data-testid="new-user-email" /></div>
            <div><Label>Full Name</Label><Input value={newUser.full_name} onChange={(e) => setNewUser({ ...newUser, full_name: e.target.value })} data-testid="new-user-name" /></div>
            <div><Label>Password (min 8 chars)</Label><Input type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} data-testid="new-user-password" /></div>
            <div>
              <Label>Role</Label>
              <select className="w-full border rounded px-3 py-2" value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })} data-testid="new-user-role">
                <option value="client">Client</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div><Label>Company (optional)</Label><Input value={newUser.company_name} onChange={(e) => setNewUser({ ...newUser, company_name: e.target.value })} /></div>
            <div><Label>Phone (optional)</Label><Input value={newUser.phone} onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Location Name</Label><Input value={newUser.location_name} onChange={(e) => setNewUser({ ...newUser, location_name: e.target.value })} placeholder="e.g. Plant A" data-testid="new-user-location-name" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Latitude</Label><Input value={newUser.latitude} onChange={(e) => setNewUser({ ...newUser, latitude: e.target.value })} placeholder="26.8467" data-testid="new-user-latitude" /></div>
                <div><Label>Longitude</Label><Input value={newUser.longitude} onChange={(e) => setNewUser({ ...newUser, longitude: e.target.value })} placeholder="80.9462" data-testid="new-user-longitude" /></div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} data-testid="create-user-submit">Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit User — {editTarget?.email}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Full Name</Label><Input value={editForm.full_name} onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })} data-testid="edit-user-name" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Role</Label>
                <select className="w-full border rounded px-3 py-2" value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: e.target.value })} data-testid="edit-user-role" disabled={editTarget?.id === me?.id}>
                  <option value="client">Client</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div><Label>Phone</Label><Input value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} /></div>
            </div>
            <div><Label>Company</Label><Input value={editForm.company_name} onChange={(e) => setEditForm({ ...editForm, company_name: e.target.value })} /></div>
            <div><Label>Location Name</Label><Input value={editForm.location_name} onChange={(e) => setEditForm({ ...editForm, location_name: e.target.value })} data-testid="edit-user-location-name" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Latitude</Label><Input value={editForm.latitude} onChange={(e) => setEditForm({ ...editForm, latitude: e.target.value })} placeholder="26.8467" data-testid="edit-user-latitude" /></div>
              <div><Label>Longitude</Label><Input value={editForm.longitude} onChange={(e) => setEditForm({ ...editForm, longitude: e.target.value })} placeholder="80.9462" data-testid="edit-user-longitude" /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleEdit} data-testid="edit-user-submit">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Admin reset password */}
      <Dialog open={pwOpen} onOpenChange={setPwOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reset Password — {pwTarget?.email}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Label>New Password (min 8 chars)</Label>
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} data-testid="reset-pw-input" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwOpen(false)}>Cancel</Button>
            <Button onClick={handleAdminResetPassword} data-testid="reset-pw-submit">Update</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Self change password */}
      <Dialog open={selfPwOpen} onOpenChange={setSelfPwOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Change My Password</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Current Password</Label><Input type="password" value={selfPw.current_password} onChange={(e) => setSelfPw({ ...selfPw, current_password: e.target.value })} /></div>
            <div><Label>New Password (min 8 chars)</Label><Input type="password" value={selfPw.new_password} onChange={(e) => setSelfPw({ ...selfPw, new_password: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelfPwOpen(false)}>Cancel</Button>
            <Button onClick={handleSelfChangePassword}>Update</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UserPage;
