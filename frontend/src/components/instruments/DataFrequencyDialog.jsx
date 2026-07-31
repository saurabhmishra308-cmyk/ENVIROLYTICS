import React from 'react';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../ui/dialog';
import { Clock, RefreshCw } from 'lucide-react';
import { cleanLabel } from '../../utils/labels';

// Data receiving frequency + retention (extracted from Instruments.jsx).
export const DataFrequencyDialog = ({ freqTarget, setFreqTarget, onClose, savingFreq, onSubmit }) => {
  return (
    <Dialog open={!!freqTarget} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-800">
            <Clock className="h-5 w-5" /> Data receiving frequency
          </DialogTitle>
          <DialogDescription>
            How often incoming readings should be persisted to the history.
            The live tile always shows the most recent value regardless of this setting.
          </DialogDescription>
        </DialogHeader>
        {freqTarget && (
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              <span className="text-gray-500">Device:</span> <strong>{cleanLabel(freqTarget.device.label || freqTarget.device.hardware_id)}</strong>
            </p>
            <div>
              <Label>Store one reading every</Label>
              <select
                className="w-full border rounded px-3 py-2"
                value={freqTarget.minutes}
                onChange={(e) => setFreqTarget({ ...freqTarget, minutes: parseInt(e.target.value, 10) })}
                data-testid="freq-select"
              >
                <option value={0}>No throttling — store every reading</option>
                {[5, 10, 15, 30, 60, 120, 180, 240, 360, 480, 720, 1440].map((m) => (
                  <option key={m} value={m}>
                    {m < 60 ? `${m} min` : `${m / 60} hour${m === 60 ? '' : 's'}`}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-gray-500 mt-1">
                Any reading arriving within this window of the last stored one will be dropped from history.
              </p>
            </div>
            <div>
              <Label>Auto-purge readings older than</Label>
              <select
                className="w-full border rounded px-3 py-2"
                value={freqTarget.retention_days}
                onChange={(e) => setFreqTarget({ ...freqTarget, retention_days: parseInt(e.target.value, 10) })}
                data-testid="retention-select"
              >
                <option value={0}>Keep forever</option>
                {[7, 30, 60, 90, 180, 365, 730, 1095, 1825, 3650].map((d) => (
                  <option key={d} value={d}>
                    {d < 30 ? `${d} days` : d < 365 ? `${d} days (~${Math.round(d/30)} months)` : `${Math.round(d/365 * 10) / 10} year${d === 365 ? '' : 's'}`}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-gray-500 mt-1">
                A daily background job removes readings older than this to keep the database lean.
              </p>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={savingFreq}>Cancel</Button>
          <Button onClick={onSubmit} disabled={savingFreq} data-testid="freq-save-btn">
            {savingFreq ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Saving…</> : 'Save frequency'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
