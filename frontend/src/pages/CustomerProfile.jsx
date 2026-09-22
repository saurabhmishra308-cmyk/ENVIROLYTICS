import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Textarea } from '../components/ui/textarea';
import {
  Building2, Upload, Save, RefreshCw, Loader2, ShieldCheck, CalendarClock, MapPin, Users, Droplets, Cpu, FileBadge, Mail, Phone, User, Leaf, Factory, CloudRain, Landmark, CheckCircle2, Activity,
} from 'lucide-react';
import api, { formatApiError } from '../lib/api';
import { isAdmin, getCurrentUser } from '../mockData';
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
  piezometers_count: '', rwh_structure_count: '', rwh_catchment_area_sqm: '', rwh_runoff_coefficient: '',
  notes: '',
};

const fmtDate = (s) => (s ? new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

const Section = ({ title, icon: Icon, children, hidden, tone = 'blue', action }) => (
  hidden ? null : (
    <Card className="overflow-hidden border-slate-200/80 bg-white/95 shadow-[0_8px_28px_rgba(15,23,42,0.06)] transition-shadow hover:shadow-[0_12px_34px_rgba(15,23,42,0.09)]">
      <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-white to-slate-50/80 pb-3">
        <CardTitle className="flex items-center justify-between gap-3 text-[15px] text-slate-900">
          <span className="flex items-center gap-2.5">
            {Icon && <span className={`flex h-9 w-9 items-center justify-center rounded-xl bg-${tone}-50 ring-1 ring-${tone}-100`}><Icon className={`h-4 w-4 text-${tone}-600`} /></span>}
            <span>{title}</span>
          </span>
          {action}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">{children}</CardContent>
    </Card>
  )
);

const Field = ({ label, value, unit }) => (
  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.55fr)] items-baseline gap-4 border-b border-dashed border-slate-100 py-2 last:border-0">
    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">{label}</span>
    <span className="text-[12px] font-semibold leading-5 text-slate-700 text-right">
      {value ?? <span className="italic font-normal text-slate-300">Not provided</span>}
      {unit && value != null ? <span className="ml-1 text-[10px] font-medium text-slate-400">{unit}</span> : null}
    </span>
  </div>
);

// Streams the NOC certificate PDF/JPEG through the authenticated api client
// and offers it as a download link. We can't put a plain <a> pointing at the
// backend URL because the API requires the Bearer token in the header.
const NocDownloadLink = ({ filename, label = 'Download', small = false }) => {
  const [busy, setBusy] = useState(false);
  const handleClick = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.get(`/api/customer-profile/noc-file/${encodeURIComponent(filename)}`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      window.open(url, '_blank', 'noopener,noreferrer');
      // Best-effort revoke a minute later — enough for the browser to fetch.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e2) {
      toast.error(formatApiError(e2?.response?.data?.detail) || 'Could not open certificate');
    } finally { setBusy(false); }
  };
  const ext = filename.toLowerCase().endsWith('.pdf') ? 'PDF' : 'JPEG';
  return (
    <button type="button" onClick={handleClick} disabled={busy} className={`text-blue-600 underline ${small ? 'text-[10px]' : 'text-xs'}`} data-testid={`cp-noc-download-${filename}`}>
      {busy ? 'Opening…' : `${label} (${ext})`}
    </button>
  );
};

