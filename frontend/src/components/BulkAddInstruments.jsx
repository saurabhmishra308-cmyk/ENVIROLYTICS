import React, { useMemo, useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import { Layers, Plus, Trash2, ArrowLeft, ArrowRight, CheckCircle2, XCircle } from 'lucide-react';
import api, { formatApiError } from '../lib/api';

/**
 * Bulk-Add Instruments wizard.
 *
 * Step 1 — Client + site selection
 * Step 2 — Menu: pick count per instrument type (0..10 each)
 * Step 3 — Fill hardware_id / deviceId(IMEI) / label / source for each row
 * Step 4 — Submit → POST /api/instrument-registry/bulk → show per-row status
 */
const TYPE_MENU = [
  { value: 'do_meter',          label: 'DO Analyzer' },
  { value: 'wq_stp',            label: 'OCEMS / Water Quality Analyzer' },
  { value: 'flowmeter',         label: 'Flowmeter' },
  { value: 'dwlr',              label: 'DWLR (Water Level Recorder)' },
  { value: 'chlorine_analyzer', label: 'Chlorine Analyzer' },
  { value: 'ph',                label: 'pH Sensor' },
  { value: 'tds',               label: 'TDS Sensor' },
  { value: 'conductivity',      label: 'Conductivity Sensor' },
];

// Default source per type — DO / OCEMS are typically HTTP-polled via QESPL;
// everything else defaults to the shared MQTT broker.
const DEFAULT_SOURCE = {
  do_meter: 'http',
  wq_stp:   'http',
};

const FLOWMETER_CATEGORIES = [
  { value: 'groundwater_abstraction', label: 'Groundwater Abstraction' },
  { value: 'stp_inlet',               label: 'STP Inlet' },
  { value: 'stp_outlet',              label: 'STP Outlet' },
];

// Prefix used when auto-suggesting hardware_ids per type. Admin can edit.
const HW_PREFIX = {
  do_meter: 'DO_', wq_stp: 'WQ_', flowmeter: 'FM_', dwlr: 'DWLR_',
  chlorine_analyzer: 'CL_', ph: 'PH_', tds: 'TDS_', conductivity: 'COND_',
};

const emptyCounts = () => Object.fromEntries(TYPE_MENU.map((t) => [t.value, 0]));

export default function BulkAddInstruments({ open, onClose, users, onCreated }) {
  const [step, setStep] = useState(1);
  const [ownerId, setOwnerId] = useState('');
  const [siteName, setSiteName] = useState('');
  const [counts, setCounts] = useState(emptyCounts());
  const [rows, setRows] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // { created:[], errors:[] }

  // Reset the wizard whenever it re-opens so a re-entry never carries stale
  // rows / counts / errors from a previous session.
  useEffect(() => {
    if (open) {
      setStep(1);
      setOwnerId('');
      setSiteName('');
      setCounts(emptyCounts());
      setRows([]);
      setResult(null);
    }
  }, [open]);

  const totalRows = useMemo(
    () => Object.values(counts).reduce((s, n) => s + (parseInt(n, 10) || 0), 0),
    [counts],
  );

  const generateRows = () => {
    const out = [];
    for (const t of TYPE_MENU) {
      const n = parseInt(counts[t.value], 10) || 0;
      for (let i = 1; i <= n; i++) {
        out.push({
          instrument_type: t.value,
          hardware_id: `${HW_PREFIX[t.value] || ''}${(i).toString().padStart(3, '0')}`,
          imei: '',
          label: `${t.label} #${i}`,
          source: DEFAULT_SOURCE[t.value] || 'mqtt',
          category: t.value === 'flowmeter' ? 'groundwater_abstraction' : undefined,
        });
      }
    }
    setRows(out);
    setStep(3);
  };

  const updateRow = (idx, patch) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const removeRow = (idx) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const validateRows = () => {
    const seen = new Set();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.hardware_id?.trim()) return `Row ${i + 1}: Hardware ID is required`;
      if (seen.has(r.hardware_id.trim())) return `Duplicate hardware_id: ${r.hardware_id}`;
      seen.add(r.hardware_id.trim());
      if (r.source === 'http' && !r.imei?.trim()) {
        return `Row ${i + 1}: deviceId is required for HTTP-polled devices`;
      }
    }
    return null;
  };

  const submit = async () => {
    if (!ownerId) return toast.error('Pick a client / owner first');
    const err = validateRows();
    if (err) return toast.error(err);

    const payload = {
      instruments: rows.map((r) => ({
        hardware_id: r.hardware_id.trim(),
        instrument_type: r.instrument_type,
        owner_user_id: ownerId,
        label: r.label?.trim() || r.hardware_id.trim(),
        location_name: siteName?.trim() || null,
        source: r.source,
        imei: r.imei?.trim() || null,
        category: r.instrument_type === 'flowmeter' ? (r.category || 'groundwater_abstraction') : undefined,
      })),
    };

    setSubmitting(true);
    try {
      const { data } = await api.post('/api/instrument-registry/bulk', payload);
      setResult(data);
      setStep(4);
      if (data.error_count === 0) {
        toast.success(`Registered ${data.created_count} instrument(s)`);
      } else {
        toast.warning(`Registered ${data.created_count} · ${data.error_count} failed`);
      }
      onCreated?.();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="bulk-add-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" /> Bulk Add Instruments
            <Badge variant="outline" className="ml-2">Step {step} of 4</Badge>
          </DialogTitle>
          <DialogDescription>
            Register multiple instruments for one client / premises in a single flow.
            Ideal for onboarding a new site with several DO analyzers, WQ analyzers,
            flowmeters, DWLRs, etc.
          </DialogDescription>
        </DialogHeader>

        {/* ---------- Step 1: client + site ---------- */}
        {step === 1 && (
          <div className="space-y-4">
            <div>
              <Label>Client / Owner</Label>
              <select
                className="w-full border rounded px-3 py-2 mt-1"
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                data-testid="bulk-owner-select"
              >
                <option value="">— Select a client —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {(u.company_name || u.full_name || u.email) + (u.location_name ? ` — ${u.location_name}` : '')}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Premises / Site name (optional)</Label>
              <Input
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
                placeholder="e.g. Lemon Tree Hotel — Lucknow Unit"
                data-testid="bulk-site-input"
              />
              <p className="text-xs text-gray-500 mt-1">
                Applied as the default <code>location_name</code> for every instrument in this batch.
              </p>
            </div>
          </div>
        )}

        {/* ---------- Step 2: count per type ---------- */}
        {step === 2 && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              How many of each instrument type are installed at <strong>{siteName || 'this site'}</strong>? (0–10 per type)
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {TYPE_MENU.map((t) => (
                <div key={t.value} className="flex items-center justify-between border rounded px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">{t.label}</p>
                    <p className="text-[11px] text-gray-500">{t.value}</p>
                  </div>
                  <Input
                    type="number" min="0" max="10"
                    className="w-20 text-center"
                    value={counts[t.value]}
                    onChange={(e) => setCounts({ ...counts, [t.value]: Math.max(0, Math.min(10, parseInt(e.target.value || '0', 10))) })}
                    data-testid={`bulk-count-${t.value}`}
                  />
                </div>
              ))}
            </div>
            <div className="text-sm text-gray-700">
              <strong>Total:</strong> {totalRows} instrument(s) to configure
            </div>
          </div>
        )}

        {/* ---------- Step 3: per-row detail ---------- */}
        {step === 3 && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Fill in the hardware IDs and (for HTTP-polled devices) the QESPL <code>deviceId</code>.
              Rows can be removed if you don&apos;t need them.
            </p>
            <div className="max-h-[52vh] overflow-y-auto border rounded">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="text-left px-2 py-1.5">#</th>
                    <th className="text-left px-2 py-1.5">Type</th>
                    <th className="text-left px-2 py-1.5">Hardware ID *</th>
                    <th className="text-left px-2 py-1.5">Label</th>
                    <th className="text-left px-2 py-1.5">Source</th>
                    <th className="text-left px-2 py-1.5">deviceId / IMEI</th>
                    <th className="text-left px-2 py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-2 py-1.5 text-gray-500">{i + 1}</td>
                      <td className="px-2 py-1.5">
                        <span className="text-xs bg-gray-100 rounded px-1.5 py-0.5">
                          {TYPE_MENU.find((t) => t.value === r.instrument_type)?.label || r.instrument_type}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          value={r.hardware_id}
                          onChange={(e) => updateRow(i, { hardware_id: e.target.value })}
                          className="h-8"
                          data-testid={`bulk-row-hw-${i}`}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          value={r.label}
                          onChange={(e) => updateRow(i, { label: e.target.value })}
                          className="h-8"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <select
                          value={r.source}
                          onChange={(e) => updateRow(i, { source: e.target.value })}
                          className="border rounded px-2 h-8 text-sm"
                          data-testid={`bulk-row-source-${i}`}
                        >
                          <option value="mqtt">MQTT</option>
                          <option value="http">HTTP (QESPL)</option>
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          value={r.imei}
                          onChange={(e) => updateRow(i, { imei: e.target.value })}
                          placeholder={r.source === 'http' ? 'e.g. DTU10020426' : 'optional IMEI'}
                          className="h-8"
                          data-testid={`bulk-row-imei-${i}`}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Button variant="ghost" size="sm" onClick={() => removeRow(i)} className="h-7 text-red-600">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length === 0 && (
                <div className="text-center text-sm text-gray-500 py-6">No rows — go back and set counts.</div>
              )}
            </div>
            <p className="text-xs text-gray-500">
              For HTTP devices, the <code>deviceId</code> (e.g. <code>DTU10020426</code>) is what the
              backend sends to QESPL. It&apos;s stored as the instrument&apos;s <code>imei</code> field.
            </p>
          </div>
        )}

        {/* ---------- Step 4: result ---------- */}
        {step === 4 && result && (
          <div className="space-y-3">
            <div className="flex items-center gap-4 text-sm">
              <span className="flex items-center gap-1 text-green-700">
                <CheckCircle2 className="h-4 w-4" /> Created: {result.created_count}
              </span>
              <span className="flex items-center gap-1 text-red-700">
                <XCircle className="h-4 w-4" /> Failed: {result.error_count}
              </span>
            </div>
            {result.created?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-1">Created</p>
                <div className="max-h-40 overflow-y-auto border rounded text-xs">
                  {result.created.map((c) => (
                    <div key={c.hardware_id} className="px-2 py-1 border-b flex justify-between">
                      <span className="font-mono">{c.hardware_id}</span>
                      <span className="text-gray-500">{c.instrument_type} · {c.source}{c.imei ? ` · ${c.imei}` : ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {result.errors?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-red-700 mb-1">Errors</p>
                <div className="max-h-40 overflow-y-auto border border-red-200 rounded text-xs bg-red-50">
                  {result.errors.map((e, i) => (
                    <div key={i} className="px-2 py-1 border-b border-red-100">
                      <span className="font-mono">{e.hardware_id || `row ${e.index + 1}`}:</span>
                      <span className="ml-2 text-red-700">{e.error}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {step > 1 && step < 4 && (
            <Button variant="outline" onClick={() => setStep(step - 1)}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
          )}
          {step === 1 && (
            <Button
              onClick={() => setStep(2)}
              disabled={!ownerId}
              data-testid="bulk-next-step2"
            >
              Next <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          )}
          {step === 2 && (
            <Button
              onClick={generateRows}
              disabled={totalRows === 0}
              data-testid="bulk-next-step3"
            >
              Configure {totalRows} Row{totalRows === 1 ? '' : 's'} <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          )}
          {step === 3 && (
            <Button onClick={submit} disabled={submitting || rows.length === 0} data-testid="bulk-submit-btn">
              {submitting ? 'Registering…' : (<><Plus className="h-4 w-4 mr-1" /> Register {rows.length} instrument(s)</>)}
            </Button>
          )}
          {step === 4 && (
            <Button onClick={onClose} data-testid="bulk-close-btn">Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
