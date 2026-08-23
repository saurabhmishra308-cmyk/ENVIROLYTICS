import React from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../ui/dialog';
import { Dices, History, RefreshCw } from 'lucide-react';
import { cleanLabel } from '../../utils/labels';

// Per-instrument dummy-data automation + historical backfill (extracted from Instruments.jsx).
export const DummyModeDialog = ({
  open, onClose, dummyTarget, dummyTab, setDummyTab,
  dummyForm, setDummyForm, backfillForm, setBackfillForm,
  backfillResult, dummySubmitting, submitDummyLive, submitBackfill,
}) => {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-700">
            <Dices className="h-5 w-5" /> Dummy Data — {cleanLabel(dummyTarget?.label || dummyTarget?.hardware_id)}
            <span className="text-xs bg-gray-100 px-2 py-0.5 rounded font-mono ml-2">{dummyTarget?.instrument_type}</span>
          </DialogTitle>
          <DialogDescription>
            Generate realistic-looking readings when the physical device is offline.
            Values follow a bounded random walk with a diurnal cycle and a per-day
            offset — no two days will produce identical data.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 border-b mb-4" role="tablist">
          <button
            role="tab"
            aria-selected={dummyTab === 'live'}
            onClick={() => setDummyTab('live')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${dummyTab === 'live' ? 'border-amber-500 text-amber-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            data-testid="dummy-tab-live"
          >
            <RefreshCw className="h-3.5 w-3.5 inline mr-1" /> Live Automation
          </button>
          <button
            role="tab"
            aria-selected={dummyTab === 'backfill'}
            onClick={() => setDummyTab('backfill')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${dummyTab === 'backfill' ? 'border-amber-500 text-amber-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            data-testid="dummy-tab-backfill"
          >
            <History className="h-3.5 w-3.5 inline mr-1" /> Historical Backfill (up to 5 years)
          </button>
        </div>

        {dummyTab === 'live' ? (
          <div className="space-y-4" data-testid="dummy-live-panel">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50">
              <input
                id="dummy-enabled"
                type="checkbox"
                className="h-5 w-5"
                checked={dummyForm.enabled}
                onChange={(e) => setDummyForm({ ...dummyForm, enabled: e.target.checked })}
                data-testid="dummy-enabled-toggle"
              />
              <label htmlFor="dummy-enabled" className="font-medium">
                {dummyForm.enabled ? 'ON — a new reading will be generated every interval' : 'OFF — no data generated'}
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Min value *</Label>
                <Input
                  type="number" step="0.01"
                  value={dummyForm.min_value}
                  onChange={(e) => setDummyForm({ ...dummyForm, min_value: e.target.value })}
                  data-testid="dummy-min"
                />
              </div>
              <div>
                <Label>Max value *</Label>
                <Input
                  type="number" step="0.01"
                  value={dummyForm.max_value}
                  onChange={(e) => setDummyForm({ ...dummyForm, max_value: e.target.value })}
                  data-testid="dummy-max"
                />
              </div>
            </div>
            <div>
              <Label>Interval (seconds) — how often a new reading is generated</Label>
              <Input
                type="number" min="30" max="86400"
                value={dummyForm.interval_seconds}
                onChange={(e) => setDummyForm({ ...dummyForm, interval_seconds: e.target.value })}
                data-testid="dummy-interval"
              />
              <p className="text-xs text-gray-500 mt-1">
                Common values: 900 (15 min), 1800 (30 min), 3600 (1 hour). Real MQTT messages always override dummy generation within the same window.
              </p>
            </div>
            <div className="text-xs text-gray-600 p-3 bg-blue-50 rounded-lg">
              <p><strong>Unit for {dummyTarget?.instrument_type}:</strong> {dummyTarget?.instrument_type === 'flowmeter' ? 'L/H (litres per hour)' : 'mWC (metres of water column)'}</p>
              <p className="mt-1">Data will be stored with the same wire format as real device payloads (LEVEL / LVL for DWLR, flow_rate_m3h + totalizers for Flowmeter). Every dummy row is internally marked <code>_dummy=true</code> for auditability.</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button
                onClick={submitDummyLive}
                disabled={dummySubmitting}
                className="bg-amber-500 hover:bg-amber-600 text-white"
                data-testid="dummy-live-submit"
              >
                {dummySubmitting ? 'Saving…' : (dummyForm.enabled ? 'Enable Dummy Mode' : 'Save (Disabled)')}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4" data-testid="dummy-backfill-panel">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>From (start of history) *</Label>
                <Input
                  type="datetime-local"
                  value={backfillForm.from_date}
                  onChange={(e) => setBackfillForm({ ...backfillForm, from_date: e.target.value })}
                  data-testid="backfill-from"
                />
                <p className="text-[10px] text-gray-500 mt-1">Maximum 5 years in the past</p>
              </div>
              <div>
                <Label>To (end of history) *</Label>
                <Input
                  type="datetime-local"
                  value={backfillForm.to_date}
                  onChange={(e) => setBackfillForm({ ...backfillForm, to_date: e.target.value })}
                  data-testid="backfill-to"
                />
                <p className="text-[10px] text-gray-500 mt-1">Cannot be in the future</p>
              </div>
            </div>
            <div>
              <Label>Interval between readings (seconds)</Label>
              <Input
                type="number" min="30" max="86400"
                value={backfillForm.interval_seconds}
                onChange={(e) => setBackfillForm({ ...backfillForm, interval_seconds: e.target.value })}
                data-testid="backfill-interval"
              />
              <p className="text-[10px] text-gray-500 mt-1">
                60 → every minute · 900 → every 15 min · 3600 → hourly · 86400 → daily.
                Max 200,000 rows per backfill — use larger interval for long ranges.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Min value *</Label>
                <Input type="number" step="0.01" value={backfillForm.min_value}
                       onChange={(e) => setBackfillForm({ ...backfillForm, min_value: e.target.value })}
                       data-testid="backfill-min" />
              </div>
              <div>
                <Label>Max value *</Label>
                <Input type="number" step="0.01" value={backfillForm.max_value}
                       onChange={(e) => setBackfillForm({ ...backfillForm, max_value: e.target.value })}
                       data-testid="backfill-max" />
              </div>
            </div>

            {backfillResult && (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200" data-testid="backfill-result">
                <div className="text-sm font-semibold text-emerald-800 mb-1">
                  ✅ Inserted {backfillResult.inserted_count?.toLocaleString?.() ?? backfillResult.inserted_count} readings
                </div>
                <div className="text-xs text-gray-700 font-mono">
                  {backfillResult.from_date} → {backfillResult.to_date} · every {backfillResult.interval_seconds}s · [{backfillResult.min_value} .. {backfillResult.max_value}]
                </div>
                <p className="text-xs text-gray-600 mt-2">
                  Data is now visible in reports, charts and CSV exports for this instrument.
                </p>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Close</Button>
              <Button
                onClick={submitBackfill}
                disabled={dummySubmitting}
                className="bg-amber-500 hover:bg-amber-600 text-white"
                data-testid="backfill-submit"
              >
                {dummySubmitting ? 'Generating…' : 'Generate Historical Data'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
