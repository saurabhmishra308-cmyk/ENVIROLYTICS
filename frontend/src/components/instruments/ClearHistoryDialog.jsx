import React from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../ui/dialog';
import { Eraser, RefreshCw } from 'lucide-react';
import { cleanLabel } from '../../utils/labels';

// Clear historical readings in a date range (extracted from Instruments.jsx).
export const ClearHistoryDialog = ({ clearTarget, setClearTarget, onClose, clearing, onSubmit }) => {
  return (
    <Dialog open={!!clearTarget} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-700">
            <Eraser className="h-5 w-5" /> Clear historical data
          </DialogTitle>
          <DialogDescription>
            Deletes readings for the selected date range (both bounds inclusive).
            Leave both fields empty to wipe all history for this device.
          </DialogDescription>
        </DialogHeader>
        {clearTarget && (
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              <span className="text-gray-500">Device:</span> <strong>{cleanLabel(clearTarget.device.label || clearTarget.device.hardware_id)}</strong>
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>From</Label>
                <Input
                  type="datetime-local"
                  value={clearTarget.from}
                  onChange={(e) => setClearTarget({ ...clearTarget, from: e.target.value })}
                  data-testid="clear-from"
                />
              </div>
              <div>
                <Label>To</Label>
                <Input
                  type="datetime-local"
                  value={clearTarget.to}
                  onChange={(e) => setClearTarget({ ...clearTarget, to: e.target.value })}
                  data-testid="clear-to"
                />
              </div>
            </div>
            <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700">
              <strong>Warning:</strong> deleted readings cannot be recovered.
              The delete is logged in the audit trail with your account.
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={clearing}>Cancel</Button>
          <Button className="bg-red-600 hover:bg-red-700" onClick={onSubmit} disabled={clearing} data-testid="clear-confirm-btn">
            {clearing ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Deleting…</> : <><Eraser className="h-4 w-4 mr-2" /> Delete readings</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
