import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Textarea } from '../components/ui/textarea';
import {
  Building2, Upload, Save, RefreshCw, Loader2, ShieldCheck, CalendarClock, MapPin, Users, Droplets, Cpu, FileBadge, Mail, Phone, User,
} from 'lucide-react';
import api, { formatApiError } from '../lib/api';
import { isAdmin } from '../mockData';
import { toast } from 'sonner';

const emptyForm = {
  customer_name: '', site_name: '', unit_name: '', address: '',
  representative_name: '', representative_designation: '',
  representative_email: '', representative_phone: '',
  noc_mode: 'single',
  noc_number: '', noc_issue_date: '', noc_validity_years: '', noc_expiry_date: '',
  cto_number: '', cto_issue_date: '', cto_expiry_date: '',
  boreholes_permitted: '', abstraction_borewells_count: '',
  permitted_daily_kl: '', permitted_yearly_kl: '',
  piezometers_count: '', rwh_structure_count: '', rwh_catchment_area_sqm: '',
  notes: '',
};

const fmtDate = (s) => (s ? new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

const Section = ({ title, icon: Icon, children }) => (
  <Card>
    <CardHeader className="pb-3">
      <CardTitle className="flex items-center gap-2 text-base">
        {Icon && <Icon className="h-4 w-4 text-slate-500" />} {title}
      </CardTitle>
    </CardHeader>
    <CardContent>{children}</CardContent>
  </Card>
);

const Field = ({ label, value, unit }) => (
  <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-dashed border-gray-100 last:border-0">
    <span className="text-xs uppercase tracking-wide text-gray-500">{label}</span>
    <span className="text-sm font-medium text-gray-800 text-right">
      {value ?? <span className="italic text-gray-400">—</span>}
      {unit && value != null ? <span className="ml-1 text-xs text-gray-500">{unit}</span> : null}
    </span>
  </div>
);

const CustomerProfile = () => {
  const admin = isAdmin();
  const [users, setUsers] = useState([]);   // admin picker options
  const [selectedId, setSelectedId] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [logoTs, setLogoTs] = useState(Date.now()); // cache-buster
  const logoFileRef = useRef(null);

  const loadUsers = useCallback(async () => {
    if (!admin) return;
    try {
      const { data } = await api.get('/api/customer-profile/list');
      setUsers(data.users || []);
      if ((data.users || []).length && !selectedId) setSelectedId(data.users[0].id);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Failed to load users');
    }
  }, [admin, selectedId]);

  const loadProfile = useCallback(async (uid) => {
    setLoading(true);
    try {
      const url = admin && uid ? `/api/customer-profile/${uid}` : '/api/customer-profile';
      const { data } = await api.get(url);
      setProfile(data);
      setForm({
        ...emptyForm,
        ...Object.fromEntries(Object.keys(emptyForm).map((k) => [k, data?.[k] ?? ''])),
      });
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Failed to load profile');
    } finally { setLoading(false); }
  }, [admin]);

  useEffect(() => { loadUsers(); }, [loadUsers]);
  useEffect(() => {
    if (admin) {
      if (selectedId) loadProfile(selectedId);
    } else {
      loadProfile();
    }
  }, [admin, selectedId, loadProfile]);

  const handleSave = async () => {
    if (!admin || !profile?.id) return;
    setSaving(true);
    try {
      // Convert empty strings to null and numeric-looking fields to numbers.
      const payload = {};
      const numericFields = new Set([
        'noc_validity_years', 'boreholes_permitted', 'abstraction_borewells_count',
        'permitted_daily_kl', 'permitted_yearly_kl', 'piezometers_count',
        'rwh_structure_count', 'rwh_catchment_area_sqm',
      ]);
      for (const [k, v] of Object.entries(form)) {
        if (v === '' || v === undefined) { payload[k] = null; continue; }
        if (numericFields.has(k)) {
          const n = Number(v);
          payload[k] = Number.isFinite(n) ? n : null;
        } else {
          payload[k] = v;
        }
      }
      const { data } = await api.put(`/api/customer-profile/${profile.id}`, payload);
      setProfile(data);
      toast.success('Profile updated');
      setEditing(false);
      loadUsers();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Save failed');
    } finally { setSaving(false); }
  };

  const handleLogoUpload = async (e) => {
    if (!admin || !profile?.id) return;
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/image\/jpe?g/i.test(file.type)) { toast.error('JPEG only'); e.target.value = ''; return; }
    setUploadingLogo(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.post(`/api/customer-profile/${profile.id}/logo`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('Logo uploaded');
      setLogoTs(Date.now());
      loadProfile(profile.id);
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || 'Upload failed');
    } finally {
      setUploadingLogo(false);
      if (e.target) e.target.value = '';
    }
  };

  const logoUrl = useMemo(() => {
    if (!profile?.logo_path) return null;
    const backend = process.env.REACT_APP_BACKEND_URL || '';
    return `${backend}/api/customer-profile/logo/${profile.logo_path}?t=${logoTs}`;
  }, [profile, logoTs]);

  const authHeader = useMemo(() => {
    try { return `Bearer ${JSON.parse(localStorage.getItem('user') || '{}').token || ''}`; } catch { return ''; }
  }, []);

  // The logo needs an Authorization header, so we fetch it via api instead
  // of using the URL directly in <img src>. Store as blob URL.
  const [logoBlobUrl, setLogoBlobUrl] = useState(null);
  useEffect(() => {
    let revoke = null;
    (async () => {
      if (!profile?.logo_path) { setLogoBlobUrl(null); return; }
      try {
        const res = await api.get(`/api/customer-profile/logo/${profile.logo_path}?t=${logoTs}`, { responseType: 'blob' });
        const url = URL.createObjectURL(res.data);
        revoke = url;
        setLogoBlobUrl(url);
      } catch { setLogoBlobUrl(null); }
    })();
    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, [profile?.logo_path, logoTs, authHeader]);

  if (loading && !profile) {
    return <div className="p-6 text-center text-gray-500"><Loader2 className="h-6 w-6 mx-auto animate-spin" /><p className="mt-2 text-sm">Loading profile…</p></div>;
  }
  if (!profile) return <div className="p-6 text-center text-gray-500">No profile available.</div>;

  const instrumentsByType = profile.instruments_by_type || {};

  return (
    <div className="p-6 space-y-6" data-testid="customer-profile-page">
      {/* Header */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-6 py-6">
          <div className="h-24 w-24 rounded-lg bg-gray-100 border flex items-center justify-center overflow-hidden shrink-0">
            {logoBlobUrl ? (
              <img src={logoBlobUrl} alt="Company logo" className="h-full w-full object-contain" />
            ) : (
              <Building2 className="h-10 w-10 text-gray-400" />
            )}
          </div>
          <div className="flex-1 min-w-[240px]">
            <h1 className="text-2xl font-bold text-gray-900">{profile.customer_name || profile.full_name || profile.email}</h1>
            <p className="text-sm text-gray-600 flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
              {profile.site_name && <span>{profile.site_name}</span>}
              {profile.unit_name && <><span className="text-gray-300">·</span><span>{profile.unit_name}</span></>}
              {profile.role && <><span className="text-gray-300">·</span><Badge variant="outline" className="capitalize">{profile.role}</Badge></>}
            </p>
            {profile.address && <p className="text-xs text-gray-500 mt-1 flex items-start gap-1"><MapPin className="h-3 w-3 mt-0.5 shrink-0" /> {profile.address}</p>}
          </div>
          {admin && (
            <div className="flex flex-wrap items-center gap-3">
              <select
                className="border rounded px-3 py-2 text-sm"
                value={selectedId || ''}
                onChange={(e) => { setSelectedId(e.target.value); setEditing(false); }}
                data-testid="cp-user-picker"
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.customer_name || u.full_name || u.email}{u.unit_name ? ` — ${u.unit_name}` : ''}
                  </option>
                ))}
              </select>
              <Button variant="outline" onClick={() => logoFileRef.current?.click()} disabled={uploadingLogo} data-testid="cp-logo-upload-btn">
                {uploadingLogo ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Uploading…</> : <><Upload className="h-4 w-4 mr-2" /> Upload logo (JPEG)</>}
              </Button>
              <input ref={logoFileRef} type="file" accept="image/jpeg,.jpg,.jpeg" className="hidden" onChange={handleLogoUpload} />
              {!editing ? (
                <Button onClick={() => setEditing(true)} data-testid="cp-edit-btn">Edit profile</Button>
              ) : (
                <>
                  <Button variant="outline" onClick={() => { setEditing(false); loadProfile(profile.id); }} disabled={saving}>Cancel</Button>
                  <Button onClick={handleSave} disabled={saving} data-testid="cp-save-btn">
                    {saving ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Saving…</> : <><Save className="h-4 w-4 mr-2" /> Save</>}
                  </Button>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {!editing ? (
        <ReadOnlyView profile={profile} instrumentsByType={instrumentsByType} />
      ) : (
        <EditForm form={form} setForm={setForm} />
      )}
    </div>
  );
};

// -------------------- Read-only presentation --------------------------
const ReadOnlyView = ({ profile, instrumentsByType }) => (
  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
    <Section title="Customer details" icon={Building2}>
      <Field label="Customer name (per CTO / NOC)" value={profile.customer_name} />
      <Field label="Site name" value={profile.site_name} />
      <Field label="Unit name" value={profile.unit_name} />
      <Field label="Full address" value={profile.address} />
    </Section>

    <Section title="Representative" icon={User}>
      <Field label="Name" value={profile.representative_name} />
      <Field label="Designation" value={profile.representative_designation} />
      <Field label="Email" value={profile.representative_email ? <a className="text-blue-600 underline" href={`mailto:${profile.representative_email}`}><Mail className="h-3 w-3 inline mr-1" />{profile.representative_email}</a> : null} />
      <Field label="Contact number" value={profile.representative_phone ? <a className="text-blue-600 underline" href={`tel:${profile.representative_phone}`}><Phone className="h-3 w-3 inline mr-1" />{profile.representative_phone}</a> : null} />
    </Section>

    <Section title="Groundwater NOC" icon={ShieldCheck}>
      <Field label="NOC number" value={profile.noc_number} />
      <Field label="Issue date" value={profile.noc_issue_date ? fmtDate(profile.noc_issue_date) : null} />
      <Field label="Validity (years)" value={profile.noc_validity_years} />
      <Field label="Expiry date" value={profile.noc_expiry_date ? fmtDate(profile.noc_expiry_date) : null} />
    </Section>

    <Section title="Consent to Operate (CTO)" icon={FileBadge}>
      <Field label="CTO number" value={profile.cto_number} />
      <Field label="Issue date" value={profile.cto_issue_date ? fmtDate(profile.cto_issue_date) : null} />
      <Field label="Expiry date" value={profile.cto_expiry_date ? fmtDate(profile.cto_expiry_date) : null} />
    </Section>

    <Section title="Groundwater usage permissions" icon={Droplets}>
      <Field label="NOC mode" value={profile.noc_mode === 'per_borewell' ? 'One NOC per borewell (e.g. Uttar Pradesh)' : 'Single NOC covers all borewells (e.g. Rajasthan)'} />
      <Field label="Borewell permitted" value={profile.boreholes_permitted} />
      <Field label="Abstraction borewells" value={profile.abstraction_borewells_count} />
      <Field label="Permitted daily withdrawal" value={profile.permitted_daily_kl} unit="KLD" />
      <Field label="Permitted yearly withdrawal" value={profile.permitted_yearly_kl} unit="KL/year" />
      <Field label="Piezometers installed" value={profile.piezometers_count} />
    </Section>

    <Section title="Rainwater harvesting" icon={CalendarClock}>
      <Field label="Number of structures" value={profile.rwh_structure_count} />
      <Field label="Total catchment area" value={profile.rwh_catchment_area_sqm} unit="m²" />
    </Section>

    <Section title="Instruments installed" icon={Cpu}>
      <p className="text-sm text-gray-700 mb-2">
        Total installed: <span className="font-semibold">{profile.instruments_installed_count || 0}</span>
      </p>
      {Object.keys(instrumentsByType).length === 0 ? (
        <p className="italic text-xs text-gray-500">None registered yet.</p>
      ) : (
        <div className="space-y-2">
          {Object.entries(instrumentsByType).map(([t, arr]) => (
            <div key={t} className="text-sm">
              <p className="font-medium text-gray-800 capitalize">{t.replace(/_/g, ' ')} <span className="text-xs text-gray-500 font-normal">({arr.length})</span></p>
              <ul className="text-xs text-gray-600 ml-4 list-disc">
                {arr.map((i) => <li key={i.hardware_id}>{i.label || i.hardware_id} <span className="text-gray-400">({i.hardware_id})</span></li>)}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Section>

    {profile.notes && (
      <Section title="Notes">
        <p className="text-sm whitespace-pre-wrap text-gray-700">{profile.notes}</p>
      </Section>
    )}
  </div>
);

// -------------------- Editable admin form ----------------------------
const Row = ({ label, k, form, setForm, type = 'text', ...rest }) => (
  <div>
    <Label>{label}</Label>
    {type === 'textarea' ? (
      <Textarea value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} data-testid={`cp-input-${k}`} {...rest} />
    ) : (
      <Input type={type} value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} data-testid={`cp-input-${k}`} {...rest} />
    )}
  </div>
);

const EditForm = ({ form, setForm }) => (
  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
    <Section title="Customer details" icon={Building2}>
      <div className="space-y-3">
        <Row label="Customer name (as per CTO / NOC)" k="customer_name" form={form} setForm={setForm} />
        <Row label="Site name" k="site_name" form={form} setForm={setForm} />
        <Row label="Unit name" k="unit_name" form={form} setForm={setForm} placeholder="e.g. Noida, Ghaziabad, Lucknow" />
        <Row label="Full address" k="address" type="textarea" form={form} setForm={setForm} rows={3} />
      </div>
    </Section>

    <Section title="Representative" icon={User}>
      <div className="space-y-3">
        <Row label="Name" k="representative_name" form={form} setForm={setForm} />
        <Row label="Designation" k="representative_designation" form={form} setForm={setForm} />
        <Row label="Email" k="representative_email" type="email" form={form} setForm={setForm} />
        <Row label="Contact number" k="representative_phone" type="tel" form={form} setForm={setForm} />
      </div>
    </Section>

    <Section title="Groundwater NOC" icon={ShieldCheck}>
      <div className="grid grid-cols-2 gap-3">
        <Row label="NOC number" k="noc_number" form={form} setForm={setForm} />
        <Row label="Validity (years)" k="noc_validity_years" type="number" form={form} setForm={setForm} min={0} />
        <Row label="Issue date" k="noc_issue_date" type="date" form={form} setForm={setForm} />
        <Row label="Expiry date" k="noc_expiry_date" type="date" form={form} setForm={setForm} />
      </div>
    </Section>

    <Section title="Consent to Operate (CTO)" icon={FileBadge}>
      <div className="grid grid-cols-2 gap-3">
        <Row label="CTO number" k="cto_number" form={form} setForm={setForm} />
        <Row label="" k="_spacer" form={form} setForm={setForm} disabled className="invisible" />
        <Row label="Issue date" k="cto_issue_date" type="date" form={form} setForm={setForm} />
        <Row label="Expiry date" k="cto_expiry_date" type="date" form={form} setForm={setForm} />
      </div>
    </Section>

    <Section title="Groundwater usage permissions" icon={Droplets}>
      <div className="space-y-3">
        <div>
          <Label>NOC mode</Label>
          <select
            className="w-full border rounded px-3 py-2"
            value={form.noc_mode || 'single'}
            onChange={(e) => setForm({ ...form, noc_mode: e.target.value })}
            data-testid="cp-input-noc_mode"
          >
            <option value="single">Single NOC covers all borewells (e.g. Rajasthan)</option>
            <option value="per_borewell">One NOC per borewell (e.g. Uttar Pradesh)</option>
          </select>
          <p className="text-[11px] text-gray-500 mt-1">
            Governs how NOC reminders and expiries are grouped for this customer.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <Row label="Borewell permitted" k="boreholes_permitted" type="number" form={form} setForm={setForm} min={0} />
        <Row label="Abstraction borewells" k="abstraction_borewells_count" type="number" form={form} setForm={setForm} min={0} />
        <Row label="Permitted daily withdrawal (KLD)" k="permitted_daily_kl" type="number" form={form} setForm={setForm} min={0} step="0.01" />
        <Row label="Permitted yearly withdrawal (KL/year)" k="permitted_yearly_kl" type="number" form={form} setForm={setForm} min={0} step="0.01" />
        <Row label="Piezometers installed" k="piezometers_count" type="number" form={form} setForm={setForm} min={0} />
      </div>
    </Section>

    <Section title="Rainwater harvesting" icon={CalendarClock}>
      <div className="grid grid-cols-2 gap-3">
        <Row label="Number of structures" k="rwh_structure_count" type="number" form={form} setForm={setForm} min={0} />
        <Row label="Total catchment area (m²)" k="rwh_catchment_area_sqm" type="number" form={form} setForm={setForm} min={0} step="0.01" />
      </div>
    </Section>

    <Section title="Notes">
      <Row label="Any additional details" k="notes" type="textarea" form={form} setForm={setForm} rows={4} />
    </Section>
  </div>
);

export default CustomerProfile;