const CustomerProfile = () => {
  const admin = isAdmin();
  const me = getCurrentUser();
  const [users, setUsers] = useState([]);   // admin picker options
  const [selectedId, setSelectedId] = useState(admin ? (me?.id || null) : null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [borewellNocs, setBorewellNocs] = useState([]);   // per-borewell NOC rows
  const [logoTs, setLogoTs] = useState(Date.now()); // cache-buster
  const logoFileRef = useRef(null);

  const loadUsers = useCallback(async () => {
    if (!admin) return;
    try {
      const { data } = await api.get('/api/customer-profile/list');
      setUsers(data.users || []);
      // Only auto-pick from the list if nothing is selected yet AND the
      // current logged-in user isn't in the list (edge case). Otherwise
      // keep the initial selection (the admin's own id) so admins land on
      // their own profile — not the first client alphabetically.
      if ((data.users || []).length && !selectedId) {
        const preferred = data.users.find((u) => u.id === me?.id) || data.users[0];
        setSelectedId(preferred.id);
      }
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Failed to load users');
    }
  }, [admin, selectedId, me?.id]);

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
      setBorewellNocs(Array.isArray(data?.borewell_nocs) ? data.borewell_nocs : []);
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
        'rwh_structure_count', 'rwh_catchment_area_sqm', 'rwh_runoff_coefficient',
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
      const { data } = await api.put(`/api/customer-profile/${profile.id}`, {
        ...payload,
        borewell_nocs: borewellNocs,
      });
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
  // Which sections apply for THIS customer is driven by what they've had
  // installed. Water-quality-only customers should not be asked for
  // borewell / groundwater NOC details.
  const hasFlow  = !!instrumentsByType.flowmeter;
  const hasDwlr  = !!instrumentsByType.dwlr;
  const hasWQ    = !!(instrumentsByType.wq_stp || instrumentsByType.do_meter || instrumentsByType.chlorine_analyzer || instrumentsByType.ph || instrumentsByType.tds || instrumentsByType.conductivity);
  const hasOcems = !!instrumentsByType.ocems;
  // Admin's own record only needs company + representative details — never
  // Groundwater NOC, CTO, borewells or RWH (those belong to real customers).
  const isAdminOwnProfile = profile.role === 'admin';
  const showGroundwater = !isAdminOwnProfile && (hasFlow || hasDwlr);
  const applicability = {
    showGroundwater,
    showCTO: !isAdminOwnProfile && (hasWQ || hasOcems || hasFlow || hasDwlr),
    showRWH: !isAdminOwnProfile,
    showInstruments: !isAdminOwnProfile,
    isAdminOwnProfile,
    hasFlow, hasDwlr, hasWQ, hasOcems,
  };

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_80%_0%,rgba(219,243,255,0.75),transparent_32%),linear-gradient(180deg,#f8fbff_0%,#f5f8fc_100%)] p-4 md:p-5 xl:p-6 space-y-5" data-testid="customer-profile-page">
      <Card className="overflow-hidden border-slate-200/80 bg-white shadow-[0_10px_34px_rgba(15,23,42,0.08)]">
        <CardContent className="p-0">
          <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(430px,0.95fr)]">
            <div className="flex min-w-0 items-center gap-4 p-5">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-slate-50 shadow-sm">
                {logoBlobUrl ? <img src={logoBlobUrl} alt="Company logo" className="h-full w-full object-contain p-2" /> : <Building2 className="h-8 w-8 text-blue-500" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-bold tracking-tight text-slate-900 md:text-2xl">{profile.customer_name || profile.full_name || profile.email}</h1>
                  <Badge className="border-0 bg-emerald-50 text-emerald-700 hover:bg-emerald-50"><CheckCircle2 className="mr-1 h-3 w-3" /> Client</Badge>
                </div>
                <p className="mt-1 text-xs font-medium text-slate-500">{profile.site_name || 'Customer site'}{profile.unit_name ? `  •  ${profile.unit_name}` : ''}</p>
                {profile.address && <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-4 text-slate-500"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" /> {profile.address}</p>}
              </div>
            </div>
            <div className="relative hidden min-h-[150px] overflow-hidden bg-white lg:block">
              <img
                src="/banners/customer-profile-banner.png"
                alt="Envirolytics Environmental Monitoring Across Every Sector"
                className="h-full w-full object-contain"
                loading="eager"
                decoding="async"
              />
            </div>
          </div>
          {admin && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 px-5 py-3">
              <select className="min-w-[280px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm outline-none focus:border-blue-400" value={selectedId || ''} onChange={(e) => { setSelectedId(e.target.value); setEditing(false); }} data-testid="cp-user-picker">
                {users.map((u) => <option key={u.id} value={u.id}>{u.role === 'admin' && u.id === me?.id ? '⚙️ My profile — ' : ''}{u.customer_name || u.full_name || u.email}{u.unit_name ? ` — ${u.unit_name}` : ''}{u.role === 'admin' && u.id === me?.id ? ' (Admin)' : ''}</option>)}
              </select>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="rounded-xl border-slate-200 bg-white" onClick={() => logoFileRef.current?.click()} disabled={uploadingLogo} data-testid="cp-logo-upload-btn">
                  {uploadingLogo ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading…</> : <><Upload className="mr-2 h-4 w-4" /> Upload logo (JPEG)</>}
                </Button>
                {!editing ? <Button className="rounded-xl bg-slate-900 hover:bg-slate-800" onClick={() => setEditing(true)} data-testid="cp-edit-btn">Edit profile</Button> : <>
                  <Button variant="outline" className="rounded-xl" onClick={() => { setEditing(false); loadProfile(profile.id); }} disabled={saving}>Cancel</Button>
                  <Button className="rounded-xl bg-blue-600 hover:bg-blue-700" onClick={handleSave} disabled={saving} data-testid="cp-save-btn">{saving ? <><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Saving…</> : <><Save className="mr-2 h-4 w-4" /> Save changes</>}</Button>
                </>}
              </div>
              <input ref={logoFileRef} type="file" accept="image/jpeg,.jpg,.jpeg" className="hidden" onChange={handleLogoUpload} />
            </div>
          )}
        </CardContent>
      </Card>

      {!editing ? (
        <ReadOnlyView profile={profile} instrumentsByType={instrumentsByType} borewellNocs={borewellNocs} applicability={applicability} />
      ) : (
        <EditForm form={form} setForm={setForm} borewellNocs={borewellNocs} setBorewellNocs={setBorewellNocs} profile={profile} onNocUploaded={() => loadProfile(profile.id)} applicability={applicability} />
      )}
    </div>
  );
};

