import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../components/ui/dialog';
import { Users as UsersIcon, UserPlus, Shield, KeyRound, Power, Trash2, Cpu, Plus, ChevronLeft, ChevronRight, Check, MapPin } from 'lucide-react';
import api, { formatApiError } from '../lib/api';
import { isAdmin, getCurrentUser } from '../mockData';
import { toast } from 'sonner';
import SubUserCard from '../components/SubUserCard';
import RenewalsCard from '../components/RenewalsCard';
import MapLocationPicker from '../components/MapLocationPicker';
import ViewPermissionsDialog from '../components/ViewPermissionsDialog';
import { InstrumentRowCard } from '../components/user/InstrumentRowCard';
import { INSTRUMENT_TYPE_OPTIONS, DEFAULT_SOURCE, FLOWMETER_CATEGORY_OPTIONS, EMPTY_INSTRUMENT_ROW } from '../components/user/userInstrumentOptions';

// `permissions` on a user record can be either an array (legacy client
// permissions like ['view_water_quality']) or an object (per-page toggle
// map like {dashboard: true, reports: false, ...}). This helper normalises
// both shapes so `.includes()` never throws.
const hasPermission = (perms, key) => {
  if (Array.isArray(perms)) return perms.includes(key);
  if (perms && typeof perms === 'object') return Boolean(perms[key]);
  return false;
};

