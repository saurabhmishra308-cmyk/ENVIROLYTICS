import React from 'react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Cpu, Trash2, MapPin } from 'lucide-react';
import { INSTRUMENT_TYPE_OPTIONS, FLOWMETER_CATEGORY_OPTIONS } from './userInstrumentOptions';

// One instrument row inside the create-user wizard (extracted from User.jsx).
export const InstrumentRowCard = ({ row, idx, onUpdate, onRemove, onPickMap }) => {
  return (
    <Card key={idx} className="border-blue-100" data-testid={`instrument-row-${idx}`}>
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold text-blue-700 flex items-center gap-1.5">
            <Cpu className="h-3.5 w-3.5" /> Instrument #{idx + 1}
          </div>
          <Button type="button" size="sm" variant="ghost" className="text-red-600 h-7 px-2" onClick={() => onRemove(idx)} data-testid={`remove-instrument-row-${idx}`}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Hardware ID *</Label>
            <Input value={row.hardware_id} onChange={(e) => onUpdate(idx, { hardware_id: e.target.value })} placeholder="e.g. FM_PLANT_A_01" data-testid={`instrument-hw-${idx}`} />
          </div>
          <div>
            <Label className="text-xs">Instrument Type *</Label>
            <select className="w-full border rounded px-3 py-2 h-10" value={row.instrument_type} onChange={(e) => onUpdate(idx, { instrument_type: e.target.value })} data-testid={`instrument-type-${idx}`}>
              {INSTRUMENT_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Display Label</Label>
            <Input value={row.label} onChange={(e) => onUpdate(idx, { label: e.target.value })} placeholder="Friendly name" />
          </div>
          {row.instrument_type === 'flowmeter' ? (
            <div>
              <Label className="text-xs">Category *</Label>
              <select className="w-full border rounded px-3 py-2 h-10" value={row.category} onChange={(e) => onUpdate(idx, { category: e.target.value })}>
                {FLOWMETER_CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          ) : (
            <div>
              <Label className="text-xs">Location Name</Label>
              <Input value={row.location_name} onChange={(e) => onUpdate(idx, { location_name: e.target.value })} placeholder="e.g. Borewell #3" />
            </div>
          )}
        </div>
        {row.instrument_type === 'flowmeter' && (
          <div>
            <Label className="text-xs">Location Name</Label>
            <Input value={row.location_name} onChange={(e) => onUpdate(idx, { location_name: e.target.value })} placeholder="e.g. Borewell #3" />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-xs">Latitude</Label><Input value={row.latitude} onChange={(e) => onUpdate(idx, { latitude: e.target.value })} placeholder="26.8467" data-testid={`instrument-lat-${idx}`} /></div>
          <div><Label className="text-xs">Longitude</Label><Input value={row.longitude} onChange={(e) => onUpdate(idx, { longitude: e.target.value })} placeholder="80.9462" data-testid={`instrument-lng-${idx}`} /></div>
        </div>
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => onPickMap(idx)} data-testid={`instrument-pick-map-${idx}`}>
            <MapPin className="h-3.5 w-3.5 mr-1" /> Pick on map
          </Button>
          <span className="ml-2 text-[10px] text-gray-500">Click on the map to capture the exact installation coordinates.</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Telemetry Source *</Label>
            <select
              className="w-full border rounded px-3 py-2 h-10"
              value={row.source || 'mqtt'}
              onChange={(e) => onUpdate(idx, { source: e.target.value })}
              data-testid={`instrument-source-${idx}`}
            >
              <option value="mqtt">MQTT (direct broker)</option>
              <option value="http">HTTP (QESPL polling)</option>
            </select>
          </div>
          <div>
            <Label className="text-xs">
              {row.source === 'http' ? 'Vendor deviceId *' : 'IMEI (admin-only)'}
            </Label>
            <Input
              value={row.imei}
              onChange={(e) => onUpdate(idx, {
                imei: row.source === 'http' ? e.target.value.trim() : e.target.value.replace(/\D/g, ''),
              })}
              placeholder={row.source === 'http' ? 'e.g. DTU10020426' : 'e.g. 860738070478155'}
              maxLength={row.source === 'http' ? 32 : 16}
              data-testid={`instrument-imei-${idx}`}
            />
            <p className="text-[10px] text-gray-500 mt-1">
              {row.source === 'http'
                ? 'QESPL deviceId — the 5-min HTTP poller uses this to fetch readings.'
                : 'IMEI on the device SIM/modem. Used to match incoming MQTT data.'}
            </p>
          </div>
        </div>
        {row.instrument_type === 'do_meter' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Aeration Tank #</Label>
              <Input
                type="number" min="1" max="100"
                value={row.aeration_tank_number}
                onChange={(e) => onUpdate(idx, { aeration_tank_number: e.target.value })}
                placeholder="e.g. 1"
                data-testid={`instrument-tank-num-${idx}`}
              />
              <p className="text-[10px] text-gray-500 mt-1">Which aeration tank this DO sensor is mounted in (1..100).</p>
            </div>
            <div />
          </div>
        )}
        {['wq_stp', 'do_meter', 'chlorine_analyzer'].includes(row.instrument_type) && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Plant Capacity (KLD)</Label>
              <Input
                type="number"
                value={row.plant_capacity_kld}
                onChange={(e) => onUpdate(idx, { plant_capacity_kld: e.target.value })}
                placeholder="e.g. 500"
              />
            </div>
            <div>
              <Label className="text-xs">Tank Capacity (KLD)</Label>
              <Input
                type="number"
                value={row.tank_capacity_kld}
                onChange={(e) => onUpdate(idx, { tank_capacity_kld: e.target.value })}
                placeholder="e.g. 250"
              />
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          {row.instrument_type === 'dwlr' ? (
            <div>
              <Label className="text-xs">Water Temperature (°C)</Label>
              <Input
                type="number"
                step="0.1"
                value={row.manual_water_temp_c}
                onChange={(e) => onUpdate(idx, { manual_water_temp_c: e.target.value })}
                placeholder="e.g. 22.5"
                data-testid={`instrument-temp-${idx}`}
              />
              <p className="text-[10px] text-gray-500 mt-1">DWLR does not transmit temperature. Admin-set value shown to client.</p>
            </div>
          ) : (
            <div />
          )}
        </div>
      </CardContent>
    </Card>
  );
};
