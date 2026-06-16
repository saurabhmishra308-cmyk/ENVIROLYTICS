import React, { useEffect, useState, useCallback } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { CloudRain, Activity } from 'lucide-react';
import api from '../lib/api';

const AXIS_TICK = { fontSize: 11 };
const LIVE_POLL_MS = 10_000; // refresh the live chart every 10 s

const fmtBucket = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
};

// ===================================================================
// Live Flow + Water Level change trend
// ===================================================================
const LiveFlowLevelChart = () => {
  const [flowmeters, setFlowmeters]   = useState([]);
  const [dwlrIds, setDwlrIds]         = useState([]);
  const [flowmeterId, setFlowmeterId] = useState('');
  const [dwlrId, setDwlrId]           = useState('');
  const [hours, setHours]             = useState(6);
  const [series, setSeries]           = useState([]);
  const [meta, setMeta]               = useState({});
  const [lastTick, setLastTick]       = useState(null);

  // Bootstrap device pickers once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [fm, dw] = await Promise.all([
          api.get('/api/flowmeter/latest'),
          api.get('/api/instruments/dwlr/latest'),
        ]);
        if (cancelled) return;
        const fms = (fm.data?.flowmeters || []).map((r) => r.hardware_id).filter(Boolean);
        const dws = (dw.data?.readings   || []).map((r) => r.hardware_id).filter(Boolean);
        setFlowmeters(fms);
        setDwlrIds(dws);
        if (fms.length) setFlowmeterId(fms[0]);
        if (dws.length) setDwlrId(dws[0]);
      } catch (e) {
        if (process.env.NODE_ENV === 'development') console.warn('[live-flow] bootstrap', e?.message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const fetchData = useCallback(async () => {
    if (!flowmeterId) return;
    try {
      const params = new URLSearchParams({
        hardware_id: flowmeterId,
        // The endpoint takes days — we want hours, so pass a fractional day-equivalent.
        days: String(Math.max(1, Math.ceil(hours / 24))),
      });
      if (dwlrId) params.append('dwlr_id', dwlrId);
      const { data } = await api.get(`/api/reports/flow-vs-level?${params.toString()}`);
      // Only keep the last `hours` buckets so the chart stays focused.
      const cutoff = Date.now() - hours * 3600 * 1000;
      const cleaned = (data?.series || [])
        .filter((s) => {
          const t = new Date(s.bucket).getTime();
          return Number.isFinite(t) && t >= cutoff;
        })
        .map((s) => ({ ...s, label: fmtBucket(s.bucket) }));
      setSeries(cleaned);
      setMeta({ dwlr: data?.dwlr_id });
      setLastTick(new Date());
    } catch (e) {
      if (process.env.NODE_ENV === 'development') console.warn('[live-flow] fetch', e?.message);
    }
  }, [flowmeterId, dwlrId, hours]);

  // Initial + poll
  useEffect(() => {
    let cancelled = false;
    const tick = () => { if (!cancelled) fetchData(); };
    const t = setTimeout(tick, 0);
    const i = setInterval(tick, LIVE_POLL_MS);
    return () => { cancelled = true; clearTimeout(t); clearInterval(i); };
  }, [fetchData]);

  return (
    <Card data-testid="live-flow-level-card">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-cyan-600" /> Live Flow &amp; Water Level Trend
            </CardTitle>
            <CardDescription>
              Borewell flow rate (m³/hr) overlaid with DWLR water level (m).
              Auto-refreshes every 10 s · last {hours} h ·
              DWLR <Badge variant="outline">{meta.dwlr || 'n/a'}</Badge>
            </CardDescription>
          </div>
          <div className="text-right shrink-0">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              LIVE
            </span>
            {lastTick && (
              <p className="text-[10px] text-gray-500 mt-1" data-testid="live-flow-last-tick">
                updated {lastTick.toLocaleTimeString()}
              </p>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 max-w-3xl">
          <div>
            <Label className="text-xs">Borewell (flowmeter)</Label>
            <select
              data-testid="live-flow-fm-select"
              className="w-full border rounded-md px-2 py-2 text-sm bg-white"
              value={flowmeterId}
              onChange={(e) => setFlowmeterId(e.target.value)}
            >
              {flowmeters.map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs">DWLR (water level)</Label>
            <select
              data-testid="live-flow-dwlr-select"
              className="w-full border rounded-md px-2 py-2 text-sm bg-white"
              value={dwlrId}
              onChange={(e) => setDwlrId(e.target.value)}
            >
              <option value="">— auto —</option>
              {dwlrIds.map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs">Window (hours)</Label>
            <Input
              type="number" min={1} max={72}
              value={hours}
              onChange={(e) => setHours(Math.max(1, Math.min(72, Number(e.target.value) || 6)))}
              data-testid="live-flow-hours-input"
            />
          </div>
        </div>

        {series.length === 0 ? (
          <p className="text-sm text-gray-500 italic">Waiting for live readings…</p>
        ) : (
          <div style={{ width: '100%', height: 340 }} data-testid="live-flow-chart">
            <ResponsiveContainer>
              <ComposedChart data={series}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={AXIS_TICK} />
                <YAxis yAxisId="flow"  orientation="left"  tick={AXIS_TICK} label={{ value: 'Flow (m³/hr)', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
                <YAxis yAxisId="level" orientation="right" tick={AXIS_TICK} label={{ value: 'Level (m)',    angle:  90, position: 'insideRight', style: { fontSize: 11 } }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line yAxisId="flow"  type="monotone" dataKey="flow_m3h" stroke="#4a9fd8" strokeWidth={2} dot={false} name="Flow (m³/hr)" />
                <Line yAxisId="level" type="monotone" dataKey="level_m"  stroke="#27ae60" strokeWidth={2} dot={false} name="Water Level (m)" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const GraphReport = () => {
  const [dwlrIds, setDwlrIds] = useState([]);
  const [dwlrId, setDwlrId]   = useState('');
  const [days, setDays]       = useState(30);
  const [series, setSeries]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta]       = useState({});

  // Discover DWLR devices
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/api/instruments/dwlr/latest');
        if (cancelled) return;
        const ids = (data?.readings || []).map((r) => r.hardware_id).filter(Boolean);
        setDwlrIds(ids);
        if (ids.length) setDwlrId(ids[0]);
      } catch (e) {
        if (process.env.NODE_ENV === 'development') console.warn('[graph-report] bootstrap', e?.message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ days: String(days) });
      if (dwlrId) params.append('hardware_id', dwlrId);
      const { data } = await api.get(`/api/reports/level-vs-rainfall?${params.toString()}`);
      setSeries(data?.series || []);
      setMeta({ dwlr: data?.dwlr_id, lat: data?.latitude, lon: data?.longitude });
    } catch (e) {
      if (process.env.NODE_ENV === 'development') console.warn('[graph-report] fetch', e?.message);
      setSeries([]);
    } finally {
      setLoading(false);
    }
  }, [dwlrId, days]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Graph Reports</h1>
        <p className="text-gray-600 mt-1">
          Live flow + water-level trend and the daily rainfall vs water-level trend.
        </p>
      </div>

      <LiveFlowLevelChart />

      {/* Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CloudRain className="h-5 w-5 text-indigo-600" /> Rainfall &amp; Water Level Trend
          </CardTitle>
          <CardDescription>
            Daily rainfall (mm, from <a className="underline" href="https://open-meteo.com" target="_blank" rel="noreferrer">Open-Meteo</a>)
            and the matching average DWLR water level (m). Pick a DWLR + the number of days.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 max-w-3xl">
            <div>
              <Label className="text-xs">DWLR (water level)</Label>
              <select
                data-testid="graphreport-dwlr-select"
                className="w-full border rounded-md px-2 py-2 text-sm bg-white"
                value={dwlrId}
                onChange={(e) => setDwlrId(e.target.value)}
              >
                <option value="">— auto —</option>
                {dwlrIds.map((id) => <option key={id} value={id}>{id}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">Range (days)</Label>
              <Input
                type="number" min={1} max={180}
                value={days}
                onChange={(e) => setDays(Math.max(1, Math.min(180, Number(e.target.value) || 30)))}
                data-testid="graphreport-days-input"
              />
            </div>
            <div className="flex items-end text-xs text-gray-600">
              <div>
                <p>DWLR: <Badge variant="outline">{meta.dwlr || 'n/a'}</Badge></p>
                {meta.lat != null && (
                  <p className="mt-1 text-gray-500">
                    Site: {Number(meta.lat).toFixed(3)}, {Number(meta.lon).toFixed(3)}
                  </p>
                )}
              </div>
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : series.length === 0 ? (
            <p className="text-sm text-gray-500 italic">No data for the selected range yet.</p>
          ) : (
            <div style={{ width: '100%', height: 380 }} data-testid="graphreport-chart">
              <ResponsiveContainer>
                <ComposedChart data={series}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={AXIS_TICK} angle={-30} textAnchor="end" height={60} />
                  <YAxis yAxisId="rain"  orientation="left"  tick={AXIS_TICK} label={{ value: 'Rainfall (mm)', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
                  <YAxis yAxisId="level" orientation="right" tick={AXIS_TICK} label={{ value: 'Level (m)',     angle:  90, position: 'insideRight', style: { fontSize: 11 } }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar  yAxisId="rain"  dataKey="rainfall_mm" fill="#6366f1" name="Rainfall (mm)" />
                  <Line yAxisId="level" type="monotone" dataKey="level_m" stroke="#27ae60" strokeWidth={2.5} dot={false} name="Water Level (m)" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default GraphReport;
