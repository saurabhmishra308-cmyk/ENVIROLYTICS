import React from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../ui/dialog';
import { Radio } from 'lucide-react';

// Simulate an incoming MQTT message end-to-end (extracted from Instruments.jsx).
export const SimulateMessageDialog = ({ open, onClose, simForm, setSimForm, simResult, simSubmitting, onSubmit }) => {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-blue-700">
            <Radio className="h-5 w-5" /> Simulate Incoming IoT Message
          </DialogTitle>
          <DialogDescription>
            Push a (topic, payload) tuple through the exact same handler the live MQTT
            broker calls. Data is matched to an instrument by <code>IMEI</code> in the JSON
            payload, then stored just as if it arrived from the field.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Topic *</Label>
            <Input
              value={simForm.topic}
              onChange={(e) => setSimForm({ ...simForm, topic: e.target.value })}
              placeholder="e.g. P673/0 (DWLR) or 673/0 (Flowmeter)"
              data-testid="sim-topic"
            />
            <p className="text-xs text-gray-500 mt-1">
              Topics starting with <code>P</code> are treated as DWLR; anything else as Flowmeter.
            </p>
          </div>
          <div>
            <Label>Payload (JSON) *</Label>
            <textarea
              className="w-full border rounded px-3 py-2 font-mono text-xs h-56"
              value={simForm.payload}
              onChange={(e) => setSimForm({ ...simForm, payload: e.target.value })}
              data-testid="sim-payload"
            />
            <p className="text-xs text-gray-500 mt-1">
              The <code>IMEI</code> field inside the JSON identifies the target device.
              Prefilled example uses the IMEI of the selected instrument (or a default sample).
            </p>
          </div>

          {simResult && (
            <div
              className={`p-3 rounded-lg border ${simResult.dispatched ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}
              data-testid="sim-result"
            >
              {simResult.dispatched ? (
                <>
                  <div className="text-sm font-semibold text-green-800 mb-1">
                    ✅ Delivered — {simResult.hardware_id} ({simResult.instrument_type})
                  </div>
                  <div className="text-xs text-gray-700 font-mono">
                    topic: {simResult.topic} · IMEI: {simResult.imei}
                  </div>
                  <div className="text-xs text-gray-600 mt-2">
                    Data has been written to the database. Open the {simResult.instrument_type === 'flowmeter' ? 'Flowmeter' : 'Water Level Recorder'} page to see it live.
                  </div>
                </>
              ) : (
                <>
                  <div className="text-sm font-semibold text-amber-800 mb-1">⚠️ Not delivered</div>
                  <div className="text-xs text-gray-700">{simResult.reason}</div>
                </>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button
            onClick={onSubmit}
            disabled={simSubmitting || !simForm.topic.trim() || !simForm.payload.trim()}
            style={{ backgroundColor: '#4a9fd8' }}
            data-testid="sim-submit-btn"
          >
            {simSubmitting ? 'Delivering…' : 'Deliver Message'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
