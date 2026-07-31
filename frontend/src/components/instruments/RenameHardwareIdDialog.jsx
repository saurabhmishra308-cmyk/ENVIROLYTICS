import React from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../ui/dialog';
import { Hash, RefreshCw } from 'lucide-react';

// Rename hardware_id with FK cascade (extracted from Instruments.jsx).
export const RenameHardwareIdDialog = ({ renameTarget, setRenameTarget, onClose, renaming, onSubmit }) => {
  return (
    <Dialog open={!!renameTarget} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-800">
            <Hash className="h-5 w-5" /> Rename Hardware ID
          </DialogTitle>
          <DialogDescription>
            Renames this device across every collection — readings, latest,
            limits, categories, alerts, audit log &amp; camera streams — so history
            stays attached to the same instrument. A rollback marker
            (<code>previous_hardware_id</code>) is stored on the registry row.
          </DialogDescription>
        </DialogHeader>
        {renameTarget && (
          <div className="space-y-3">
            <div className="text-sm space-y-1">
              <p><span className="text-gray-500">Device:</span> <strong>{renameTarget.device.label || renameTarget.device.hardware_id}</strong></p>
              <p><span className="text-gray-500">Current ID:</span> <span className="font-mono text-red-600">{renameTarget.device.hardware_id}</span></p>
            </div>
            <div>
              <Label>New hardware ID</Label>
              <Input
                value={renameTarget.new_id}
                onChange={(e) => setRenameTarget({ ...renameTarget, new_id: e.target.value })}
                placeholder="e.g. PIEZO_LTH_001"
                data-testid="rename-new-id"
                autoFocus
              />
              <p className="text-[11px] text-gray-500 mt-1">
                Use a short, alphanumeric ID (no spaces recommended). Must be unique across the registry.
              </p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-800">
              <strong>Heads-up:</strong> if your device publishes MQTT under a topic that
              embeds the old hardware_id, update the device firmware / gateway to match
              the new ID before renaming, otherwise new incoming messages won&apos;t link
              to this device.
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={renaming}>Cancel</Button>
          <Button onClick={onSubmit} disabled={renaming || !renameTarget?.new_id?.trim()} data-testid="rename-confirm-btn">
            {renaming ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Renaming…</> : <><Hash className="h-4 w-4 mr-2" /> Rename &amp; cascade</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
