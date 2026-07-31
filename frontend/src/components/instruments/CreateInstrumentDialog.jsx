import React from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../ui/dialog';
import { TYPE_OPTIONS, CATEGORY_OPTIONS, INSTRUMENT_CATEGORY_MAP } from './instrumentOptions';

// Admin — register a new physical device (extracted from Instruments.jsx).
export const CreateInstrumentDialog = ({ open, onOpenChange, form, setForm, users, onSubmit }) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Instrument</DialogTitle>
          <DialogDescription>Register a new physical device and assign it to a client account.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Hardware ID *</Label>
            <Input value={form.hardware_id} onChange={(e) => setForm({ ...form, hardware_id: e.target.value })} placeholder="e.g. FM_PLANT_A_01" data-testid="instrument-hw-id" />
            <p className="text-xs text-gray-500 mt-1">Must match the device&apos;s MQTT topic ID.</p>
          </div>
          <div>
            <Label>Instrument Type *</Label>
            <select className="w-full border rounded px-3 py-2" value={form.instrument_type} onChange={(e) => setForm({ ...form, instrument_type: e.target.value })} data-testid="instrument-type">
              {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {form.instrument_type === 'flowmeter' && (
            <div>
              <Label>Category *</Label>
              <select className="w-full border rounded px-3 py-2" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} data-testid="instrument-category">
                {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          )}
          {form.instrument_type !== 'flowmeter' && INSTRUMENT_CATEGORY_MAP[form.instrument_type] && (
            <div>
              <Label>Category</Label>
              <div
                className="w-full border rounded px-3 py-2 bg-gray-50 text-gray-700 text-sm"
                data-testid="instrument-fixed-category"
              >
                {INSTRUMENT_CATEGORY_MAP[form.instrument_type].label}
                <span className="ml-2 text-[10px] uppercase tracking-wider text-gray-500">auto</span>
              </div>
              <p className="text-[11px] text-gray-500 mt-1">Category is fixed for this instrument type and grouped accordingly in reports.</p>
            </div>
          )}
          <div>
            <Label>Owner (Client) *</Label>
            <select className="w-full border rounded px-3 py-2" value={form.owner_user_id} onChange={(e) => setForm({ ...form, owner_user_id: e.target.value })} data-testid="instrument-owner">
              <option value="">— Select a user —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{`${u.full_name || u.email} (${u.role})`}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Display Label</Label>
            <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Friendly name shown on dashboard" data-testid="instrument-label" />
          </div>
          <div>
            <Label>Location Name</Label>
            <Input value={form.location_name} onChange={(e) => setForm({ ...form, location_name: e.target.value })} placeholder="e.g. Borewell #3" />
          </div>
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
                placeholder="26.846743 (paste 'lat,lng' from Google Maps to fill both)"
                data-testid="input-latitude"
              />
            </div>
            <div>
              <Label>Longitude</Label>
              <Input
                type="number"
                step="0.000001"
                value={form.longitude}
                onChange={(e) => setForm({ ...form, longitude: e.target.value })}
                placeholder="80.946159"
                data-testid="input-longitude"
              />
            </div>
          </div>
          <div>
            <Label>IMEI / Device ID *</Label>
            <Input
              value={form.imei}
              onChange={(e) => setForm({ ...form, imei: e.target.value })}
              placeholder="e.g. 860738070478155 or DTU10020426"
              data-testid="instrument-imei"
            />
            <p className="text-xs text-gray-500 mt-1">SIM/modem IMEI or vendor deviceId (alphanumeric, no length limit). Used to route incoming MQTT/HTTP data to this instrument.</p>
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
                data-testid="instrument-manual-temp"
              />
              <p className="text-xs text-gray-500 mt-1">DWLR does not transmit temperature. This value is shown to the client (admin-only editable).</p>
            </div>
          )}
          {(form.instrument_type === 'wq_stp' || form.instrument_type === 'do_meter' || form.instrument_type === 'chlorine_analyzer') && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Plant Capacity (KLD)</Label>
                <Input type="number" step="1" value={form.plant_capacity_kld}
                       onChange={(e) => setForm({ ...form, plant_capacity_kld: e.target.value })}
                       placeholder="e.g. 500" data-testid="instrument-plant-cap" />
                <p className="text-[10px] text-gray-500 mt-1">Total plant treatment capacity (kilolitres per day).</p>
              </div>
              <div>
                <Label>Aeration Tank Capacity (KLD)</Label>
                <Input type="number" step="1" value={form.tank_capacity_kld}
                       onChange={(e) => setForm({ ...form, tank_capacity_kld: e.target.value })}
                       placeholder="e.g. 250" data-testid="instrument-tank-cap" />
                <p className="text-[10px] text-gray-500 mt-1">Individual aeration tank capacity (KLD).</p>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onSubmit} data-testid="create-instrument-submit">Register</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
