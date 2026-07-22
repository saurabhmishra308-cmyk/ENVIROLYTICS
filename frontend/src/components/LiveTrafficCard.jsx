import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { ChevronDown, ChevronUp, Radio, Globe, Download, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import api, { formatApiError } from '../lib/api';

const REFRESH_MS = 5000;

const fmtTime = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return String(iso);
  }
};

const csvEscape = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const downloadCsv = (filename, headers, rows) => {
  const lines = [headers.join(',')];
  rows.forEach((r) => lines.push(headers.map((h) => csvEscape(r[h])).join(',')));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const StatBox = ({ label, value, color = 'text-gray-900', isDarkMode }) => (
  <div className={`rounded-md px-3 py-2 ${isDarkMode ? 'bg-gray-900/40' : 'bg-gray-50'}`}>
    <p className={`text-[10px] uppercase tracking-widest ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>{label}</p>
    <p className={`text-lg font-bold tabular-nums ${color}`}>{value}</p>
  </div>
);

const INSTRUMENT_TYPES = [
  { value: 'flowmeter', label: 'Flowmeter' },
  { value: 'dwlr', label: 'DWLR (Water Level)' },
  { value: 'ph', label: 'pH Sensor' },
  { value: 'tds', label: 'TDS Sensor' },
  { value: 'conductivity', label: 'Conductivity Sensor' },
  { value: 'dometer', label: 'DO Meter (Dissolved Oxygen)' },
  { value: 'water_quality', label: 'Water Quality (pH/BOD/COD/TSS/Cl)' },
];

/**
 * One-click "Register this" dialog invoked from an amber unknown-IMEI row
 * in the MQTT traffic table. Prefills hardware_id with the topic's IMEI and
 * lets the admin pick instrument type + owner (defaults to admin) before
 * POSTing to /api/instrument-registry.
 */
const RegisterUnknownDialog = ({ open, onOpenChange, prefilledId, defaultType, onRegistered }) => {
  const [users, setUsers] = useState([]);
  const [hardwareId, setHardwareId] = useState(prefilledId || '');
  const [type, setType] = useState(defaultType || 'flowmeter');
  const [ownerId, setOwnerId] = useState('');
  const [label, setLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setHardwareId(prefilledId || '');
    setType(defaultType || 'flowmeter');
    setLabel(prefilledId ? `${prefilledId}` : '');
  }, [prefilledId, defaultType]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const r = await api.get('/api/admin/users/list');
        const list = r.data.users || [];
        setUsers(list);
        const admin = list.find((u) => u.role === 'admin');
        setOwnerId((prev) => prev || admin?.id || (list[0]?.id ?? ''));
      } catch { /* silent */ }
    })();
  }, [open]);

  const submit = async () => {
    if (!hardwareId.trim() || !ownerId) {
      toast.error('Hardware ID and Owner are required');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/api/instrument-registry', {
        hardware_id: hardwareId.trim(),
        instrument_type: type,
        owner_user_id: ownerId,
        label: label.trim() || hardwareId.trim(),
        device_source: 'mqtt',
      });
      toast.success(`Registered ${hardwareId} as ${type}`);
      onRegistered?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Failed to register');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Register unknown IMEI</DialogTitle>
          <DialogDescription>
            Register the device broadcasting on this topic so future messages route into a dashboard tile.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-xs">Hardware ID / IMEI</Label>
            <Input value={hardwareId} onChange={(e) => setHardwareId(e.target.value)} data-testid="reg-unknown-hw" />
          </div>
          <div>
            <Label className="text-xs">Instrument type</Label>
            <select
              className="w-full border rounded-md h-10 px-3 text-sm"
              value={type}
              onChange={(e) => setType(e.target.value)}
              data-testid="reg-unknown-type"
            >
              {INSTRUMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs">Assign to</Label>
            <select
              className="w-full border rounded-md h-10 px-3 text-sm"
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              data-testid="reg-unknown-owner"
            >
              {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.email} ({u.role})</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs">Label (optional)</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Borewell #3" data-testid="reg-unknown-label" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={submit} disabled={submitting} data-testid="reg-unknown-submit">
            {submitting ? 'Registering…' : 'Register device'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const MQTTPanel = ({ isDarkMode }) => {
  const [status, setStatus] = useState({ connected: false, subscribed_topics: [], broker: '—', total_received: 0, dropped_unknown: 0, recent_messages: [] });
  const [hidden, setHidden] = useState(false);
  const [regOpen, setRegOpen] = useState(false);
  const [regId, setRegId] = useState('');

  const fetchStatus = useCallback(async () => {
    try {
      const r = await api.get('/api/flowmeter/status');
      setStatus(r.data || {});
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchStatus();
    const t = setInterval(fetchStatus, REFRESH_MS);
    return () => clearInterval(t);
  }, [fetchStatus]);

  const text = isDarkMode ? 'text-white' : 'text-gray-900';
  const muted = isDarkMode ? 'text-gray-400' : 'text-gray-600';
  const rows = status.recent_messages || [];

  const openRegister = (imeiOrTopic) => {
    setRegId(imeiOrTopic || '');
    setRegOpen(true);
  };

  const exportCsv = () => {
    if (rows.length === 0) { toast.error('No traffic to export'); return; }
    downloadCsv(
      `mqtt-traffic-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`,
      ['time', 'topic', 'imei', 'device', 'result', 'bytes'],
      rows,
    );
  };

  return (
    <Card className={isDarkMode ? 'bg-gray-800 border-gray-700' : ''} data-testid="live-mqtt-traffic-card">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10">
              <Radio className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <CardTitle className={`flex items-center gap-2 ${text}`}>
                Live MQTT Traffic
                <Badge className={status.connected ? 'bg-green-500' : 'bg-red-500'} data-testid="mqtt-conn-badge">
                  {status.connected ? 'Connected' : 'Offline'}
                </Badge>
              </CardTitle>
              <CardDescription className={muted}>
                Shows the last 50 messages received by the backend from the MQTT broker. Auto-refreshes every 5 seconds.
                Unregistered IMEIs appear in amber — click <em>Register this</em> to add them.
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={exportCsv} data-testid="mqtt-export-csv">
              <Download className="h-3.5 w-3.5 mr-1" /> Export CSV
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setHidden((v) => !v)} data-testid="mqtt-toggle-hide">
              {hidden ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
              <span className="ml-1 text-xs">{hidden ? 'Show' : 'Hide'}</span>
            </Button>
          </div>
        </div>
      </CardHeader>
      {!hidden && (
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatBox label="Broker" value={<span className="text-sm break-all">{status.broker || '—'}</span>} isDarkMode={isDarkMode} color={text} />
            <StatBox label="Total received" value={status.total_received || 0} isDarkMode={isDarkMode} color="text-green-500" />
            <StatBox label="Dropped (unknown IMEI)" value={status.dropped_unknown || 0} isDarkMode={isDarkMode} color="text-amber-500" />
            <StatBox label="Subscribed topics" value={`+/${(status.subscribed_topics || []).length}`} isDarkMode={isDarkMode} color={text} />
          </div>
          <div className={`rounded-md border overflow-hidden ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
            <table className="w-full text-xs">
              <thead className={isDarkMode ? 'bg-gray-900/50' : 'bg-gray-50'}>
                <tr className={`text-left ${muted}`}>
                  <th className="p-2">Time</th>
                  <th className="p-2">Topic</th>
                  <th className="p-2">IMEI</th>
                  <th className="p-2">Device</th>
                  <th className="p-2">Result</th>
                  <th className="p-2 text-right">Bytes</th>
                  <th className="p-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody data-testid="mqtt-traffic-rows">
                {rows.length === 0 ? (
                  <tr><td colSpan={7} className={`text-center italic p-4 ${muted}`}>No traffic yet. Waiting for MQTT messages…</td></tr>
                ) : rows.map((m, i) => {
                  const isDropped = m.result?.startsWith('dropped') || m.result?.startsWith('invalid');
                  return (
                    <tr key={i} className={isDropped ? (isDarkMode ? 'bg-amber-900/20' : 'bg-amber-50') : ''}>
                      <td className={`p-2 tabular-nums ${text}`}>{fmtTime(m.time)}</td>
                      <td className={`p-2 font-mono ${text}`}>{m.topic}</td>
                      <td className={`p-2 font-mono ${text}`}>{m.imei || '—'}</td>
                      <td className={`p-2 ${text}`}>{m.device || '—'}</td>
                      <td className={`p-2 ${isDropped ? 'text-amber-500' : 'text-green-500'}`}>{m.result}</td>
                      <td className={`p-2 text-right tabular-nums ${muted}`}>{m.bytes}</td>
                      <td className="p-2 text-right">
                        {isDropped ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 border-amber-500 text-amber-700"
                            onClick={() => openRegister(m.imei || (m.topic || '').split('/')[0])}
                            data-testid={`register-this-${i}`}
                          >
                            <UserPlus className="h-3 w-3 mr-1" /> Register this
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      )}
      <RegisterUnknownDialog
        open={regOpen}
        onOpenChange={setRegOpen}
        prefilledId={regId}
        defaultType="flowmeter"
        onRegistered={fetchStatus}
      />
    </Card>
  );
};

const HTTPPanel = ({ isDarkMode }) => {
  const [snapshot, setSnapshot] = useState({ endpoint: '—', interval_sec: 300, auth_enabled: false, total_polled: 0, failed: 0, recent_polls: [], registered_devices: 0 });
  const [hidden, setHidden] = useState(false);
  const [running, setRunning] = useState(false);

  const fetchSnapshot = useCallback(async () => {
    try {
      const r = await api.get('/api/devices/qespl/traffic');
      setSnapshot(r.data || {});
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchSnapshot();
    const t = setInterval(fetchSnapshot, REFRESH_MS);
    return () => clearInterval(t);
  }, [fetchSnapshot]);

  const runNow = async () => {
    setRunning(true);
    try {
      const r = await api.post('/api/devices/qespl/run-now');
      const { polled = 0, ok = 0, failed = 0 } = r.data || {};
      toast.success(`Polled ${polled} device${polled === 1 ? '' : 's'} · ${ok} ok · ${failed} failed`);
      await fetchSnapshot();
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Poll failed');
    } finally {
      setRunning(false);
    }
  };

  const exportCsv = () => {
    const rows = snapshot.recent_polls || [];
    if (rows.length === 0) { toast.error('No polls to export'); return; }
    downloadCsv(
      `espl-http-traffic-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`,
      ['time', 'qespl_device_id', 'hardware_id', 'device', 'result', 'http_code', 'bytes', 'note'],
      rows,
    );
  };

  const text = isDarkMode ? 'text-white' : 'text-gray-900';
  const muted = isDarkMode ? 'text-gray-400' : 'text-gray-600';
  const rows = snapshot.recent_polls || [];
  const isConnected = (snapshot.total_polled || 0) > 0 && (snapshot.failed || 0) < (snapshot.total_polled || 1);
  const endpointHost = (() => {
    try { return new URL(snapshot.endpoint || '').host; } catch { return snapshot.endpoint || '—'; }
  })();

  return (
    <Card className={isDarkMode ? 'bg-gray-800 border-gray-700' : ''} data-testid="live-http-traffic-card">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10">
              <Globe className="h-5 w-5 text-emerald-500" />
            </div>
            <div>
              <CardTitle className={`flex items-center gap-2 ${text}`}>
                Live HTTP Traffic — ESPL
                <Badge className={isConnected ? 'bg-green-500' : 'bg-gray-400'} data-testid="http-conn-badge">
                  {snapshot.total_polled > 0 ? 'Polling' : 'Idle'}
                </Badge>
              </CardTitle>
              <CardDescription className={muted}>
                Shows the last 50 REST polls to <code>{endpointHost}</code>. Poller runs every {Math.round((snapshot.interval_sec || 300) / 60)} min per device.
                Failed polls appear in amber.
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={exportCsv} data-testid="http-export-csv">
              <Download className="h-3.5 w-3.5 mr-1" /> Export CSV
            </Button>
            <Button size="sm" variant="outline" onClick={runNow} disabled={running} data-testid="http-run-now">
              {running ? 'Polling…' : 'Poll now'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setHidden((v) => !v)} data-testid="http-toggle-hide">
              {hidden ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
              <span className="ml-1 text-xs">{hidden ? 'Show' : 'Hide'}</span>
            </Button>
          </div>
        </div>
      </CardHeader>
      {!hidden && (
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatBox label="Endpoint" value={<span className="text-sm break-all">{endpointHost}</span>} isDarkMode={isDarkMode} color={text} />
            <StatBox label="Total polled" value={snapshot.total_polled || 0} isDarkMode={isDarkMode} color="text-green-500" />
            <StatBox label="Failed" value={snapshot.failed || 0} isDarkMode={isDarkMode} color="text-amber-500" />
            <StatBox label="Registered devices" value={snapshot.registered_devices || 0} isDarkMode={isDarkMode} color={text} />
          </div>
          <div className={`rounded-md border overflow-hidden ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
            <table className="w-full text-xs">
              <thead className={isDarkMode ? 'bg-gray-900/50' : 'bg-gray-50'}>
                <tr className={`text-left ${muted}`}>
                  <th className="p-2">Time</th>
                  <th className="p-2">ESPL Device</th>
                  <th className="p-2">Hardware ID</th>
                  <th className="p-2">Device</th>
                  <th className="p-2">Result</th>
                  <th className="p-2 text-right">HTTP</th>
                  <th className="p-2 text-right">Bytes</th>
                </tr>
              </thead>
              <tbody data-testid="http-traffic-rows">
                {rows.length === 0 ? (
                  <tr><td colSpan={7} className={`text-center italic p-4 ${muted}`}>No polls yet. Add an ESPL device and click <strong>Poll now</strong>.</td></tr>
                ) : rows.map((p, i) => {
                  const ok = p.result === 'ok';
                  return (
                    <tr key={i} className={ok ? '' : (isDarkMode ? 'bg-amber-900/20' : 'bg-amber-50')}>
                      <td className={`p-2 tabular-nums ${text}`}>{fmtTime(p.time)}</td>
                      <td className={`p-2 font-mono ${text}`}>{p.qespl_device_id || '—'}</td>
                      <td className={`p-2 font-mono ${text}`}>{p.hardware_id || '—'}</td>
                      <td className={`p-2 ${text}`}>{p.device || '—'}</td>
                      <td className={`p-2 ${ok ? 'text-green-500' : 'text-amber-500'}`}>{p.result}</td>
                      <td className={`p-2 text-right tabular-nums ${muted}`}>{p.http_code ?? '—'}</td>
                      <td className={`p-2 text-right tabular-nums ${muted}`}>{p.bytes ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      )}
    </Card>
  );
};

/**
 * Live traffic panels (MQTT + HTTP/ESPL) — visible to admins only.
 * Stacks vertically; both panels can be collapsed independently.
 */
const LiveTrafficCard = ({ isDarkMode }) => (
  <div className="space-y-4" data-testid="live-traffic-panels">
    <MQTTPanel isDarkMode={isDarkMode} />
    <HTTPPanel isDarkMode={isDarkMode} />
  </div>
);

export default LiveTrafficCard;
