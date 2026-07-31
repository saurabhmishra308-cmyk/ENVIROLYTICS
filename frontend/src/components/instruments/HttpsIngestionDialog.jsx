import React from 'react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../ui/dialog';
import { KeyRound, Copy, RefreshCw } from 'lucide-react';
import { cleanLabel } from '../../utils/labels';

// Device key + HTTPS ingestion instructions (extracted from Instruments.jsx).
export const HttpsIngestionDialog = ({ keyTarget, onClose, backendUrl, copyToClipboard, rotateKey }) => {
  return (
    <Dialog open={!!keyTarget} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-blue-700">
            <KeyRound className="h-5 w-5" /> HTTPS Ingestion — {cleanLabel(keyTarget?.label || keyTarget?.hardware_id)}
          </DialogTitle>
          <DialogDescription>
            If your device can&apos;t reach the MQTT broker (firewall / NAT issues), publish
            telemetry straight to your backend via this HTTPS endpoint instead.
            The same processing pipeline runs — readings, alerts, limits, exports
            all behave identically.
          </DialogDescription>
        </DialogHeader>
        {keyTarget && (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-blue-700 uppercase tracking-wider">Hardware ID</span>
                <Button size="sm" variant="outline" className="h-7" onClick={() => copyToClipboard(keyTarget.hardware_id, 'Hardware ID copied')}>
                  <Copy className="h-3 w-3 mr-1" /> Copy
                </Button>
              </div>
              <code className="block bg-white p-2 rounded text-sm font-mono break-all">{keyTarget.hardware_id}</code>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-amber-700 uppercase tracking-wider">Device Key (secret — flash to instrument only)</span>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" className="h-7" onClick={() => copyToClipboard(keyTarget.device_key, 'Device key copied')}>
                    <Copy className="h-3 w-3 mr-1" /> Copy
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-red-600" onClick={() => rotateKey(keyTarget.hardware_id)} title="Rotate (invalidate the old key)">
                    <RefreshCw className="h-3 w-3 mr-1" /> Rotate
                  </Button>
                </div>
              </div>
              <code className="block bg-white p-2 rounded text-sm font-mono break-all">{keyTarget.device_key || '(none yet — click Rotate to generate)'}</code>
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-700 mb-1">Endpoint URL</p>
              <code className="block bg-gray-100 p-2 rounded text-xs font-mono break-all">POST {backendUrl}/api/devices/ingest</code>
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-700 mb-1">Example curl (flowmeter payload)</p>
              <pre className="bg-gray-900 text-green-300 text-xs p-3 rounded overflow-x-auto whitespace-pre-wrap">
    {`curl -X POST '${backendUrl}/api/devices/ingest' \\
      -H 'X-Hardware-Id: ${keyTarget.hardware_id}' \\
      -H 'X-Device-Key: ${keyTarget.device_key || '<key>'}' \\
      -H 'Content-Type: application/json' \\
      -d '${keyTarget.instrument_type === 'flowmeter'
        ? '{"IMEI":"869895067123456","SIGNAL":24,"FLOW":1500.5,"TOT1":1234,"TOT2":56,"RTOT1":0,"RTOT2":0,"UNT":2,"POW":1,"TEMPER":28.5,"TIME":"2026-07-15T10:30:00Z","VER":"FW_v1"}'
        : keyTarget.instrument_type === 'dwlr'
    ? '{"LEVEL":12.45,"TEMPER":24.8,"TIME":"2026-07-15T10:30:00Z"}'
    : keyTarget.instrument_type === 'ph'
      ? '{"PH":7.42,"TEMPER":25.1,"TIME":"2026-07-15T10:30:00Z"}'
      : keyTarget.instrument_type === 'tds'
        ? '{"TDS":510,"TEMPER":25.1,"TIME":"2026-07-15T10:30:00Z"}'
        : '{"COND":980,"TEMPER":25.1,"TIME":"2026-07-15T10:30:00Z"}'}'`}
              </pre>
              <Button size="sm" variant="outline" className="mt-2 h-7" onClick={() => copyToClipboard(
                `curl -X POST '${backendUrl}/api/devices/ingest' -H 'X-Hardware-Id: ${keyTarget.hardware_id}' -H 'X-Device-Key: ${keyTarget.device_key || '<key>'}' -H 'Content-Type: application/json' -d '${keyTarget.instrument_type === 'flowmeter' ? '{"IMEI":"869895067123456","SIGNAL":24,"FLOW":1500.5,"TOT1":1234,"TOT2":56,"RTOT1":0,"RTOT2":0,"UNT":2,"POW":1,"TEMPER":28.5,"TIME":"2026-07-15T10:30:00Z","VER":"FW_v1"}' : '{"LEVEL":12.45,"TEMPER":24.8,"TIME":"2026-07-15T10:30:00Z"}'}'`,
                'curl command copied'
              )}>
                <Copy className="h-3 w-3 mr-1" /> Copy curl
              </Button>
            </div>

            <div className="text-xs text-gray-500 border-t pt-2">
              <strong className="text-gray-700">Tip:</strong> Hit{' '}
              <code className="font-mono bg-gray-100 px-1 rounded">GET /api/devices/ingest/ping</code>{' '}
              with the same headers to confirm credentials without publishing data.
              If the device key ever leaks, click <strong>Rotate</strong> above to invalidate it.
            </div>
          </div>
        )}
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
