import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import {
  Loader2, RefreshCw, Radio, Power, Zap, ChevronDown, ChevronRight, Wifi, WifiOff,
} from 'lucide-react';
import api, { formatApiError } from '../lib/api';
import { toast } from 'sonner';
import { cleanLabel } from '../utils/labels';

// Human-readable label for every instrument type the registry can emit.
const TYPE_LABELS = {
  flowmeter: 'Flowmeter',
  dwlr: 'DWLR (Piezometer)',
  ph: 'pH',
  tds: 'TDS',
  conductivity: 'Conductivity',
  wq_stp: 'STP water quality',
  do_meter: 'DO analyzer',
  chlorine_analyzer: 'Chlorine analyzer',
  ocems: 'OCEMS',
};

const prettyType = (t) =>
  TYPE_LABELS[t] || (t ? t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '—');

const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { hour12: false }) : '—');

const EVENT_META = {
  offline_started: { label: 'Went offline', color: 'bg-red-500', icon: WifiOff },
  back_online:     { label: 'Back online',  color: 'bg-emerald-500', icon: Wifi },
  power_cycle:     { label: 'Power cycle',  color: 'bg-amber-500', icon: Power },
};

const stateBadge = (state) => {
  if (state === 'online')  return <Badge className="bg-emerald-500">Online</Badge>;
  if (state === 'offline') return <Badge className="bg-red-500">Offline</Badge>;
  return <Badge className="bg-gray-400">No data</Badge>;
};

