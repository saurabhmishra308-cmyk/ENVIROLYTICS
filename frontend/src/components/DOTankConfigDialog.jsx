import React, { useEffect, useState } from 'react';
import { Loader2, Save, Droplets } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from './ui/dialog';
import { toast } from 'sonner';
import api, { formatApiError } from '../lib/api';

const s = (v) => (v == null ? '' : String(v));

/**
 * Admin-only dialog to configure independent capacities for Aeration Tank 1
 * and Aeration Tank 2 on a DO meter device.
 */
export const DOTankConfigDialog = ({ open, onOpenChange, hardwareId, deviceLabel, existing, onSaved }) => {
  const [saving, setSaving] = useState(false);
  const [t1, setT1] = useState('');
  const [t2, setT2] = useState('');

  useEffect(() => {
    if (!open) return;
    setT1(s(existing?.tank_1_kld));
    setT2(s(existing?.tank_2_kld));
  }, [open, existing]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/api/water-quality/${encodeURIComponent(hardwareId)}/do-tank-config`, {
        tank_1_kld: t1 === '' ? null : Number(t1),
        tank_2_kld: t2 === '' ? null : Number(t2),
      });
      toast.success('Tank capacities saved');
      await onSaved?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Save failed');
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="do-tank-config-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Droplets className="h-5 w-5 text-sky-600" />
            Aeration Tank Capacities
          </DialogTitle>
          <DialogDescription className="text-xs text-gray-500">
            {deviceLabel} · <code className="bg-gray-100 px-1 rounded">{hardwareId}</code>
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-2">
          <div>
            <Label className="text-xs">Tank 1 capacity (KLD)</Label>
            <Input type="number" step="1" min="0" value={t1}
                   onChange={(e) => setT1(e.target.value)}
                   placeholder="e.g. 250"
                   data-testid="do-tank-1-kld" />
          </div>
          <div>
            <Label className="text-xs">Tank 2 capacity (KLD)</Label>
            <Input type="number" step="1" min="0" value={t2}
                   onChange={(e) => setT2(e.target.value)}
                   placeholder="e.g. 180"
                   data-testid="do-tank-2-kld" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving} data-testid="do-tank-config-save">
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            Save capacities
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DOTankConfigDialog;