// -------------------- Read-only presentation --------------------------
const ReadOnlyView = ({ profile, instrumentsByType, borewellNocs, applicability }) => (
  <div className="space-y-5">
    {!applicability.showGroundwater && !applicability.isAdminOwnProfile && (
      <div className="rounded-2xl border border-sky-200 bg-sky-50/80 px-4 py-3 text-xs text-sky-800 shadow-sm">
        <strong>Monitoring scope:</strong> Groundwater NOC and borewell permissions are hidden because this customer has no flowmeter or piezometer linked.
      </div>
    )}

    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <Section title="Customer Details" icon={Building2} tone="blue">
        <Field label="Customer name" value={profile.customer_name} /><Field label="Site name" value={profile.site_name} /><Field label="Unit name" value={profile.unit_name} /><Field label="Full address" value={profile.address} />
      </Section>
      <Section title="Representative" icon={User} tone="emerald">
        <Field label="Name" value={profile.representative_name} /><Field label="Designation" value={profile.representative_designation} /><Field label="Email" value={profile.representative_email ? <a className="text-blue-600 hover:underline" href={`mailto:${profile.representative_email}`}><Mail className="mr-1 inline h-3 w-3" />{profile.representative_email}</a> : null} /><Field label="Contact" value={profile.representative_phone ? <a className="text-blue-600 hover:underline" href={`tel:${profile.representative_phone}`}><Phone className="mr-1 inline h-3 w-3" />{profile.representative_phone}</a> : null} />
      </Section>
      <Section title="Organization" icon={Landmark} tone="violet">
        <Field label="Role" value={profile.role === 'admin' ? 'Administrator' : 'Client'} /><Field label="Monitoring scope" value={Object.keys(instrumentsByType).length ? Object.keys(instrumentsByType).map((t) => t.replace(/_/g,' ')).join(' • ') : 'Profile information'} /><Field label="Status" value={<span className="inline-flex items-center gap-1.5 text-emerald-600"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Active</span>} />
      </Section>
    </div>

    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <Section title="Groundwater NOC" icon={Droplets} tone="sky" hidden={!applicability.showGroundwater} action={profile.noc_file_name ? <NocDownloadLink filename={profile.noc_file_name} label="View document" /> : null}>
        <Field label="NOC mode" value={profile.noc_mode === 'per_borewell' ? 'One NOC per borewell' : 'Single NOC covers all borewells'} /><Field label="NOC number" value={profile.noc_number} /><Field label="Issue date" value={profile.noc_issue_date ? fmtDate(profile.noc_issue_date) : null} /><Field label="Validity" value={profile.noc_validity_years} unit="years" /><Field label="Expiry" value={profile.noc_expiry_date ? fmtDate(profile.noc_expiry_date) : null} />
        {profile.noc_mode === 'per_borewell' && <div className="mt-2 overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b bg-slate-50"><th className="p-2 text-left">Borewell</th><th className="p-2 text-left">NOC</th><th className="p-2 text-left">Issue</th><th className="p-2 text-left">Expiry</th></tr></thead><tbody>{(borewellNocs || []).map((r,i)=><tr key={i} className="border-b border-slate-100"><td className="p-2 font-medium">{r.borewell_name || r.borewell_id || `#${i+1}`}</td><td className="p-2 font-mono">{r.noc_number || '—'}</td><td className="p-2">{r.issue_date ? fmtDate(r.issue_date) : '—'}</td><td className="p-2">{r.expiry_date ? fmtDate(r.expiry_date) : '—'}</td></tr>)}</tbody></table></div>}
      </Section>
      <Section title="Consent to Operate (CTO)" icon={Factory} tone="emerald" hidden={!applicability.showCTO}>
        <Field label="CTO number" value={profile.cto_number} /><Field label="Issue date" value={profile.cto_issue_date ? fmtDate(profile.cto_issue_date) : null} /><Field label="Expiry date" value={profile.cto_expiry_date ? fmtDate(profile.cto_expiry_date) : null} /><Field label="Status" value={<span className="inline-flex items-center gap-1.5 text-slate-500"><span className="h-2 w-2 rounded-full bg-slate-400" /> {profile.cto_number ? 'Provided' : 'Not provided'}</span>} />
      </Section>
      <Section title="Rainwater Harvesting" icon={CloudRain} tone="blue" hidden={!applicability.showRWH}>
        <Field label="Structures" value={profile.rwh_structure_count} /><Field label="Catchment area" value={profile.rwh_catchment_area_sqm} unit="m²" /><Field label="Runoff coefficient" value={profile.rwh_runoff_coefficient} /><Field label="Status" value={profile.rwh_structure_count ? <span className="text-emerald-600">Configured</span> : <span className="text-slate-500">Not provided</span>} />
      </Section>
    </div>

    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <Section title="Groundwater Usage Permissions" icon={ShieldCheck} tone="emerald" hidden={!applicability.showGroundwater}>
        <Field label="NOC mode" value={profile.noc_mode === 'per_borewell' ? 'Per borewell' : 'Single NOC'} /><Field label="Borewell permitted" value={profile.boreholes_permitted} /><Field label="Abstraction borewells" value={profile.abstraction_borewells_count} /><Field label="Daily withdrawal" value={profile.permitted_daily_kl} unit="KLD" /><Field label="Yearly withdrawal" value={profile.permitted_yearly_kl} unit="KL/year" /><Field label="Piezometers" value={profile.piezometers_count} />
      </Section>
      <Section title="Instruments Installed" icon={Cpu} tone="blue" hidden={!applicability.showInstruments} action={<Badge className="border-0 bg-blue-50 text-blue-700">{profile.instruments_installed_count || 0} installed</Badge>}>
        {Object.keys(instrumentsByType).length === 0 ? <p className="italic text-xs text-slate-400">None registered yet.</p> : <div className="space-y-4">
          {Object.entries(instrumentsByType).map(([t, arr]) => {
            const isDwlr = t === 'dwlr'; const isFlow = t === 'flowmeter';
            return <div key={t}><div className="mb-2 flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-wide text-slate-700">{t.replace(/_/g,' ')}</p><span className="text-[10px] font-semibold text-slate-400">{arr.length}</span></div><div className="grid grid-cols-[1fr_100px] items-center gap-2 rounded-xl border border-slate-100 bg-slate-50/70 p-2"><ul className="space-y-1.5 text-[11px] text-slate-600">{arr.map((i)=><li key={i.hardware_id} className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" /><span>{i.label || i.hardware_id} <span className="text-slate-400">({i.hardware_id})</span></span></li>)}</ul>{(isDwlr || isFlow) && (() => {
  const gallery = isFlow
    ? [
        { src: '/flowmeter-banner.svg', alt: 'Envirolytics Flowmeter — overview' },
        { src: '/flowmeter-detail.svg', alt: 'Envirolytics Flowmeter — detail' },
      ]
    : [
        { src: '/dwlr-banner.webp', alt: 'Envirolytics Digital Water Level Recorder — overview' },
        { src: '/dwlr-controller.svg', alt: 'Envirolytics Digital Water Level Recorder — controller view' },
        { src: '/dwlr-probe.svg', alt: 'Envirolytics Digital Water Level Recorder — probe view' },
      ];
  return (
    <div className={isFlow ? 'grid grid-cols-2 gap-1.5' : 'grid grid-cols-3 gap-1.5'}>
      {gallery.map((item, idx) => (
        <div key={idx} className="flex h-20 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white p-1">
          <img
            src={item.src}
            alt={item.alt}
            className="h-full w-full object-contain"
            loading="lazy"
          />
        </div>
      ))}
    </div>
  );
})()}</div></div>;
          })}
        </div>}
      </Section>
      <div className="overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-sky-50 shadow-[0_8px_28px_rgba(15,23,42,0.06)]">
        <div className="relative h-full min-h-[270px] overflow-hidden">
            <img
              src="/banners/customer-compliance-banner.png"
              alt="Environmental Compliance Today for a Better Tomorrow"
              className="h-full w-full object-contain"
              loading="lazy"
              decoding="async"
            />
          </div>
      </div>
    </div>

    {profile.notes && <Section title="Notes" icon={FileBadge} tone="slate"><p className="whitespace-pre-wrap text-sm leading-6 text-slate-600">{profile.notes}</p></Section>}
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

