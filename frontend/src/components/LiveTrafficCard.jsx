import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { ChevronDown, ChevronUp, Radio, Globe } from 'lucide-react';
import api from '../lib/api';

const REFRESH_MS = 5000;

const fmtTime = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return String(iso);
  }
};

const StatBox = ({ label, value, color = 'text-gray-900', isDarkMode }) => (
  <div className={`rounded-md px-3 py-2 ${isDarkMode ? 'bg-gray-900/40' : 'bg-gray-50'}`}>
    <p className={`text-[10px] uppercase tracking-widest ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>{label}</p>
    <p className={`text-lg font-bold tabular-nums ${color}`}>{value}</p>
  </div>
);

const MQTTPanel = ({ isDarkMode }) => {
  const [status, setStatus] = useState({ connected: false, subscribed_topics: [], broker: '—', total_received: 0, dropped_unknown: 0, recent_messages: [] });
  const [hidden, setHidden] = useState(false);

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
          <Button size="sm" variant="ghost" onClick={() => setHidden((v) => !v)} data-testid="mqtt-toggle-hide">
            {hidden ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            <span className="ml-1 text-xs">{hidden ? 'Show' : 'Hide'}</span>
          </Button>
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
                </tr>
              </thead>
              <tbody data-testid="mqtt-traffic-rows">
                {rows.length === 0 ? (
                  <tr><td colSpan={6} className={`text-center italic p-4 ${muted}`}>No traffic yet. Waiting for MQTT messages…</td></tr>
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
      await api.post('/api/devices/qespl/run-now');
      await fetchSnapshot();
    } finally {
      setRunning(false);
    }
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
                Live HTTP Traffic — QESPL
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
                  <th className="p-2">QESPL Device</th>
                  <th className="p-2">Hardware ID</th>
                  <th className="p-2">Device</th>
                  <th className="p-2">Result</th>
                  <th className="p-2 text-right">HTTP</th>
                  <th className="p-2 text-right">Bytes</th>
                </tr>
              </thead>
              <tbody data-testid="http-traffic-rows">
                {rows.length === 0 ? (
                  <tr><td colSpan={7} className={`text-center italic p-4 ${muted}`}>No polls yet. Add a QESPL device and click <strong>Poll now</strong>.</td></tr>
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
 * Live traffic panels (MQTT + HTTP) — visible to admins only.
 * Stacks vertically; both panels can be collapsed independently.
 */
const LiveTrafficCard = ({ isDarkMode }) => (
  <div className="space-y-4" data-testid="live-traffic-panels">
    <MQTTPanel isDarkMode={isDarkMode} />
    <HTTPPanel isDarkMode={isDarkMode} />
  </div>
);

export default LiveTrafficCard;