// ============================================================================
// Per-instrument event timeline
// ============================================================================
const InstrumentTimeline = ({ events }) => {
  if (!events || events.length === 0) {
    return <p className="text-xs italic text-gray-500 py-2">No offline or power-cycle events in this window.</p>;
  }
  const ordered = [...events].sort((a, b) => new Date(b.at) - new Date(a.at));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b bg-gray-50">
            <th className="text-left p-2">Event</th>
            <th className="text-left p-2">Date &amp; time (device punch)</th>
            <th className="text-left p-2">Details</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((ev, idx) => {
            const meta = EVENT_META[ev.type] || { label: ev.type, color: 'bg-gray-400', icon: Radio };
            const Icon = meta.icon;
            const details = ev.reason
              || (ev.gap_minutes != null ? `Gap ${ev.gap_minutes} min` : '');
            return (
              <tr key={idx} className="border-b hover:bg-gray-50" data-testid={`ir-event-${ev.type}-${idx}`}>
                <td className="p-2">
                  <Badge className={`${meta.color} text-white`}>
                    <Icon className="h-3 w-3 mr-1" /> {meta.label}
                  </Badge>
                </td>
                <td className="p-2 whitespace-nowrap font-mono">{fmtDateTime(ev.at)}</td>
                <td className="p-2 text-gray-600">{details}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const UserGroupCard = ({ user, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  const totals = user.instruments.reduce(
    (acc, inst) => {
      acc.total += 1;
      acc[inst.state] = (acc[inst.state] || 0) + 1;
      acc.offline_events += inst.counts?.offline_started || 0;
      acc.power_cycles += inst.counts?.power_cycle || 0;
      return acc;
    },
    { total: 0, online: 0, offline: 0, no_data: 0, offline_events: 0, power_cycles: 0 },
  );

  return (
    <Card data-testid={`ir-user-${user.user_id}`} className="overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between p-4 hover:bg-gray-50 text-left"
        onClick={() => setOpen((v) => !v)}
        data-testid={`ir-user-toggle-${user.user_id}`}
      >
        <div className="flex items-center gap-3 min-w-0">
          {open ? <ChevronDown className="h-4 w-4 text-gray-500 shrink-0" /> : <ChevronRight className="h-4 w-4 text-gray-500 shrink-0" />}
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 truncate">{user.full_name || user.email || 'Unassigned'}</p>
            <p className="text-xs text-gray-500 truncate">
              {user.email || 'no email'}
              {user.role ? ` · ${user.role}` : ''}
              {user.location_name ? ` · ${user.location_name}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <Badge variant="outline">{totals.total} devices</Badge>
          {totals.online   > 0 && <Badge className="bg-emerald-500">{totals.online} online</Badge>}
          {totals.offline  > 0 && <Badge className="bg-red-500">{totals.offline} offline</Badge>}
          {totals.no_data  > 0 && <Badge className="bg-gray-400">{totals.no_data} no data</Badge>}
          {totals.offline_events > 0 && <Badge className="bg-amber-500"><Radio className="h-3 w-3 mr-1" />{totals.offline_events} drops</Badge>}
          {totals.power_cycles > 0 && <Badge className="bg-indigo-500"><Power className="h-3 w-3 mr-1" />{totals.power_cycles} power cycles</Badge>}
        </div>
      </button>
      {open && (
        <CardContent className="border-t bg-gray-50/50 pt-4">
          {user.instruments.length === 0 ? (
            <p className="text-xs italic text-gray-500">No instruments assigned.</p>
          ) : (
            <div className="space-y-4">
              {user.instruments.map((inst) => (
                <div key={inst.hardware_id} className="bg-white rounded-lg border p-3 space-y-2" data-testid={`ir-inst-${inst.hardware_id}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{cleanLabel(inst.label)}</span>
                        <Badge variant="outline">{prettyType(inst.instrument_type)}</Badge>
                        {stateBadge(inst.state)}
                      </div>
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        <span className="font-mono">{inst.hardware_id}</span>
                        {inst.location_name ? ` · ${inst.location_name}` : ''}
                        {inst.imei ? ` · IMEI ${inst.imei}` : ''}
                      </p>
                    </div>
                    <div className="text-right text-[11px] text-gray-600">
                      <p>First seen: <span className="font-mono">{fmtDateTime(inst.first_seen)}</span></p>
                      <p>Last seen:&nbsp; <span className="font-mono">{fmtDateTime(inst.last_seen)}</span></p>
                      <p>Readings: {inst.reading_count}</p>
                    </div>
                  </div>
                  <InstrumentTimeline events={inst.events} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
};

// ============================================================================
// Instrument Report — the entire page
// ============================================================================
const AuditLog = () => {
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: d } = await api.get(`/api/instrument-report/events?days=${days}`);
      setData(d);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Failed to load instrument report');
    } finally { setLoading(false); }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const totals = data?.totals || {};

  return (
    <div className="p-6 space-y-6" data-testid="instrument-report-page">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Instrument Report</h1>
        <p className="text-gray-600 mt-1">Connectivity, offline &amp; power-cycle timeline for your installed instruments.</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wide text-gray-500">Users</p>
            <p className="text-2xl font-bold text-gray-900">{totals.users ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wide text-gray-500">Instruments</p>
            <p className="text-2xl font-bold text-gray-900">{totals.instruments ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wide text-gray-500 flex items-center gap-1"><Wifi className="h-3 w-3" /> Online</p>
            <p className="text-2xl font-bold text-emerald-600">{totals.online ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wide text-gray-500 flex items-center gap-1"><WifiOff className="h-3 w-3" /> Offline</p>
            <p className="text-2xl font-bold text-red-600">{totals.offline ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wide text-gray-500 flex items-center gap-1"><Radio className="h-3 w-3" /> Offline events</p>
            <p className="text-2xl font-bold text-amber-600">{totals.offline_events ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wide text-gray-500 flex items-center gap-1"><Power className="h-3 w-3" /> Power cycles</p>
            <p className="text-2xl font-bold text-indigo-600">{totals.power_cycles ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Zap className="h-4 w-4" /> Report window</CardTitle>
          <CardDescription>
            Offline &gt; {data?.offline_threshold_hours ?? 2} h · Power-cycle heuristic ≥ {data?.power_cycle_hours ?? 4} h gap or an explicit BOOT/RB/PWR counter change on the device.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label>Lookback</Label>
              <select
                className="border rounded px-3 py-2 text-sm"
                value={days}
                onChange={(e) => setDays(parseInt(e.target.value, 10))}
                data-testid="ir-days-select"
              >
                {[1, 3, 7, 14, 30, 60, 90].map((n) => (
                  <option key={n} value={n}>{n} day{n === 1 ? '' : 's'}</option>
                ))}
              </select>
            </div>
            <Button onClick={load} variant="outline" data-testid="ir-refresh-btn">
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh
            </Button>
            {data?.generated_at && (
              <span className="text-[11px] text-gray-500 ml-auto">Generated {fmtDateTime(data.generated_at)}</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* User groups */}
      {loading ? (
        <div className="text-center py-12">
          <Loader2 className="h-6 w-6 mx-auto animate-spin text-gray-400" />
          <p className="text-sm text-gray-500 mt-2">Building timeline…</p>
        </div>
      ) : (data?.users || []).length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center space-y-2">
            <Radio className="h-10 w-10 mx-auto text-gray-400" />
            <p className="text-gray-600">No instruments registered yet.</p>
            <p className="text-xs text-gray-500">Provision devices on the Instruments page to start tracking connectivity.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {data.users.map((u, idx) => (
            <UserGroupCard key={u.user_id} user={u} defaultOpen={idx === 0} />
          ))}
        </div>
      )}
    </div>
  );
};

export default AuditLog;
