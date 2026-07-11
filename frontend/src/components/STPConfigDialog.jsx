import React, { useEffect, useState } from 'react';
import { Loader2, Save, Plus, Trash2, Zap } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from './ui/dialog';
import { toast } from 'sonner';
import api, { formatApiError } from '../lib/api';

const num = (v) => (v === '' || v == null ? null : Number(v));
const s = (v) => (v == null || Number.isNaN(v) ? '' : String(v));

const emptyBlower = { label: '', capacity_m3ph: '', power_kw: '', running_hours_per_day: '' };

/**
 * Admin-only dialog to configure per-unit STP capacities, air blowers, pumps,
 * gardening/flushing source (manual OR linked flowmeter) and energy usage mode.
 */
export const STPConfigDialog = ({ open, onOpenChange, hardwareId, deviceLabel, existing, onSaved }) => {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    equalization_tank_kld: '',
    aeration_tank_kld: '',
    settling_tank_kld: '',
    filter_feed_tank_kld: '',
    treated_water_tank_kld: '',
    air_blowers: [{ ...emptyBlower, label: 'Air Blower - 1' }],
    filter_feed_pump: { capacity_kld: '', power_kw: '', running_hours_per_day: '' },
    gardening_flushing: {
      source: 'manual',
      linked_flowmeter_hw_id: '',
      manual_kld_per_day: '',
      pump_power_kw: '',
      running_hours_per_day: '',
    },
    energy: { mode: 'auto', manual_kwh_per_day: '' },
    // Realistic operating ranges — used by the dummy-data auto-push when the
    // physical instrument is offline. Also displayed as safe-range badges
    // on the effluent gauges.
    param_ranges: {
      COD: { min: '', max: '' },
      BOD: { min: '', max: '' },
      TSS: { min: '', max: '' },
      PH:  { min: '', max: '' },
    },
    dummy_auto_push: { enabled: false, interval_seconds: 86400 },
  });
  const [flowmeters, setFlowmeters] = useState([]);

  // Load existing config into the form when the dialog opens
  useEffect(() => {
    if (!open) return;
    const c = existing || {};
    setForm({
      equalization_tank_kld: s(c.equalization_tank_kld),
      aeration_tank_kld: s(c.aeration_tank_kld),
      settling_tank_kld: s(c.settling_tank_kld),
      filter_feed_tank_kld: s(c.filter_feed_tank_kld),
      treated_water_tank_kld: s(c.treated_water_tank_kld),
      air_blowers: (c.air_blowers && c.air_blowers.length
        ? c.air_blowers
        : [{ ...emptyBlower, label: 'Air Blower - 1' }]
      ).map((b) => ({
        label: b.label || '',
        capacity_m3ph: s(b.capacity_m3ph),
        power_kw: s(b.power_kw),
        running_hours_per_day: s(b.running_hours_per_day),
      })),
      filter_feed_pump: {
        capacity_kld: s(c.filter_feed_pump?.capacity_kld),
        power_kw: s(c.filter_feed_pump?.power_kw),
        running_hours_per_day: s(c.filter_feed_pump?.running_hours_per_day),
      },
      gardening_flushing: {
        source: c.gardening_flushing?.source || 'manual',
        linked_flowmeter_hw_id: c.gardening_flushing?.linked_flowmeter_hw_id || '',
        manual_kld_per_day: s(c.gardening_flushing?.manual_kld_per_day),
        pump_power_kw: s(c.gardening_flushing?.pump_power_kw),
        running_hours_per_day: s(c.gardening_flushing?.running_hours_per_day),
      },
      energy: {
        mode: c.energy?.mode || 'auto',
        manual_kwh_per_day: s(c.energy?.manual_kwh_per_day),
      },
      param_ranges: {
        COD: { min: s(c.param_ranges?.COD?.min), max: s(c.param_ranges?.COD?.max) },
        BOD: { min: s(c.param_ranges?.BOD?.min), max: s(c.param_ranges?.BOD?.max) },
        TSS: { min: s(c.param_ranges?.TSS?.min), max: s(c.param_ranges?.TSS?.max) },
        PH:  { min: s(c.param_ranges?.PH?.min),  max: s(c.param_ranges?.PH?.max)  },
      },
      dummy_auto_push: {
        enabled: Boolean(c.dummy_auto_push?.enabled),
        interval_seconds: c.dummy_auto_push?.interval_seconds || 86400,
      },
    });
  }, [open, existing]);

  // Pull available flowmeters for the "linked flowmeter" dropdown
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const { data } = await api.get('/api/instrument-registry?instrument_type=flowmeter');
        setFlowmeters(data.instruments || []);
      } catch (_) { /* silent */ }
    })();
  }, [open]);

  const addBlower = () => setForm((f) => ({
    ...f,
    air_blowers: [...f.air_blowers, { ...emptyBlower, label: `Air Blower - ${f.air_blowers.length + 1}` }],
  }));
  const removeBlower = (idx) => setForm((f) => ({
    ...f,
    air_blowers: f.air_blowers.filter((_, i) => i !== idx),
  }));
  const setBlower = (idx, patch) => setForm((f) => ({
    ...f,
    air_blowers: f.air_blowers.map((b, i) => (i === idx ? { ...b, ...patch } : b)),
  }));

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        equalization_tank_kld: num(form.equalization_tank_kld),
        aeration_tank_kld: num(form.aeration_tank_kld),
        settling_tank_kld: num(form.settling_tank_kld),
        filter_feed_tank_kld: num(form.filter_feed_tank_kld),
        treated_water_tank_kld: num(form.treated_water_tank_kld),
        air_blowers: form.air_blowers.map((b) => ({
          label: b.label || 'Blower',
          capacity_m3ph: num(b.capacity_m3ph),
          power_kw: num(b.power_kw),
          running_hours_per_day: num(b.running_hours_per_day),
        })),
        filter_feed_pump: {
          capacity_kld: num(form.filter_feed_pump.capacity_kld),
          power_kw: num(form.filter_feed_pump.power_kw),
          running_hours_per_day: num(form.filter_feed_pump.running_hours_per_day),
        },
        gardening_flushing: {
          source: form.gardening_flushing.source,
          linked_flowmeter_hw_id: form.gardening_flushing.source === 'flowmeter'
            ? (form.gardening_flushing.linked_flowmeter_hw_id || null)
            : null,
          manual_kld_per_day: num(form.gardening_flushing.manual_kld_per_day),
          pump_power_kw: num(form.gardening_flushing.pump_power_kw),
          running_hours_per_day: num(form.gardening_flushing.running_hours_per_day),
        },
        energy: {
          mode: form.energy.mode,
          manual_kwh_per_day: form.energy.mode === 'manual' ? num(form.energy.manual_kwh_per_day) : null,
        },
        param_ranges: {
          COD: { min: num(form.param_ranges.COD.min), max: num(form.param_ranges.COD.max) },
          BOD: { min: num(form.param_ranges.BOD.min), max: num(form.param_ranges.BOD.max) },
          TSS: { min: num(form.param_ranges.TSS.min), max: num(form.param_ranges.TSS.max) },
          PH:  { min: num(form.param_ranges.PH.min),  max: num(form.param_ranges.PH.max)  },
        },
        dummy_auto_push: {
          enabled: Boolean(form.dummy_auto_push.enabled),
          interval_seconds: Number(form.dummy_auto_push.interval_seconds) || 86400,
        },
      };
      const { data } = await api.put(`/api/water-quality/${encodeURIComponent(hardwareId)}/stp-config`, payload);
      toast.success(`Plant configuration saved · ${data.stp_derived?.energy_kwh_per_day ?? 0} kWh/day`);
      await onSaved?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Save failed');
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="stp-config-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-600" />
            Configure STP Plant Units
          </DialogTitle>
          <DialogDescription className="text-xs text-gray-500">
            {deviceLabel} · <code className="bg-gray-100 px-1 rounded">{hardwareId}</code>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Tank capacities */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-2 border-b pb-1">Tank capacities (KLD)</h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                ['equalization_tank_kld', 'Equalization Tank'],
                ['aeration_tank_kld', 'Aeration Tank'],
                ['settling_tank_kld', 'Settling Tank'],
                ['filter_feed_tank_kld', 'Filter Feed Tank'],
                ['treated_water_tank_kld', 'Treated Water Tank'],
              ].map(([key, label]) => (
                <div key={key}>
                  <Label className="text-xs">{label}</Label>
                  <Input
                    type="number"
                    step="1"
                    min="0"
                    value={form[key]}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    placeholder="KLD"
                    data-testid={`stpcfg-${key}`}
                  />
                </div>
              ))}
            </div>
          </section>

          {/* Air blowers */}
          <section>
            <div className="flex items-center justify-between mb-2 border-b pb-1">
              <h3 className="text-sm font-semibold text-gray-800">Air Blowers</h3>
              <Button size="sm" variant="outline" onClick={addBlower} data-testid="stpcfg-add-blower">
                <Plus className="h-3 w-3 mr-1" /> Add blower
              </Button>
            </div>
            <div className="space-y-2">
              {form.air_blowers.map((b, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-end p-2 rounded border bg-slate-50" data-testid={`stpcfg-blower-${i}`}>
                  <div className="col-span-3">
                    <Label className="text-xs">Label</Label>
                    <Input value={b.label} onChange={(e) => setBlower(i, { label: e.target.value })} />
                  </div>
                  <div className="col-span-3">
                    <Label className="text-xs">Capacity (m³/hr)</Label>
                    <Input type="number" step="1" min="0" value={b.capacity_m3ph}
                           onChange={(e) => setBlower(i, { capacity_m3ph: e.target.value })} />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Power (kW)</Label>
                    <Input type="number" step="0.1" min="0" value={b.power_kw}
                           onChange={(e) => setBlower(i, { power_kw: e.target.value })} />
                  </div>
                  <div className="col-span-3">
                    <Label className="text-xs">Running hrs/day</Label>
                    <Input type="number" step="0.5" min="0" max="24" value={b.running_hours_per_day}
                           onChange={(e) => setBlower(i, { running_hours_per_day: e.target.value })} />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    {form.air_blowers.length > 1 && (
                      <Button variant="ghost" size="sm" onClick={() => removeBlower(i)}
                              className="text-red-600 hover:bg-red-50" data-testid={`stpcfg-remove-blower-${i}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Filter feed pump */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-2 border-b pb-1">Filter Feed Pump</h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Capacity (KLD)</Label>
                <Input type="number" step="1" min="0" value={form.filter_feed_pump.capacity_kld}
                       onChange={(e) => setForm({ ...form, filter_feed_pump: { ...form.filter_feed_pump, capacity_kld: e.target.value } })}
                       data-testid="stpcfg-ffp-capacity" />
              </div>
              <div>
                <Label className="text-xs">Power (kW)</Label>
                <Input type="number" step="0.1" min="0" value={form.filter_feed_pump.power_kw}
                       onChange={(e) => setForm({ ...form, filter_feed_pump: { ...form.filter_feed_pump, power_kw: e.target.value } })}
                       data-testid="stpcfg-ffp-power" />
              </div>
              <div>
                <Label className="text-xs">Running hrs/day</Label>
                <Input type="number" step="0.5" min="0" max="24" value={form.filter_feed_pump.running_hours_per_day}
                       onChange={(e) => setForm({ ...form, filter_feed_pump: { ...form.filter_feed_pump, running_hours_per_day: e.target.value } })}
                       data-testid="stpcfg-ffp-hours" />
              </div>
            </div>
          </section>

          {/* Gardening / flushing */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-2 border-b pb-1">Gardening / Flushing consumption</h3>
            <div className="flex gap-4 mb-2">
              {['manual', 'flowmeter'].map((src) => (
                <label key={src} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="gf-source"
                    value={src}
                    checked={form.gardening_flushing.source === src}
                    onChange={() => setForm({ ...form, gardening_flushing: { ...form.gardening_flushing, source: src } })}
                    data-testid={`stpcfg-gf-source-${src}`}
                  />
                  <span className="capitalize">{src === 'flowmeter' ? 'Linked flowmeter' : 'Manual entry'}</span>
                </label>
              ))}
            </div>
            {form.gardening_flushing.source === 'manual' ? (
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">Manual KLD / day</Label>
                  <Input type="number" step="1" min="0" value={form.gardening_flushing.manual_kld_per_day}
                         onChange={(e) => setForm({ ...form, gardening_flushing: { ...form.gardening_flushing, manual_kld_per_day: e.target.value } })}
                         data-testid="stpcfg-gf-manual-kld" />
                </div>
                <div>
                  <Label className="text-xs">Pump power (kW)</Label>
                  <Input type="number" step="0.1" min="0" value={form.gardening_flushing.pump_power_kw}
                         onChange={(e) => setForm({ ...form, gardening_flushing: { ...form.gardening_flushing, pump_power_kw: e.target.value } })} />
                </div>
                <div>
                  <Label className="text-xs">Running hrs/day</Label>
                  <Input type="number" step="0.5" min="0" max="24" value={form.gardening_flushing.running_hours_per_day}
                         onChange={(e) => setForm({ ...form, gardening_flushing: { ...form.gardening_flushing, running_hours_per_day: e.target.value } })} />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Label className="text-xs">Linked flowmeter</Label>
                  <select
                    className="w-full border rounded px-2 py-2 text-sm"
                    value={form.gardening_flushing.linked_flowmeter_hw_id}
                    onChange={(e) => setForm({ ...form, gardening_flushing: { ...form.gardening_flushing, linked_flowmeter_hw_id: e.target.value } })}
                    data-testid="stpcfg-gf-linked-fm"
                  >
                    <option value="">— Select flowmeter —</option>
                    {flowmeters.map((fm) => (
                      <option key={fm.hardware_id} value={fm.hardware_id}>
                        {fm.label || fm.hardware_id} · {fm.location_name || fm.hardware_id}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-gray-500 mt-1">
                    Daily consumption will be computed from the flowmeter&apos;s TOTAL counter (max − min over last 24 h).
                  </p>
                </div>
                <div>
                  <Label className="text-xs">Pump power (kW) — for energy calc</Label>
                  <Input type="number" step="0.1" min="0" value={form.gardening_flushing.pump_power_kw}
                         onChange={(e) => setForm({ ...form, gardening_flushing: { ...form.gardening_flushing, pump_power_kw: e.target.value } })} />
                </div>
              </div>
            )}
          </section>

          {/* Energy */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-2 border-b pb-1 flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-500" /> Energy usage
            </h3>
            <div className="flex gap-4 mb-2">
              {[
                { v: 'auto',   lbl: 'Auto-compute (Σ blowers + pumps × hours)' },
                { v: 'manual', lbl: 'Manual override (kWh/day)' },
              ].map((opt) => (
                <label key={opt.v} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio" name="energy-mode" value={opt.v}
                    checked={form.energy.mode === opt.v}
                    onChange={() => setForm({ ...form, energy: { ...form.energy, mode: opt.v } })}
                    data-testid={`stpcfg-energy-${opt.v}`}
                  />
                  {opt.lbl}
                </label>
              ))}
            </div>
            {form.energy.mode === 'manual' && (
              <Input type="number" step="1" min="0"
                     placeholder="e.g. 425 kWh/day"
                     value={form.energy.manual_kwh_per_day}
                     onChange={(e) => setForm({ ...form, energy: { ...form.energy, manual_kwh_per_day: e.target.value } })}
                     className="max-w-xs"
                     data-testid="stpcfg-energy-manual-kwh" />
            )}
          </section>

          {/* Effluent parameter ranges (used by dummy auto-push + safe-range hints) */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-2 border-b pb-1">Effluent parameter operating ranges</h3>
            <p className="text-[11px] text-gray-500 mb-2">
              These bands govern the daily values generated when the instrument is offline
              (see auto-push toggle below). Leave blank for realistic defaults.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              {[
                { key: 'COD', label: 'COD (mg/L)', step: '1',   hint: 'e.g. 30 – 250' },
                { key: 'BOD', label: 'BOD (mg/L)', step: '1',   hint: 'e.g. 5 – 30' },
                { key: 'TSS', label: 'TSS (mg/L)', step: '1',   hint: 'e.g. 10 – 100' },
                { key: 'PH',  label: 'pH',         step: '0.1', hint: 'e.g. 6.5 – 8.5' },
              ].map(({ key, label, step, hint }) => (
                <div key={key} className="rounded border p-2 bg-slate-50" data-testid={`stpcfg-range-${key}`}>
                  <Label className="text-xs font-semibold">{label}</Label>
                  <div className="text-[10px] text-gray-500 mb-1">{hint}</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <div>
                      <Label className="text-[10px] text-gray-500">Min</Label>
                      <Input type="number" step={step} min="0" value={form.param_ranges[key].min}
                             onChange={(e) => setForm({
                               ...form,
                               param_ranges: { ...form.param_ranges, [key]: { ...form.param_ranges[key], min: e.target.value } },
                             })}
                             data-testid={`stpcfg-range-${key}-min`} />
                    </div>
                    <div>
                      <Label className="text-[10px] text-gray-500">Max</Label>
                      <Input type="number" step={step} min="0" value={form.param_ranges[key].max}
                             onChange={(e) => setForm({
                               ...form,
                               param_ranges: { ...form.param_ranges, [key]: { ...form.param_ranges[key], max: e.target.value } },
                             })}
                             data-testid={`stpcfg-range-${key}-max`} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Auto-push dummy data when instrument is offline */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-2 border-b pb-1">Auto data push (offline safety net)</h3>
            <label className="flex items-start gap-2 cursor-pointer" data-testid="stpcfg-dummy-auto-push-label">
              <input
                type="checkbox"
                className="mt-1"
                checked={form.dummy_auto_push.enabled}
                onChange={(e) => setForm({
                  ...form,
                  dummy_auto_push: { ...form.dummy_auto_push, enabled: e.target.checked },
                })}
                data-testid="stpcfg-dummy-auto-push-enabled"
              />
              <div>
                <div className="text-sm font-medium">
                  Automatically push realistic daily data when the instrument is not sending
                </div>
                <div className="text-[11px] text-gray-500 max-w-lg">
                  When enabled, this device will publish one reading per day (or per chosen
                  interval) within the ranges above. If a real MQTT packet arrives, the auto-push
                  skips that window &mdash; real data always wins.
                </div>
              </div>
            </label>
            {form.dummy_auto_push.enabled && (
              <div className="mt-2 max-w-xs">
                <Label className="text-xs">Interval (seconds)</Label>
                <Input type="number" min="60" max="86400" step="60"
                       value={form.dummy_auto_push.interval_seconds}
                       onChange={(e) => setForm({
                         ...form,
                         dummy_auto_push: { ...form.dummy_auto_push, interval_seconds: e.target.value },
                       })}
                       data-testid="stpcfg-dummy-interval" />
                <div className="text-[10px] text-gray-500 mt-1">
                  Default: 86400 (once per day). Minimum: 60 s.
                </div>
              </div>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving} data-testid="stpcfg-save">
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            Save configuration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default STPConfigDialog;