const UserPage = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const me = getCurrentUser();
  const admin = isAdmin();

  // Create user state — 2-step wizard
  const [createOpen, setCreateOpen] = useState(false);
  const [createStep, setCreateStep] = useState(1); // 1 = user info, 2 = instruments
  const [creating, setCreating] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', username: '', password: '', full_name: '', role: 'client', company_name: '', phone: '', location_name: '', latitude: '', longitude: '', notification_email_1: '', notification_email_2: '' });
  const [newInstruments, setNewInstruments] = useState([]); // list of instrument row objects
  // Map-picker state — shared modal, opened per row / for the user home location.
  // `target` is either { type: 'user' } or { type: 'instrument', idx }.
  const [mapPickerOpen, setMapPickerOpen] = useState(false);
  const [mapPickerTarget, setMapPickerTarget] = useState(null);

  // Edit user state
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({ full_name: '', company_name: '', phone: '', location_name: '', latitude: '', longitude: '', role: 'client', notification_email_1: '', notification_email_2: '' });

  // Change password modal
  const [pwOpen, setPwOpen] = useState(false);
  const [pwTarget, setPwTarget] = useState(null);
  const [newPassword, setNewPassword] = useState('');

  // Self-change password modal
  const [selfPwOpen, setSelfPwOpen] = useState(false);
  const [selfPw, setSelfPw] = useState({ current_password: '', new_password: '' });

  // View-permissions dialog — extracted to ViewPermissionsDialog.jsx.
  // Holds the client whose access matrix is being edited (null = closed).
  const [vpTarget, setVpTarget] = useState(null);
  const openViewPermissions = (u) => setVpTarget(u);

  // "Send test alert" — in-flight user id (disables the button while sending)
  const [testingUserId, setTestingUserId] = useState(null);

  const handleSendTestAlert = useCallback(async (userId) => {
    if (!userId) return;
    setTestingUserId(userId);
    try {
      const { data } = await api.post(`/api/notifications/test-user/${userId}`);
      if (data?.sent) {
        toast.success(`Test alert sent to ${data.recipient_count || 1} recipient${(data.recipient_count || 1) === 1 ? '' : 's'}.`);
      } else if (data?.reason === 'rate_limited') {
        toast.warning(`Please wait ${data.retry_after_seconds || 60}s before sending another test.`);
      } else {
        toast.error(`Not sent — ${data?.reason || 'unknown error'}`);
      }
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    } finally {
      setTestingUserId(null);
    }
  }, []);

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

  const resetCreateWizard = () => {
    setCreateOpen(false);
    setCreateStep(1);
    setNewUser({ email: '', password: '', full_name: '', role: 'client', company_name: '', phone: '', location_name: '', latitude: '', longitude: '', notification_email_1: '', notification_email_2: '' });
    setNewInstruments([]);
  };

  const validateStep1 = () => {
    if (!newUser.email?.trim()) { toast.error('Email is required'); return false; }
    if (!newUser.full_name?.trim()) { toast.error('Full name is required'); return false; }
    if (!newUser.password || newUser.password.length < 8) { toast.error('Password must be at least 8 characters'); return false; }
    return true;
  };

  const addInstrumentRow = () => {
    // Default location from user's location for convenience
    setNewInstruments([
      ...newInstruments,
      {
        ...EMPTY_INSTRUMENT_ROW,
        location_name: newUser.location_name || '',
        latitude: newUser.latitude || '',
        longitude: newUser.longitude || '',
      },
    ]);
  };

  const updateInstrumentRow = (idx, patch) => {
    setNewInstruments((rows) => rows.map((r, i) => {
      if (i !== idx) return r;
      const merged = { ...r, ...patch };
      // When the type flips, apply sensible defaults so QESPL-polled DO/OCEMS
      // devices don't get stuck on 'mqtt' + numeric IMEI validation.
      if (patch.instrument_type && patch.instrument_type !== r.instrument_type) {
        merged.source = DEFAULT_SOURCE[patch.instrument_type] || 'mqtt';
        if (patch.instrument_type !== 'do_meter') merged.aeration_tank_number = '';
        if (patch.instrument_type !== 'flowmeter') merged.category = '';
      }
      return merged;
    }));
  };

  const removeInstrumentRow = (idx) => {
    setNewInstruments((rows) => rows.filter((_, i) => i !== idx));
  };

  const validateInstruments = () => {
    const seen = new Set();
    const seenImei = new Set();
    for (let i = 0; i < newInstruments.length; i += 1) {
      const it = newInstruments[i];
      const hw = it.hardware_id?.trim();
      if (!hw) { toast.error(`Instrument #${i + 1}: Hardware ID is required`); return false; }
      if (seen.has(hw)) { toast.error(`Instrument #${i + 1}: Duplicate Hardware ID "${hw}"`); return false; }
      seen.add(hw);
      const imei = it.imei?.trim();
      if (imei) {
        // No format restriction — accept any non-empty alphanumeric id.
        // MQTT modems produce numeric IMEIs; QESPL and other vendors use
        // mixed-case ids like `DTU10020426`. Some carriers even include
        // dashes/dots. Duplicate check is the only real safety net.
        if (seenImei.has(imei)) { toast.error(`Instrument #${i + 1}: Duplicate IMEI/deviceId "${imei}"`); return false; }
        seenImei.add(imei);
      }
    }
    return true;
  };

  const handleCreate = async () => {
    if (!validateStep1()) return;
    if (!validateInstruments()) return;
    setCreating(true);
    let createdUser = null;
    try {
      const payload = { ...newUser };
      if (payload.latitude === '' || payload.latitude == null) delete payload.latitude;
      else payload.latitude = parseFloat(payload.latitude);
      if (payload.longitude === '' || payload.longitude == null) delete payload.longitude;
      else payload.longitude = parseFloat(payload.longitude);
      // Username is optional — drop if the admin left it blank so the
      // backend derives it from the email local-part.
      if (!payload.username || !String(payload.username).trim()) delete payload.username;
      // Pack the two admin-configurable alert-emails into a list. Empty
      // strings are dropped; up to 2 are sent.
      const notifEmails = [payload.notification_email_1, payload.notification_email_2]
        .map((e) => (e || '').trim())
        .filter(Boolean)
        .slice(0, 2);
      delete payload.notification_email_1;
      delete payload.notification_email_2;
      if (notifEmails.length) payload.notification_emails = notifEmails;
      const { data: userRes } = await api.post('/api/admin/users/create', payload);
      createdUser = userRes?.user;
      if (!createdUser?.id) {
        throw new Error('User created but no id was returned');
      }

      // Register each instrument under the new user as owner
      const results = { ok: 0, fail: 0, errors: [] };
      for (const row of newInstruments) {
        const ipayload = {
          hardware_id: row.hardware_id.trim(),
          instrument_type: row.instrument_type,
          owner_user_id: createdUser.id,
          label: row.label?.trim() || row.hardware_id.trim(),
          location_name: row.location_name?.trim() || null,
          latitude: row.latitude === '' || row.latitude == null ? null : parseFloat(row.latitude),
          longitude: row.longitude === '' || row.longitude == null ? null : parseFloat(row.longitude),
        };
        if (row.instrument_type === 'flowmeter') ipayload.category = row.category || 'groundwater_abstraction';
        const imei = row.imei?.trim();
        if (imei) ipayload.imei = imei;
        if (row.instrument_type === 'dwlr') {
          const tv = String(row.manual_water_temp_c ?? '').trim();
          if (tv !== '') {
            const n = parseFloat(tv);
            if (!Number.isNaN(n)) ipayload.manual_water_temp_c = n;
          }
        }
        // Source (mqtt | http) — required for QESPL-polled devices
        if (row.source && ['mqtt', 'http'].includes(row.source)) {
          ipayload.source = row.source;
        }
        // Aeration tank number (DO Analyzer only)
        if (row.instrument_type === 'do_meter' && row.aeration_tank_number !== '' && row.aeration_tank_number != null) {
          const n = parseInt(row.aeration_tank_number, 10);
          if (!Number.isNaN(n) && n > 0) ipayload.aeration_tank_number = n;
        }
        // Plant / tank capacity (WQ, DO, Chlorine)
        if (['wq_stp', 'do_meter', 'chlorine_analyzer'].includes(row.instrument_type)) {
          for (const k of ['plant_capacity_kld', 'tank_capacity_kld']) {
            const v = String(row[k] ?? '').trim();
            if (v !== '') {
              const n = parseFloat(v);
              if (!Number.isNaN(n)) ipayload[k] = n;
            }
          }
        }
        try {
          await api.post('/api/instrument-registry', ipayload);
          results.ok += 1;
        } catch (e) {
          results.fail += 1;
          results.errors.push(`${row.hardware_id}: ${formatApiError(e?.response?.data?.detail)}`);
        }
      }

      if (results.fail === 0) {
        toast.success(
          newInstruments.length
            ? `User created with ${results.ok} instrument${results.ok === 1 ? '' : 's'}`
            : 'User created'
        );
      } else {
        toast.warning(
          `User created. ${results.ok}/${newInstruments.length} instruments registered. Failed: ${results.errors.slice(0, 2).join('; ')}`
        );
      }
      resetCreateWizard();
      fetchUsers();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail || e?.message || 'Failed to create user'));
    } finally {
      setCreating(false);
    }
  };

  const openEdit = (u) => {
    setEditTarget(u);
    const notifs = Array.isArray(u.notification_emails) ? u.notification_emails : [];
    setEditForm({
      full_name: u.full_name || '',
      company_name: u.company_name || '',
      phone: u.phone || '',
      location_name: u.location_name || '',
      latitude: u.latitude != null ? String(u.latitude) : '',
      longitude: u.longitude != null ? String(u.longitude) : '',
      role: u.role || 'client',
      notification_email_1: notifs[0] || '',
      notification_email_2: notifs[1] || '',
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
      // Build the notification_emails list — we always send it (even empty)
      // so the admin can explicitly clear the two alert emails.
      const notifEmails = [payload.notification_email_1, payload.notification_email_2]
        .map((e) => (e || '').trim())
        .filter(Boolean)
        .slice(0, 2);
      delete payload.notification_email_1;
      delete payload.notification_email_2;
      payload.notification_emails = notifEmails;
      // Drop empties so we don't overwrite with null on string fields
      Object.keys(payload).forEach((k) => {
        if (k === 'notification_emails') return; // preserve empty list
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
                    <th className="text-left p-3">Location</th>
                    <th className="text-left p-3">Status</th>
                    <th className="text-left p-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b hover:bg-gray-50">
                      <td className="p-3 font-medium">{u.full_name || '—'}</td>
                      <td className="p-3 text-gray-600">
                        {u.username && <div className="font-mono text-xs text-blue-700">{u.username}</div>}
                        <div className="text-[11px] text-gray-500">{u.email}</div>
                      </td>
                      <td className="p-3"><Badge className={u.role === 'admin' ? 'bg-purple-500' : 'bg-blue-500'}>{u.role}</Badge></td>
                      <td className="p-3 text-gray-600 text-xs">
                        {u.location_name ? <span className="font-medium">{u.location_name}</span> : <span className="text-gray-400">—</span>}
                        {u.latitude != null && u.longitude != null && (
                          <div className="text-gray-400 mt-0.5">{Number(u.latitude).toFixed(4)}, {Number(u.longitude).toFixed(4)}</div>
                        )}
                      </td>
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
                          {u.role !== 'admin' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-sky-500 text-sky-700"
                              onClick={() => openViewPermissions(u)}
                              data-testid={`view-perms-${u.id}`}
                            >
                              <Shield className="h-3 w-3 mr-1" /> View Access
                            </Button>
                          )}
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

      <SubUserCard />

      <RenewalsCard />

      {/* Create User Dialog — 2-step wizard */}
      <Dialog open={createOpen} onOpenChange={(o) => (o ? setCreateOpen(true) : resetCreateWizard())}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {createStep === 1 ? 'Create New User — Step 1 of 2' : 'Add Instruments — Step 2 of 2'}
            </DialogTitle>
            <DialogDescription>
              {createStep === 1
                ? 'Enter the client account details. You will assign instruments in the next step.'
                : 'Register the IoT devices installed at this client location. The user will only see and receive alerts for these instruments.'}
            </DialogDescription>
          </DialogHeader>

          {/* Step indicator */}
          <div className="flex items-center gap-2 text-xs">
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full ${createStep === 1 ? 'bg-blue-600 text-white' : 'bg-green-600 text-white'}`}>
              {createStep > 1 ? <Check className="h-3 w-3" /> : <span className="font-bold">1</span>} User Info
            </div>
            <div className="h-px flex-1 bg-gray-300" />
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full ${createStep === 2 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'}`}>
              <span className="font-bold">2</span> Instruments
            </div>
          </div>

          {createStep === 1 ? (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Email *</Label><Input type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} data-testid="new-user-email" /></div>
                <div>
                  <Label>Username <span className="text-[10px] text-gray-500 font-normal">(unique login handle)</span></Label>
                  <Input
                    value={newUser.username}
                    onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                    placeholder="e.g. shalimar-lake, plant$north, hotel_1"
                    data-testid="new-user-username"
                  />
                  <p className="text-[10px] text-gray-500 mt-1">3–30 chars · letters, digits, and any of <code>. _ - + ! $ @</code>. Leave blank to auto-derive from email.</p>
                </div>
                <div><Label>Full Name *</Label><Input value={newUser.full_name} onChange={(e) => setNewUser({ ...newUser, full_name: e.target.value })} data-testid="new-user-name" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Password * (min 8 chars)</Label><Input type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} data-testid="new-user-password" /></div>
                <div>
                  <Label>Role</Label>
                  <select className="w-full border rounded px-3 py-2" value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })} data-testid="new-user-role">
                    <option value="client">Client</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Company</Label><Input value={newUser.company_name} onChange={(e) => setNewUser({ ...newUser, company_name: e.target.value })} /></div>
                <div><Label>Phone</Label><Input value={newUser.phone} onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })} /></div>
              </div>
              <div><Label>Location Name</Label><Input value={newUser.location_name} onChange={(e) => setNewUser({ ...newUser, location_name: e.target.value })} placeholder="e.g. Plant A" data-testid="new-user-location-name" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Latitude</Label><Input value={newUser.latitude} onChange={(e) => setNewUser({ ...newUser, latitude: e.target.value })} placeholder="26.8467" data-testid="new-user-latitude" /></div>
                <div><Label>Longitude</Label><Input value={newUser.longitude} onChange={(e) => setNewUser({ ...newUser, longitude: e.target.value })} placeholder="80.9462" data-testid="new-user-longitude" /></div>
              </div>
              <div>
                <Button type="button" variant="outline" size="sm" onClick={() => { setMapPickerTarget({ type: 'user' }); setMapPickerOpen(true); }} data-testid="new-user-pick-map">
                  <MapPin className="h-3.5 w-3.5 mr-1" /> Pick user location on map
                </Button>
              </div>
              {/* Admin-managed alert email addresses — the client cannot edit
                  these themselves. Up to 2 additional recipients receive the
                  offline-device email in addition to the client's login email. */}
              <div className="rounded border bg-amber-50/50 p-2.5 border-amber-200">
                <div className="text-xs font-semibold text-amber-900 mb-1.5">Offline-alert recipients (admin-only)</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Alert email #1</Label>
                    <Input type="email" value={newUser.notification_email_1}
                           onChange={(e) => setNewUser({ ...newUser, notification_email_1: e.target.value })}
                           placeholder="ops1@client.com" data-testid="new-user-notify-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Alert email #2</Label>
                    <Input type="email" value={newUser.notification_email_2}
                           onChange={(e) => setNewUser({ ...newUser, notification_email_2: e.target.value })}
                           placeholder="ops2@client.com" data-testid="new-user-notify-2" />
                  </div>
                </div>
                <p className="text-[10px] text-amber-800 mt-1">Both are optional. Alerts fire when any of this client&apos;s devices have not transmitted for 2+ hours.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
              <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-md p-2.5">
                <div className="text-xs text-blue-900">
                  <strong>{newUser.full_name || newUser.email}</strong> · {newUser.location_name || 'no location set'}
                </div>
                <Button type="button" size="sm" variant="outline" onClick={addInstrumentRow} data-testid="add-instrument-row-btn">
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add Instrument
                </Button>
              </div>

              {newInstruments.length === 0 ? (
                <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-lg">
                  <Cpu className="h-10 w-10 mx-auto text-gray-300" />
                  <p className="text-sm text-gray-600 mt-2">No instruments added yet.</p>
                  <p className="text-xs text-gray-500 mt-1">Click <strong>Add Instrument</strong> to register devices for this user. You can also skip this step and add instruments later from the Instruments page.</p>
                </div>
              ) : (
                newInstruments.map((row, idx) => (
                  <InstrumentRowCard
                    key={idx} row={row} idx={idx}
                    onUpdate={updateInstrumentRow} onRemove={removeInstrumentRow}
                    onPickMap={(i) => { setMapPickerTarget({ type: 'instrument', idx: i }); setMapPickerOpen(true); }}
                  />
                ))
              )}
            </div>
          )}

          <DialogFooter className="flex justify-between sm:justify-between gap-2">
            <div>
              {createStep === 2 && (
                <Button variant="outline" onClick={() => setCreateStep(1)} disabled={creating} data-testid="wizard-back-btn">
                  <ChevronLeft className="h-4 w-4 mr-1" /> Back
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={resetCreateWizard} disabled={creating}>Cancel</Button>
              {createStep === 1 ? (
                <Button onClick={() => { if (validateStep1()) setCreateStep(2); }} style={{ backgroundColor: '#4a9fd8' }} data-testid="wizard-next-btn">
                  Next <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              ) : (
                <Button onClick={handleCreate} disabled={creating} style={{ backgroundColor: '#4a9fd8' }} data-testid="create-user-submit">
                  {creating
                    ? 'Creating…'
                    : newInstruments.length
                      ? `Create User & ${newInstruments.length} Instrument${newInstruments.length === 1 ? '' : 's'}`
                      : 'Create User (Skip Instruments)'}
                </Button>
              )}
            </div>
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
            <div className="rounded border bg-amber-50/50 p-2.5 border-amber-200">
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-xs font-semibold text-amber-900">Offline-alert recipients (admin-only)</div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px] border-amber-400 text-amber-900 hover:bg-amber-100"
                  onClick={() => handleSendTestAlert(editTarget?.id)}
                  disabled={!editTarget?.id || testingUserId === editTarget?.id}
                  data-testid="edit-user-send-test-alert"
                >
                  {testingUserId === editTarget?.id ? 'Sending…' : 'Test alert now'}
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Alert email #1</Label>
                  <Input type="email" value={editForm.notification_email_1}
                         onChange={(e) => setEditForm({ ...editForm, notification_email_1: e.target.value })}
                         placeholder="ops1@client.com" data-testid="edit-user-notify-1" />
                </div>
                <div>
                  <Label className="text-xs">Alert email #2</Label>
                  <Input type="email" value={editForm.notification_email_2}
                         onChange={(e) => setEditForm({ ...editForm, notification_email_2: e.target.value })}
                         placeholder="ops2@client.com" data-testid="edit-user-notify-2" />
                </div>
              </div>
              <p className="text-[10px] text-amber-800 mt-1">Both are optional. Leave blank to remove existing recipients. <span className="italic">Test sends a one-liner to the login email + saved recipients (max 1/min).</span></p>
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

      {/* View Permissions dialog — pages + device-type visibility matrix */}
      <ViewPermissionsDialog user={vpTarget} onClose={() => setVpTarget(null)} onSaved={fetchUsers} />

      {/* Shared map picker — captures lat/lng for either the user home location
          or a specific instrument row. */}
      <MapLocationPicker
        open={mapPickerOpen}
        onClose={() => { setMapPickerOpen(false); setMapPickerTarget(null); }}
        initialLat={mapPickerTarget?.type === 'instrument' ? newInstruments[mapPickerTarget.idx]?.latitude : newUser.latitude}
        initialLng={mapPickerTarget?.type === 'instrument' ? newInstruments[mapPickerTarget.idx]?.longitude : newUser.longitude}
        title={mapPickerTarget?.type === 'instrument' ? `Pick location for Instrument #${(mapPickerTarget.idx ?? 0) + 1}` : 'Pick user location'}
        onPick={(la, lo) => {
          if (mapPickerTarget?.type === 'instrument') {
            updateInstrumentRow(mapPickerTarget.idx, { latitude: String(la), longitude: String(lo) });
          } else {
            setNewUser((u) => ({ ...u, latitude: String(la), longitude: String(lo) }));
          }
        }}
      />
    </div>
  );
};

export default UserPage;
