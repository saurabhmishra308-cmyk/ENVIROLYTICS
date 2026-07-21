import React, { useState } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Lock, MailPlus } from 'lucide-react';
import { toast } from 'sonner';
import api, { formatApiError } from '../lib/api';

/**
 * Overlay shown on a dashboard section when the client has no instruments of
 * that type registered. Presents a lock icon, an explanation, and a
 * "Request access" button that POSTs to /api/access-requests → emails admin.
 *
 * Props:
 *   - instrumentType: canonical type key (e.g. "dwlr", "water_quality", "flowmeter")
 *   - readableType:   human label (e.g. "DWLR (Water Level)")
 *   - isDarkMode:     optional
 */
const LockedSectionOverlay = ({ instrumentType, readableType, isDarkMode }) => {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState('');
  const [hwHint, setHwHint] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      await api.post('/api/access-requests', {
        instrument_type: instrumentType,
        message: msg?.trim() || null,
        hardware_id_hint: hwHint?.trim() || null,
      });
      toast.success('Request sent to admin — you will be notified when access is granted.');
      setOpen(false);
      setMsg('');
      setHwHint('');
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Failed to send request');
    } finally {
      setSubmitting(false);
    }
  };

  const surface = isDarkMode ? 'bg-gray-900/60' : 'bg-gray-100/70';
  const border = isDarkMode ? 'border-gray-700' : 'border-gray-300';
  const title = isDarkMode ? 'text-gray-100' : 'text-gray-800';
  const sub = isDarkMode ? 'text-gray-400' : 'text-gray-500';

  return (
    <>
      <div
        className={`rounded-lg border-2 border-dashed ${border} ${surface} p-6 text-center`}
        data-testid={`locked-section-${instrumentType}`}
        aria-label={`${readableType} not installed`}
      >
        <div className="flex justify-center mb-2">
          <div className="p-3 rounded-full bg-gray-200/70 dark:bg-gray-800/70">
            <Lock className={`h-6 w-6 ${sub}`} />
          </div>
        </div>
        <p className={`font-semibold ${title}`}>Not installed at your location</p>
        <p
          className={`text-xs mt-1 ${sub}`}
          title="Contact admin to add this instrument"
        >
          {readableType} tile is inactive because no such instrument is registered under your account.
        </p>
        <Button
          size="sm"
          className="mt-4 bg-blue-500 hover:bg-blue-600"
          onClick={() => setOpen(true)}
          data-testid={`request-access-${instrumentType}`}
        >
          <MailPlus className="h-3.5 w-3.5 mr-1" /> Request access
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Request access · {readableType}</DialogTitle>
            <DialogDescription>
              We&apos;ll email the admin (<strong>saurabh@envirolytics.in</strong>) to register a{' '}
              <strong>{readableType}</strong> under your account. Once added, this tile activates
              automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">Preferred hardware ID (optional)</Label>
              <Input
                value={hwHint}
                onChange={(e) => setHwHint(e.target.value)}
                placeholder="e.g. DWLR_PLANT_A_01"
                data-testid={`access-hw-hint-${instrumentType}`}
              />
            </div>
            <div>
              <Label className="text-xs">Message to admin (optional)</Label>
              <Input
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                placeholder="Anything the admin should know?"
                data-testid={`access-msg-${instrumentType}`}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
            <Button onClick={submit} disabled={submitting} data-testid={`access-submit-${instrumentType}`}>
              {submitting ? 'Sending…' : 'Send request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default LockedSectionOverlay;
