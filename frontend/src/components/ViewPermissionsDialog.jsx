import React, { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from './ui/dialog';
import { Check, Layers, Cpu } from 'lucide-react';
import api, { formatApiError } from '../lib/api';
import { toast } from 'sonner';

// Page / panel toggles — which sidebar pages the client can open.
export const VP_PAGE_LABELS = [
  { key: 'dashboard',        label: 'Dashboard' },
  { key: 'analysis',         label: 'Analysis' },
  { key: 'reports',          label: 'Reports' },
  { key: 'graph_report',     label: 'Graph Report' },
  { key: 'site',             label: 'Site / Location Map' },
  { key: 'certificates',     label: 'Certificate & Photos' },
  { key: 'audit_log',        label: 'Instrument Report' },
  { key: 'customer_profile', label: 'Customer Profile' },
  { key: 'water_quality',    label: 'Water Quality (STP · DO · Chlorine)' },
  { key: 'flowmeter',        label: 'Flowmeter' },
  { key: 'dwlr',             label: 'DWLR (Water Level)' },
  { key: 'ph',               label: 'pH' },
  { key: 'tds',              label: 'TDS' },
  { key: 'conductivity',     label: 'Conductivity' },
  { key: 'rwh_recharge',     label: 'Rainwater Recharge Estimate' },
];

// Device-type visibility — turning a type OFF hides EVERY device of that
// type from the client on every screen (dashboard, reports, WQ, maps,
// exports). Enforced server-side; admins are never affected.
export const VP_DEVICE_LABELS = [
  { key: 'show_flowmeter_devices',    label: 'Show Flowmeter devices' },
  { key: 'show_dwlr_devices',         label: 'Show DWLR (Water Level) devices' },
  { key: 'show_do_devices',           label: 'Show DO Analyzer devices' },
  { key: 'show_chlorine_devices',     label: 'Show Chlorine Analyzer devices' },
  { key: 'show_ocems_devices',        label: 'Show OCEMS / STP Analyzer devices' },
  { key: 'show_ph_devices',           label: 'Show pH Sensor devices' },
  { key: 'show_tds_devices',          label: 'Show TDS Sensor devices' },
  { key: 'show_conductivity_devices', label: 'Show Conductivity Sensor devices' },
];

const ALL_KEYS = [...VP_PAGE_LABELS, ...VP_DEVICE_LABELS];

const ToggleRow = ({ perms, onToggle, item }) => (
  <label
    className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-gray-50"
    data-testid={`vp-row-${item.key}`}
  >
    <span className="text-sm text-gray-800">{item.label}</span>
    <input
      type="checkbox"
      className="h-4 w-4 accent-sky-600"
      checked={Boolean(perms[item.key] ?? true)}
      onChange={() => onToggle(item.key)}
      data-testid={`vp-checkbox-${item.key}`}
    />
  </label>
);

// Admin-only dialog: page-level view access + per-device-type visibility
// for one client. Pass `user=null` to keep it closed.
const ViewPermissionsDialog = ({ user, onClose, onSaved }) => {
  const [perms, setPerms] = useState({});
  const [loading, setLoading] = useState(false);
  const open = Boolean(user);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    api.get(`/api/admin/users/${user.id}/view-permissions`)
      .then(({ data }) => { if (!cancelled) setPerms(data?.permissions || {}); })
      .catch((e) => {
        toast.error(formatApiError(e?.response?.data?.detail));
        onClose();
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (k) => setPerms((prev) => ({ ...prev, [k]: !(prev[k] ?? true) }));
  const setAll = (val) => {
    const next = {};
    ALL_KEYS.forEach(({ key }) => { next[key] = val; });
    setPerms(next);
  };

  const save = async () => {
    if (!user) return;
    try {
      await api.put(`/api/admin/users/${user.id}/view-permissions`, { permissions: perms });
      toast.success(`View access updated for ${user.email}`);
      onClose();
      onSaved?.();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    }
  };

  const enabledCount = ALL_KEYS.filter(({ key }) => perms[key] ?? true).length;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>View Access — {user?.email}</DialogTitle>
          <DialogDescription>
            Pick which sidebar pages and device types this client can see. Every
            enabled tab is <span className="font-semibold">read-only</span> — the
            client can view live data, charts, and maps but cannot add,
            edit, delete, upload, or configure anything.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-gray-500 py-6 text-center">Loading…</p>
        ) : (
          <>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500" data-testid="vp-enabled-count">
                {enabledCount} of {ALL_KEYS.length} enabled
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setAll(true)} data-testid="vp-enable-all">
                  Enable all
                </Button>
                <Button size="sm" variant="outline" onClick={() => setAll(false)} data-testid="vp-disable-all">
                  Disable all
                </Button>
              </div>
            </div>
            <div className="max-h-[420px] overflow-y-auto border rounded">
              <div className="px-3 py-1.5 bg-gray-50 border-b flex items-center gap-2 sticky top-0 z-10">
                <Layers className="h-3.5 w-3.5 text-sky-600" />
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Pages &amp; Panels</span>
              </div>
              <div className="divide-y">
                {VP_PAGE_LABELS.map((item) => (
                  <ToggleRow key={item.key} item={item} perms={perms} onToggle={toggle} />
                ))}
              </div>
              <div className="px-3 py-1.5 bg-gray-50 border-y flex items-center gap-2 sticky top-0 z-10" data-testid="vp-device-section">
                <Cpu className="h-3.5 w-3.5 text-emerald-600" />
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Device Type Visibility</span>
              </div>
              <p className="px-3 py-1.5 text-[11px] text-gray-500 border-b bg-emerald-50/40">
                Turning a type off hides every device of that type from this client
                on all screens — dashboard, reports, water quality, maps &amp; exports.
              </p>
              <div className="divide-y">
                {VP_DEVICE_LABELS.map((item) => (
                  <ToggleRow key={item.key} item={item} perms={perms} onToggle={toggle} />
                ))}
              </div>
            </div>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="vp-cancel">Cancel</Button>
          <Button onClick={save} disabled={loading} data-testid="vp-save">
            <Check className="h-3 w-3 mr-1" /> Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ViewPermissionsDialog;
