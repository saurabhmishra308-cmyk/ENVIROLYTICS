import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import api, { formatApiError } from '../../lib/api';
import { cleanLabel } from '../../utils/labels';

export const DoTankLinker = ({ siblings, onChanged }) => {
  const [busy, setBusy] = useState(null); // 'tank-1' | 'tank-2' | null
  const [localAssignments, setLocalAssignments] = useState({});

  // Current device assigned to each tank (registry values take precedence
  // over any optimistic local overrides only when the linker first mounts).
  const byTank = useMemo(() => {
    const m = { 1: null, 2: null };
    for (const s of siblings) {
      if (s.aeration_tank_number === 1) m[1] = s.hardware_id;
      if (s.aeration_tank_number === 2) m[2] = s.hardware_id;
    }
    return { ...m, ...localAssignments };
  }, [siblings, localAssignments]);

  const assign = async (tankNumber, hardwareId) => {
    if (!hardwareId) return;
    const otherTank = tankNumber === 1 ? 2 : 1;
    setBusy(`tank-${tankNumber}`);
    try {
      // 1. If the picked device is currently on the OTHER tank, free that
      //    slot first so we don't end up with the same physical device
      //    powering both tanks.
      if (byTank[otherTank] === hardwareId) {
        await api.put(`/api/instrument-registry/${encodeURIComponent(hardwareId)}`, {
          aeration_tank_number: null,
        });
      }
      // 2. If a DIFFERENT device currently owns this tank, clear that
      //    device's aeration_tank_number so we don't have two devices
      //    both marked as tank N.
      const prevOnThisTank = byTank[tankNumber];
      if (prevOnThisTank && prevOnThisTank !== hardwareId) {
        await api.put(`/api/instrument-registry/${encodeURIComponent(prevOnThisTank)}`, {
          aeration_tank_number: null,
        });
      }
      // 3. Finally, assign the picked device to this tank.
      await api.put(`/api/instrument-registry/${encodeURIComponent(hardwareId)}`, {
        aeration_tank_number: tankNumber,
      });
      setLocalAssignments((prev) => ({
        ...prev,
        [tankNumber]: hardwareId,
        ...(byTank[otherTank] === hardwareId ? { [otherTank]: null } : {}),
      }));
      toast.success(`Linked ${hardwareId} → Tank ${tankNumber}`);
      onChanged?.();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Failed to update tank mapping');
    } finally {
      setBusy(null);
    }
  };

  const renderSelect = (tankNumber) => {
    const current = byTank[tankNumber] || '';
    return (
      <select
        data-testid={`do-tank-${tankNumber}-select`}
        className="text-xs border rounded px-2 py-1 bg-white disabled:opacity-60"
        value={current}
        disabled={busy === `tank-${tankNumber}`}
        onChange={(e) => assign(tankNumber, e.target.value)}
      >
        <option value="">— Select device —</option>
        {siblings.map((s) => (
          <option key={s.hardware_id} value={s.hardware_id}>
            {cleanLabel(s.label || s.hardware_id)} ({s.hardware_id})
          </option>
        ))}
      </select>
    );
  };

  return (
    <div
      className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2"
      data-testid="do-tank-linker"
    >
      <p className="text-xs font-semibold text-sky-900 mb-1">
        Admin · Link DO device to Aeration Tank
      </p>
      <p className="text-[11px] text-sky-800 mb-2">
        Pick which registered DO analyzer drives Tank&nbsp;1 vs Tank&nbsp;2. The
        chosen device&apos;s live DO reading is what powers that tank&apos;s bubbles &amp;
        gauge.
      </p>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="text-xs font-medium text-gray-700 flex items-center gap-2">
          <span className="whitespace-nowrap">Tank 1 →</span>
          {renderSelect(1)}
          {busy === 'tank-1' && <Loader2 className="h-3 w-3 animate-spin text-sky-600" />}
        </label>
        <label className="text-xs font-medium text-gray-700 flex items-center gap-2">
          <span className="whitespace-nowrap">Tank 2 →</span>
          {renderSelect(2)}
          {busy === 'tank-2' && <Loader2 className="h-3 w-3 animate-spin text-sky-600" />}
        </label>
      </div>
    </div>
  );
};


// ------------------------- MAIN PAGE -------------------------
