import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Activity, Download, Droplets, CloudRain, GaugeCircle } from 'lucide-react';
import { toast } from 'sonner';
import api, { formatApiError } from '../lib/api';
import { getToken, getCurrentUser } from '../mockData';
import LimitsCard from './LimitsCard';

const AXIS_TICK = { fontSize: 11 };
const fmtBucket = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1} ${d.getHours().toString().padStart(2, '0')}:00`;
};

// =========================================================================
// 1. Flow vs Water Level
// =========================================================================
const FlowVsLevelChart = ({ flowmeterId, days, dwlrId }) => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [meta, setMeta] = useState({ dwlr_id: dwlrId });

  const fetchData = useCallback(async () => {
    if (!flowmeterId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ hardware_id: flowmeterId, days: String(days) });
      if (dwlrId) params.append('dwlr_id', dwlrId);
      const { data: d } = await api.get(`/api/reports/flow-vs-level?${params.toString()}`);
      const series = (d.series || []).map((s) => ({ ...s, bucket: fmtBucket(s.bucket) }));
      setData(series);
      setMeta({ dwlr_id: d.dwlr_id });
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Failed to load chart');
    } finally {
      setLoading(false);
    }
  }, [flowmeterId, days, dwlrId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <Card data-testid="flow-vs-level-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GaugeCircle className="h-5 w-5 text-cyan-600" /> Flow vs Water Level
        </CardTitle>
        <CardDescription>
          Borewell flow rate (m³/hr) overlaid with DWLR water level (m) ·
          last {days} days · DWLR <Badge variant="outline">{meta.dwlr_id || 'n/a'}</Badge>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading && <p className="text-sm text-gray-500">Loading…</p>}
        {!loading && data.length === 0 && <p className="text-sm text-gray-500 italic">No data for the selected range yet.</p>}
        {data.length > 0 && (
          <div style={{ width: '100%', height: 320 }} data-testid="flow-vs-level-chart">
            <ResponsiveContainer>
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="bucket" tick={AXIS_TICK} />
                <YAxis yAxisId="flow" orientation="left" tick={AXIS_TICK} label={{ value: 'Flow (m³/hr)', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
                <YAxis yAxisId="level" orientation="right" tick={AXIS_TICK} label={{ value: 'Level (m)', angle: 90, position: 'insideRight', style: { fontSize: 11 } }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line yAxisId="flow"  type="monotone" dataKey="flow_m3h"  stroke="#4a9fd8" strokeWidth={2} dot={false} name="Flow (m³/hr)" />
                <Line yAxisId="level" type="monotone" dataKey="level_m"   stroke="#27ae60" strokeWidth={2} dot={false} name="Water Level (m)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// =========================================================================
// 2. Water Level vs Rainfall
// =========================================================================
const LevelVsRainfallChart = ({ dwlrId, days }) => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [meta, setMeta] = useState({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ days: String(days) });
      if (dwlrId) params.append('hardware_id', dwlrId);
      const { data: d } = await api.get(`/api/reports/level-vs-rainfall?${params.toString()}`);
      setData(d.series || []);
      setMeta({ dwlr_id: d.dwlr_id, lat: d.latitude, lon: d.longitude });
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Failed to load rainfall chart');
    } finally {
      setLoading(false);
    }
  }, [dwlrId, days]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <Card data-testid="level-vs-rainfall-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CloudRain className="h-5 w-5 text-indigo-600" /> Water Level vs Rainfall (Recharge)
        </CardTitle>
        <CardDescription>
          Daily DWLR water level (m) + rainfall (mm) for your location.
          Rainfall from <a className="underline" href="https://open-meteo.com" target="_blank" rel="noreferrer">Open-Meteo</a> ·
          last {days} days · DWLR <Badge variant="outline">{meta.dwlr_id || 'n/a'}</Badge>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading && <p className="text-sm text-gray-500">Loading…</p>}
        {!loading && data.length === 0 && <p className="text-sm text-gray-500 italic">No data for the selected range yet.</p>}
        {data.length > 0 && (
          <div style={{ width: '100%', height: 320 }} data-testid="level-vs-rainfall-chart">
            <ResponsiveContainer>
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={AXIS_TICK} />
                <YAxis yAxisId="rain"  orientation="left"  tick={AXIS_TICK} label={{ value: 'Rainfall (mm)', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
                <YAxis yAxisId="level" orientation="right" tick={AXIS_TICK} label={{ value: 'Level (m)',     angle:  90, position: 'insideRight', style: { fontSize: 11 } }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="rain" dataKey="rainfall_mm" fill="#6366f1" name="Rainfall (mm)" />
                <Line yAxisId="level" type="monotone" dataKey="level_m" stroke="#27ae60" strokeWidth={2} name="Water Level (m)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// =========================================================================
// 3. All-borewells combined consumption + grand total
// =========================================================================
const AllBorewellsReport = ({ days }) => {
  const [data, setData] = useState({ borewells: [], grand_total_kl: 0 });
  const [loading, setLoading] = useState(false);
  const [range, setRange] = useState({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const end = new Date();
      const start = new Date(); start.setDate(start.getDate() - days);
      const params = new URLSearchParams({
        start: start.toISOString().slice(0, 10),
        end:   end.toISOString().slice(0, 10),
      });
      const { data: d } = await api.get(`/api/reports/borewell-consumption?${params.toString()}`);
      setData(d);
      setRange({ start: d.start, end: d.end });
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Failed to load consumption');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const downloadCsv = async () => {
    try {
      const end = new Date();
      const start = new Date(); start.setDate(start.getDate() - days);
      const params = new URLSearchParams({
        start:  start.toISOString().slice(0, 10),
        end:    end.toISOString().slice(0, 10),
        format: 'csv',
      });
      const url = `${process.env.REACT_APP_BACKEND_URL}/api/reports/borewell-consumption?${params.toString()}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `borewell-consumption_${days}d.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      toast.success('CSV downloaded.');
    } catch (e) {
      toast.error(e?.message || 'Download failed');
    }
  };

  const chartData = useMemo(
    () => (data.borewells || []).map((b) => ({ name: b.label || b.hardware_id, kl: b.consumption_kl })),
    [data.borewells],
  );

  return (
    <Card data-testid="all-borewells-card">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Droplets className="h-5 w-5 text-blue-600" /> All Borewells · Combined Consumption
          </CardTitle>
          <CardDescription>
            Total groundwater abstraction (KL) per borewell + grand total · last {days} days.
          </CardDescription>
        </div>
        <Button onClick={downloadCsv} size="sm" data-testid="download-borewells-csv-btn" variant="outline">
          <Download className="h-4 w-4 mr-1" /> CSV
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="all-borewells-summary">
          <div className="rounded-lg border bg-blue-50 dark:bg-blue-950/30 p-3">
            <p className="text-[11px] uppercase tracking-wider text-blue-700 dark:text-blue-300">Grand total</p>
            <p className="text-2xl font-bold text-blue-700 dark:text-blue-100" data-testid="grand-total-kl">
              {Number(data.grand_total_kl || 0).toFixed(2)} <span className="text-sm font-normal">KL</span>
            </p>
          </div>
          <div className="rounded-lg border bg-gray-50 dark:bg-gray-800 p-3">
            <p className="text-[11px] uppercase tracking-wider text-gray-600 dark:text-gray-400">Borewells</p>
            <p className="text-2xl font-bold">{data.count ?? (data.borewells || []).length}</p>
          </div>
          <div className="rounded-lg border bg-gray-50 dark:bg-gray-800 p-3 col-span-2">
            <p className="text-[11px] uppercase tracking-wider text-gray-600 dark:text-gray-400">Range</p>
            <p className="text-sm font-medium">{range.start?.slice(0, 10)} → {range.end?.slice(0, 10)}</p>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : chartData.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No borewells configured.</p>
        ) : (
          <div style={{ width: '100%', height: 280 }} data-testid="all-borewells-chart">
            <ResponsiveContainer>
              <BarChart data={chartData} layout="vertical" margin={{ left: 80 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tick={AXIS_TICK} label={{ value: 'KL', position: 'insideBottom', style: { fontSize: 11 } }} />
                <YAxis dataKey="name" type="category" tick={AXIS_TICK} width={100} />
                <Tooltip />
                <Bar dataKey="kl" fill="#4a9fd8" name="Consumption (KL)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="overflow-x-auto" data-testid="all-borewells-table">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 dark:bg-gray-800">
              <tr>
                <th className="px-3 py-2 text-left">Hardware ID</th>
                <th className="px-3 py-2 text-left">Label</th>
                <th className="px-3 py-2 text-right">Consumption (KL)</th>
              </tr>
            </thead>
            <tbody>
              {(data.borewells || []).map((b) => (
                <tr key={b.hardware_id} className="border-b">
                  <td className="px-3 py-2 font-mono text-xs">{b.hardware_id}</td>
                  <td className="px-3 py-2">{b.label}</td>
                  <td className="px-3 py-2 text-right font-medium">{Number(b.consumption_kl).toFixed(2)}</td>
                </tr>
              ))}
              <tr className="bg-blue-50 dark:bg-blue-950/30 font-semibold">
                <td className="px-3 py-2" colSpan={2}>GRAND TOTAL</td>
                <td className="px-3 py-2 text-right">{Number(data.grand_total_kl || 0).toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
};

// =========================================================================
// Main "Correlated Reports" panel — what gets rendered inside the Reports page
// =========================================================================
const ReportsCharts = () => {
  const [flowmeterIds, setFlowmeterIds] = useState([]);
  const [dwlrIds, setDwlrIds] = useState([]);
  const [selectedFm, setSelectedFm] = useState('');
  const [selectedDwlr, setSelectedDwlr] = useState('');
  const [days, setDays] = useState(7);

  // Which sections are enabled (the data-selection feature the user asked for)
  const [enabled, setEnabled] = useState({
    flowVsLevel: true,
    levelVsRainfall: true,
    allBorewells: true,
  });

  // Bootstrap device pickers
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
        const dws = (dw.data?.readings || []).map((r) => r.hardware_id).filter(Boolean);
        setFlowmeterIds(fms);
        setDwlrIds(dws);
        if (fms.length) setSelectedFm(fms[0]);
        if (dws.length) setSelectedDwlr(dws[0]);
      } catch (e) {
        if (process.env.NODE_ENV === 'development') console.warn('[reports-bootstrap]', e?.message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const toggle = (k) => setEnabled((s) => ({ ...s, [k]: !s[k] }));

  return (
    <div className="space-y-4" data-testid="reports-charts-section">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-cyan-600" /> Graph & Combined Reports
          </CardTitle>
          <CardDescription>
            Choose what data you want to see — toggle the checkboxes and adjust the range / device.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">Borewell (flowmeter)</Label>
              <select
                data-testid="reports-fm-select"
                className="w-full border rounded-md px-2 py-2 text-sm bg-white dark:bg-gray-800"
                value={selectedFm}
                onChange={(e) => setSelectedFm(e.target.value)}
              >
                <option value="">— select —</option>
                {flowmeterIds.map((id) => <option key={id} value={id}>{id}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">DWLR (water level)</Label>
              <select
                data-testid="reports-dwlr-select"
                className="w-full border rounded-md px-2 py-2 text-sm bg-white dark:bg-gray-800"
                value={selectedDwlr}
                onChange={(e) => setSelectedDwlr(e.target.value)}
              >
                <option value="">— auto —</option>
                {dwlrIds.map((id) => <option key={id} value={id}>{id}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">Range (days)</Label>
              <Input
                type="number" min={1} max={90}
                value={days}
                onChange={(e) => setDays(Math.max(1, Math.min(90, Number(e.target.value) || 1)))}
                data-testid="reports-days-input"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Show</Label>
              <div className="flex flex-wrap gap-2 text-xs">
                {[
                  { k: 'flowVsLevel',     label: 'Flow + Level'        },
                  { k: 'levelVsRainfall', label: 'Level + Rainfall'    },
                  { k: 'allBorewells',    label: 'All Borewells'       },
                ].map(({ k, label }) => (
                  <label key={k} className="inline-flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enabled[k]}
                      onChange={() => toggle(k)}
                      data-testid={`reports-toggle-${k}`}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {enabled.flowVsLevel     && <FlowVsLevelChart     flowmeterId={selectedFm}   days={days} dwlrId={selectedDwlr} />}
      {enabled.levelVsRainfall && <LevelVsRainfallChart dwlrId={selectedDwlr}      days={days * 2} />}
      {enabled.allBorewells    && <AllBorewellsReport   days={days} />}
      <LimitsCard canManage={!!(getCurrentUser()?.role === 'admin' || getCurrentUser()?.permissions?.limits)} />
    </div>
  );
};

export default ReportsCharts;