const EditForm = ({ form, setForm, borewellNocs, setBorewellNocs, profile, onNocUploaded, applicability }) => {
  const addBorewellNoc = () => setBorewellNocs([...(borewellNocs || []), { borewell_name: '', noc_number: '', issue_date: '', expiry_date: '' }]);
  const updateBorewellNoc = (i, patch) => setBorewellNocs(borewellNocs.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const removeBorewellNoc = (i) => setBorewellNocs(borewellNocs.filter((_, idx) => idx !== i));
  const isPerBorewell = (form.noc_mode || 'single') === 'per_borewell';

  const uploadNocFile = async (borewellIndex, file) => {
    if (!file) return;
    const okType = /application\/pdf/i.test(file.type) || /image\/jpe?g/i.test(file.type);
    if (!okType) { toast.error('PDF or JPEG only'); return; }
    try {
      const fd = new FormData();
      fd.append('file', file);
      const qs = borewellIndex != null ? `?borewell_index=${borewellIndex}` : '';
      await api.post(`/api/customer-profile/${profile.id}/noc-certificate${qs}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('NOC certificate uploaded');
      onNocUploaded && onNocUploaded();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Upload failed');
    }
  };

  return (
  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
    {!applicability.showGroundwater && !applicability.isAdminOwnProfile && (
      <div className="xl:col-span-2 border border-sky-200 bg-sky-50 text-sky-900 text-sm rounded p-3">
        <strong>Note:</strong> No flowmeter or piezometer is linked to this customer, so the Groundwater NOC and borewell permission sections below are hidden — they aren&apos;t required for water-quality-only installations.
      </div>
    )}
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

    <Section title="Groundwater NOC" icon={ShieldCheck} hidden={!applicability.showGroundwater}>
      {!isPerBorewell ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Row label="NOC number" k="noc_number" form={form} setForm={setForm} />
            <Row label="Validity (years)" k="noc_validity_years" type="number" form={form} setForm={setForm} min={0} />
            <Row label="Issue date" k="noc_issue_date" type="date" form={form} setForm={setForm} />
            <Row label="Expiry date" k="noc_expiry_date" type="date" form={form} setForm={setForm} />
          </div>
          <div className="border-t pt-3">
            <Label>NOC certificate (PDF or JPEG)</Label>
            <div className="flex items-center gap-2 mt-1">
              <Input type="file" accept="application/pdf,image/jpeg,.jpg,.jpeg,.pdf" onChange={(e) => uploadNocFile(null, e.target.files?.[0])} data-testid="cp-noc-file-upload" />
              {profile?.noc_file_name && <NocDownloadLink filename={profile.noc_file_name} label="View current" />}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-gray-600">
            In <strong>per-borewell</strong> mode each borewell carries its own NOC. Attach the PDF/JPEG certificate per row. Reminders (3-month, 1-month, 11-month self-compliance) fire independently for every row.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left p-2">Borewell name</th>
                  <th className="text-left p-2">NOC number</th>
                  <th className="text-left p-2">Issue date</th>
                  <th className="text-left p-2">Expiry date</th>
                  <th className="text-left p-2">Certificate</th>
                  <th className="p-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {(borewellNocs || []).map((r, i) => (
                  <tr key={i} className="border-b" data-testid={`cp-bw-row-${i}`}>
                    <td className="p-1"><Input value={r.borewell_name || ''} onChange={(e) => updateBorewellNoc(i, { borewell_name: e.target.value })} placeholder={`BW-${i + 1}`} /></td>
                    <td className="p-1"><Input value={r.noc_number || ''} onChange={(e) => updateBorewellNoc(i, { noc_number: e.target.value })} /></td>
                    <td className="p-1"><Input type="date" value={r.issue_date || ''} onChange={(e) => updateBorewellNoc(i, { issue_date: e.target.value })} /></td>
                    <td className="p-1"><Input type="date" value={r.expiry_date || ''} onChange={(e) => updateBorewellNoc(i, { expiry_date: e.target.value })} /></td>
                    <td className="p-1">
                      <div className="flex flex-col gap-1">
                        <Input type="file" accept="application/pdf,image/jpeg,.jpg,.jpeg,.pdf" onChange={(e) => uploadNocFile(i, e.target.files?.[0])} data-testid={`cp-bw-file-${i}`} className="text-[10px]" />
                        {r.noc_file_name && <NocDownloadLink filename={r.noc_file_name} label="View" small />}
                      </div>
                    </td>
                    <td className="p-1 text-center">
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeBorewellNoc(i)} className="text-red-600" data-testid={`cp-bw-remove-${i}`}>×</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addBorewellNoc} data-testid="cp-bw-add">+ Add borewell NOC</Button>
        </div>
      )}
    </Section>

    <Section title="Consent to Operate (CTO)" icon={FileBadge} hidden={!applicability.showCTO}>
      <div className="grid grid-cols-2 gap-3">
        <Row label="CTO number" k="cto_number" form={form} setForm={setForm} />
        <Row label="" k="_spacer" form={form} setForm={setForm} disabled className="invisible" />
        <Row label="Issue date" k="cto_issue_date" type="date" form={form} setForm={setForm} />
        <Row label="Expiry date" k="cto_expiry_date" type="date" form={form} setForm={setForm} />
      </div>
    </Section>

    <Section title="Groundwater usage permissions" icon={Droplets} hidden={!applicability.showGroundwater}>
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

    <Section title="Rainwater harvesting" icon={CalendarClock} hidden={!applicability.showRWH}>
      <div className="grid grid-cols-2 gap-3">
        <Row label="Number of structures" k="rwh_structure_count" type="number" form={form} setForm={setForm} min={0} />
        <Row label="Total catchment area (m²)" k="rwh_catchment_area_sqm" type="number" form={form} setForm={setForm} min={0} step="0.01" />
        <Row label="Runoff coefficient (0..1)" k="rwh_runoff_coefficient" type="number" form={form} setForm={setForm} min={0} max={1} step="0.01"
             placeholder="0.85 (RCC roof) · 0.75 (tiled) · 0.70 (paved)" />
      </div>
      <p className="text-[11px] text-gray-500 mt-2">
        CGWB reference values — RCC roof: 0.85 · GI sheet: 0.90 · tiled: 0.75 · paved: 0.70 · unpaved: 0.10-0.25.
        The dashboard multiplies this by rainfall (mm) and area (m²) to estimate daily recharge.
      </p>
    </Section>

    <Section title="Notes">
      <Row label="Any additional details" k="notes" type="textarea" form={form} setForm={setForm} rows={4} />
    </Section>
  </div>
  );
};

export default CustomerProfile;
