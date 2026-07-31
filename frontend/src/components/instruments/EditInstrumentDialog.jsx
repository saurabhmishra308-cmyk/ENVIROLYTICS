import React from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../ui/dialog';
import { TYPE_OPTIONS, CATEGORY_OPTIONS } from './instrumentOptions';

// Admin — edit instrument assignment / thresholds (extracted from Instruments.jsx).
export const EditInstrumentDialog = ({
  open, onOpenChange, form, setForm, users, editTarget,
  thresholdForm, setThresholdForm, saveThresholds, savingThresholds, onSubmit,
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Instrument — {editTarget?.hardware_id}</DialogTitle>
          <DialogDescription>Update assignment, label, or location for this device.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Instrument Type</Label>
            <select className="w-full border rounded px-3 py-2" value={form.instrument_type} onChange={(e) => setForm({ ...form, instrument_type: e.target.value })}>
              {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {form.instrument_type === 'flowmeter' && (
            <div>
              <Label>Category</Label>
              <select className="w-full border rounded px-3 py-2" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          )}
          <div>
            <Label>Owner (Client)</Label>
            <select className="w-full border rounded px-3 py-2" value={form.owner_user_id} onChange={(e) => setForm({ ...form, owner_user_id: e.target.value })}>
              <option value="">— Select a user —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{`${u.full_name || u.email} (${u.role})`}</option>
              ))}
            </select>
          </div>
          <div><Label>Display Label</Label><Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></div>
          <div><Label>Location Name</Label><Input value={form.location_name} onChange={(e) => setForm({ ...form, location_name: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Latitude</Label>
              <Input
                type="number"
                step="0.000001"
                value={form.latitude}
                onPaste={(e) => {
                  const txt = e.clipboardData.getData('text');
                  if (txt && txt.includes(',')) {
                    const parts = txt.split(',').map((s) => s.trim());
                    if (parts.length === 2 && parts.every((p) => p && !Number.isNaN(Number(p)))) {
                      e.preventDefault();
                      setForm({ ...form, latitude: parts[0], longitude: parts[1] });
                    }
                  }
                }}
                onChange={(e) => setForm({ ...form, latitude: e.target.value })}
                data-testid="edit-input-latitude"
              />
            </div>
            <div>
              <Label>Longitude</Label>
              <Input
                type="number"
                step="0.000001"
                value={form.longitude}
                onChange={(e) => setForm({ ...form, longitude: e.target.value })}
                data-testid="edit-input-longitude"
              />
            </div>
          </div>
          <div>
            <Label>IMEI / Device ID *</Label>
            <Input
              value={form.imei}
              onChange={(e) => setForm({ ...form, imei: e.target.value })}
              placeholder="e.g. 860738070478155 or DTU10020426"
              data-testid="edit-instrument-imei"
            />
            <p className="text-xs text-gray-500 mt-1">Alphanumeric SIM IMEI (MQTT) or vendor deviceId (HTTP). No length limit.</p>
          </div>
          {form.instrument_type === 'dwlr' && (
            <div>
              <Label>Water Temperature (°C)</Label>
              <Input
                type="number"
                step="0.1"
                value={form.manual_water_temp_c}
                onChange={(e) => setForm({ ...form, manual_water_temp_c: e.target.value })}
                placeholder="e.g. 22.5"
                data-testid="edit-instrument-manual-temp"
              />
              <p className="text-xs text-gray-500 mt-1">DWLR does not transmit temperature — admin-set value shown to the client.</p>
            </div>
          )}
          {(form.instrument_type === 'wq_stp' || form.instrument_type === 'do_meter' || form.instrument_type === 'chlorine_analyzer') && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Plant Capacity (KLD)</Label>
                <Input type="number" step="1" value={form.plant_capacity_kld}
                       onChange={(e) => setForm({ ...form, plant_capacity_kld: e.target.value })}
                       data-testid="edit-instrument-plant-cap" />
              </div>
              <div>
                <Label>Aeration Tank Capacity (KLD)</Label>
                <Input type="number" step="1" value={form.tank_capacity_kld}
                       onChange={(e) => setForm({ ...form, tank_capacity_kld: e.target.value })}
                       data-testid="edit-instrument-tank-cap" />
              </div>
            </div>
          )}
          {(form.instrument_type === 'wq_stp' || form.instrument_type === 'chlorine_analyzer' || form.instrument_type === 'do_meter') && (
            <div className="rounded border bg-sky-50/60 p-3 border-sky-200" data-testid="edit-instrument-thresholds">
              <div className="text-xs font-semibold text-sky-900 mb-2">Alert thresholds (admin-only)</div>
              <div className="grid grid-cols-3 gap-3">
                {form.instrument_type === 'wq_stp' && (
                  <div>
                    <Label className="text-xs">Turbidity k (TSS × k)</Label>
                    <Input type="number" step="0.01" min="0" max="5"
                           value={thresholdForm.turbidity_k}
                           onChange={(e) => setThresholdForm({ ...thresholdForm, turbidity_k: e.target.value })}
                           placeholder="0.5"
                           data-testid="edit-instrument-turbidity-k" />
                  </div>
                )}
                {(form.instrument_type === 'wq_stp' || form.instrument_type === 'chlorine_analyzer') && (
                  <>
                    <div>
                      <Label className="text-xs">Chlorine min (mg/L)</Label>
                      <Input type="number" step="0.01" min="0" max="10"
                             value={thresholdForm.chlorine_min}
                             onChange={(e) => setThresholdForm({ ...thresholdForm, chlorine_min: e.target.value })}
                             placeholder="0.2"
                             data-testid="edit-instrument-chlorine-min" />
                    </div>
                    <div>
                      <Label className="text-xs">Chlorine max (mg/L)</Label>
                      <Input type="number" step="0.01" min="0" max="10"
                             value={thresholdForm.chlorine_max}
                             onChange={(e) => setThresholdForm({ ...thresholdForm, chlorine_max: e.target.value })}
                             placeholder="2.0"
                             data-testid="edit-instrument-chlorine-max" />
                    </div>
                  </>
                )}
              </div>
              {/* Automated dose recommendation — plumbed into the Chlorine
                  Analyzer + STP tabs so ops can act on the alert directly. */}
              {(form.instrument_type === 'wq_stp' || form.instrument_type === 'chlorine_analyzer') && (
                <div className="mt-3 pt-3 border-t border-sky-200">
                  <div className="text-xs font-semibold text-sky-900 mb-2">Chlorine dose config — powers the automated dose recommendation</div>
                  <div className="grid grid-cols-4 gap-3">
                    <div>
                      <Label className="text-xs">Dose target (mg/L)</Label>
                      <Input type="number" step="0.05" min="0" max="10"
                             value={thresholdForm.chlorine_dose_target_mg_l}
                             onChange={(e) => setThresholdForm({ ...thresholdForm, chlorine_dose_target_mg_l: e.target.value })}
                             placeholder="1.0"
                             data-testid="edit-instrument-dose-target" />
                    </div>
                    <div>
                      <Label className="text-xs">Solution (% NaOCl)</Label>
                      <Input type="number" step="0.5" min="0.5" max="100"
                             value={thresholdForm.chlorine_solution_pct}
                             onChange={(e) => setThresholdForm({ ...thresholdForm, chlorine_solution_pct: e.target.value })}
                             placeholder="12"
                             data-testid="edit-instrument-solution-pct" />
                    </div>
                    <div>
                      <Label className="text-xs">Pump (kW)</Label>
                      <Input type="number" step="0.01" min="0" max="100"
                             value={thresholdForm.chlorine_pump_kw}
                             onChange={(e) => setThresholdForm({ ...thresholdForm, chlorine_pump_kw: e.target.value })}
                             placeholder="0.15"
                             data-testid="edit-instrument-pump-kw" />
                    </div>
                    <div>
                      <Label className="text-xs">Flow (KLD)</Label>
                      <Input type="number" step="1" min="0"
                             value={thresholdForm.chlorine_flow_kld}
                             onChange={(e) => setThresholdForm({ ...thresholdForm, chlorine_flow_kld: e.target.value })}
                             placeholder="uses plant capacity"
                             data-testid="edit-instrument-chlorine-flow" />
                    </div>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between mt-2">
                <p className="text-[10.5px] text-sky-800 italic">
                  Leave blank to keep current values. Dose target defaults to the midpoint of min/max. Flow falls back to Plant Capacity.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px] border-sky-400 text-sky-800 hover:bg-sky-100"
                  onClick={saveThresholds}
                  disabled={savingThresholds}
                  data-testid="edit-instrument-save-thresholds"
                >
                  {savingThresholds ? 'Saving…' : 'Save thresholds'}
                </Button>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onSubmit} data-testid="edit-instrument-submit">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
