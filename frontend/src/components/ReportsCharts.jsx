import React, { useEffect, useState, useCallback } from 'react';
import {
  Line, Bar, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Activity, Download, Droplets, CloudRain, GaugeCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import api, { formatApiError, apiUrl } from '../lib/api';
import { getToken, getCurrentUser } from '../mockData';
import LimitsCard from './LimitsCard';
import { cleanLabel } from '../utils/labels';

const AXIS_TICK = { fontSize: 11 };
const fmtBucket = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1} ${d.getHours().toString().padStart(2, '0')}:00`;
};

// ---------- Rainfall vs DWLR Water Level ----------
const LevelVsRainfallChart = ({ dwlrId, days, onData }) => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [meta, setMeta] = useState({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ days: String(days) });
      if (dwlrId) params.append('hardware_id', dwlrId);
      const { data: d } = await api.get(`/api/reports/level-vs-rainfall?${params.toString()}`);
      const series = d.series || [];
      setData(series);
      setMeta({ dwlr_id: d.dwlr_id });
      onData?.(series);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Failed to load rainfall chart');
      onData?.([]);
    } finally {
      setLoading(false);
    }
  }, [dwlrId, days, onData]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <Card className="overflow-hidden border-0 bg-white shadow-sm ring-1 ring-slate-200" data-testid="level-vs-rainfall-card">
      <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-white to-sky-50/70 px-5 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base font-bold text-slate-900">
              <span className="rounded-xl bg-sky-100 p-2 text-sky-600"><CloudRain className="h-5 w-5" /></span>
              Rainfall vs DWLR Water Level
            </CardTitle>
            <CardDescription className="mt-2 max-w-3xl text-xs leading-5 text-slate-500">
              Daily rainfall (mm) overlaid with average DWLR water level (m). Rainfall from
              <a className="ml-1 font-medium text-blue-600 underline" href="https://open-meteo.com" target="_blank" rel="noreferrer">Open-Meteo</a>
              <span className="mx-1">·</span>last {days} days
              <Badge className="ml-2 rounded-full border-sky-200 bg-white text-slate-600" variant="outline">{meta.dwlr_id || 'DWLR not selected'}</Badge>
            </CardDescription>
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
            <span className="rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-white">Line &amp; Bar</span>
            <span className="px-3 py-1.5 text-[11px] font-medium text-slate-500">Bar Only</span>
            <span className="px-3 py-1.5 text-[11px] font-medium text-slate-500">Line Only</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-5">
        {loading && <div className="flex h-80 items-center justify-center text-sm text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin text-blue-600" />Loading chart data…</div>}
        {!loading && data.length === 0 && <div className="flex h-80 items-center justify-center text-sm italic text-slate-500">No data for the selected range yet.</div>}
        {data.length > 0 && (
          <div className="h-[360px] w-full" data-testid="level-vs-rainfall-chart">
            <ResponsiveContainer>
              <ComposedChart data={data} margin={{ top: 10, right: 18, left: 2, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="rain" orientation="left" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} label={{ value: 'Rainfall (mm)', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 11 }} />
                <YAxis yAxisId="level" orientation="right" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} label={{ value: 'Water Level (m)', angle: 90, position: 'insideRight', fill: '#64748b', fontSize: 11 }} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 10px 30px rgba(15,23,42,.10)', fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                <Bar yAxisId="rain" dataKey="rainfall_mm" fill="#3b82f6" radius={[5,5,0,0]} name="Rainfall (mm)" />
                <Line yAxisId="level" type="monotone" dataKey="level_m" stroke="#10b981" strokeWidth={3} dot={{ r: 3, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 5 }} name="Water Level (m)" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const FlowVsLevelChart = ({ flowmeterId, days, dwlrId, onData }) => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [meta, setMeta] = useState({ dwlr_id: dwlrId });

  const fetchData = useCallback(async () => {
    if (!flowmeterId) { setData([]); onData?.([]); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ hardware_id: flowmeterId, days: String(days) });
      if (dwlrId) params.append('dwlr_id', dwlrId);
      const { data: d } = await api.get(`/api/reports/flow-vs-level?${params.toString()}`);
      const series = (d.series || []).map((s) => ({ ...s, bucket: fmtBucket(s.bucket) }));
      setData(series);
      setMeta({ dwlr_id: d.dwlr_id });
      onData?.(series);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Failed to load flow chart');
      onData?.([]);
    } finally {
      setLoading(false);
    }
  }, [flowmeterId, days, dwlrId, onData]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <Card className="overflow-hidden border-0 bg-white shadow-sm ring-1 ring-slate-200" data-testid="flow-vs-level-card">
      <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-white to-emerald-50/60 px-5 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base font-bold text-slate-900">
              <span className="rounded-xl bg-emerald-100 p-2 text-emerald-600"><GaugeCircle className="h-5 w-5" /></span>
              Flow vs Water Level
            </CardTitle>
            <CardDescription className="mt-2 max-w-3xl text-xs leading-5 text-slate-500">
              Borewell flow rate (m³/h) overlaid with DWLR water level (m) to understand abstraction and groundwater response.
              <span className="mx-1">·</span>last {days} days
              <Badge className="ml-2 rounded-full border-emerald-200 bg-white text-slate-600" variant="outline">{meta.dwlr_id || 'DWLR not selected'}</Badge>
            </CardDescription>
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
            <span className="rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-white">Line &amp; Bar</span>
            <span className="px-3 py-1.5 text-[11px] font-medium text-slate-500">Bar Only</span>
            <span className="px-3 py-1.5 text-[11px] font-medium text-slate-500">Line Only</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-5">
        {loading && <div className="flex h-80 items-center justify-center text-sm text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin text-blue-600" />Loading chart data…</div>}
        {!loading && data.length === 0 && <div className="flex h-80 items-center justify-center text-sm italic text-slate-500">Select a borewell and DWLR to display the relationship.</div>}
        {data.length > 0 && (
          <div className="h-[360px] w-full" data-testid="flow-vs-level-chart">
            <ResponsiveContainer>
              <ComposedChart data={data} margin={{ top: 10, right: 18, left: 2, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="flow" orientation="left" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} label={{ value: 'Flow (m³/h)', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 11 }} />
                <YAxis yAxisId="level" orientation="right" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} label={{ value: 'Water Level (m)', angle: 90, position: 'insideRight', fill: '#64748b', fontSize: 11 }} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 10px 30px rgba(15,23,42,.10)', fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                <Line yAxisId="flow" type="monotone" dataKey="flow_m3h" stroke="#2563eb" strokeWidth={3} dot={false} name="Flow (m³/h)" />
                <Line yAxisId="level" type="monotone" dataKey="level_m" stroke="#10b981" strokeWidth={3} dot={{ r: 2, fill: '#fff' }} name="Water Level (m)" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

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
        end: end.toISOString().slice(0, 10),
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
      const params = new URLSearchParams({ start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), format: 'csv' });
      const url = apiUrl(`/api/reports/borewell-consumption?${params.toString()}`);
      const res = await fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `borewell-consumption_${days}d.csv`; document.body.appendChild(a); a.click(); a.remove();
      toast.success('CSV downloaded.');
    } catch (e) { toast.error(e?.message || 'Download failed'); }
  };

  return (
    <Card className="overflow-hidden border-0 bg-white shadow-sm ring-1 ring-slate-200" data-testid="all-borewells-card">
      <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-white to-violet-50/50 px-5 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base font-bold text-slate-900"><span className="rounded-xl bg-violet-100 p-2 text-violet-600"><Droplets className="h-5 w-5" /></span>All Borewells · Combined Consumption</CardTitle>
            <CardDescription className="mt-1 text-xs">Groundwater abstraction by borewell for the selected period.</CardDescription>
          </div>
          <Button onClick={downloadCsv} size="sm" className="rounded-xl bg-emerald-600 hover:bg-emerald-700" data-testid="download-borewells-csv-btn"><Download className="mr-2 h-4 w-4" />Export CSV</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3" data-testid="all-borewells-summary">
          <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-white p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-blue-600">Grand total</p><p className="mt-1 text-2xl font-bold text-slate-900">{Number(data.grand_total_kl || 0).toFixed(2)} <span className="text-sm font-semibold text-slate-500">KL</span></p></div>
          <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Borewells</p><p className="mt-1 text-2xl font-bold text-slate-900">{data.count ?? (data.borewells || []).length}</p></div>
          <div className="col-span-2 rounded-2xl border border-slate-100 bg-slate-50 p-4 md:col-span-1"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Reporting range</p><p className="mt-1 text-sm font-semibold text-slate-700">{range.start?.slice(0, 10) || '—'} <span className="mx-1 text-slate-400">→</span> {range.end?.slice(0, 10) || '—'}</p></div>
        </div>
        <div className="overflow-hidden rounded-2xl border border-slate-200">
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500"><th className="px-4 py-3 text-left">Borewell</th><th className="px-4 py-3 text-left">Label</th><th className="px-4 py-3 text-right">Consumption (KL)</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={3} className="p-6 text-center text-slate-500">Loading…</td></tr> : (data.borewells || []).length === 0 ? <tr><td colSpan={3} className="p-6 text-center italic text-slate-500">No borewells configured.</td></tr> :
                <>{(data.borewells || []).map((b) => <tr key={b.hardware_id} className="border-t border-slate-100 transition hover:bg-blue-50/40"><td className="px-4 py-3 font-mono text-[11px] text-slate-500">{b.hardware_id}</td><td className="px-4 py-3 font-medium text-slate-700">{cleanLabel(b.label)}</td><td className="px-4 py-3 text-right font-bold tabular-nums text-emerald-600">{Number(b.consumption_kl).toFixed(2)}</td></tr>)}<tr className="border-t border-slate-200 bg-blue-50/60 font-bold"><td className="px-4 py-3" colSpan={2}>GRAND TOTAL</td><td className="px-4 py-3 text-right text-blue-700">{Number(data.grand_total_kl || 0).toFixed(2)} KL</td></tr></>}
            </tbody>
          </table></div>
        </div>
      </CardContent>
    </Card>
  );
};

const ReportsCharts = () => {
  const [flowmeterIds, setFlowmeterIds] = useState([]);
  const [dwlrIds, setDwlrIds] = useState([]);
  const [selectedFm, setSelectedFm] = useState('');
  const [selectedDwlr, setSelectedDwlr] = useState('');
  const [days, setDays] = useState(7);
  const [rainfallData, setRainfallData] = useState([]);
  const [flowData, setFlowData] = useState([]);

  const [enabled, setEnabled] = useState({ rainfallVsLevel: true, flowVsLevel: true, allBorewells: true });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [fm, dw] = await Promise.all([api.get('/api/flowmeter/latest'), api.get('/api/instruments/dwlr/latest')]);
        if (cancelled) return;
        const fms = (fm.data?.flowmeters || []).map((r) => r.hardware_id).filter(Boolean);
        const dws = (dw.data?.readings || []).map((r) => r.hardware_id).filter(Boolean);
        setFlowmeterIds(fms); setDwlrIds(dws);
        if (fms.length) setSelectedFm(fms[0]);
        if (dws.length) setSelectedDwlr(dws[0]);
      } catch (e) { if (process.env.NODE_ENV === 'development') console.warn('[reports-bootstrap]', e?.message); }
    })();
    return () => { cancelled = true; };
  }, []);

  const toggle = (k) => setEnabled((s) => ({ ...s, [k]: !s[k] }));
  const canManageLimits = !!(getCurrentUser()?.role === 'admin' || getCurrentUser()?.permissions?.limits);

  const rainfall = rainfallData;
  const flow = flowData;
  const rainfallTotal = rainfall.reduce((s, x) => s + (Number(x.rainfall_mm) || 0), 0);
  const levels = rainfall.map((x) => Number(x.level_m)).filter(Number.isFinite);
  const avgLevel = levels.length ? levels.reduce((a,b) => a+b,0)/levels.length : null;
  const maxRain = rainfall.length ? Math.max(...rainfall.map(x => Number(x.rainfall_mm)||0)) : null;
  const minRain = rainfall.length ? Math.min(...rainfall.map(x => Number(x.rainfall_mm)||0)) : null;
  const highestLevel = levels.length ? Math.max(...levels) : null;
  const lowestLevel = levels.length ? Math.min(...levels) : null;

  return (
    <div className="space-y-4 bg-gradient-to-b from-slate-50 via-white to-sky-50/30" data-testid="reports-charts-section">
      <div className="overflow-hidden rounded-3xl border border-sky-100 bg-gradient-to-r from-white via-sky-50 to-emerald-50/70 shadow-sm">
        <div className="relative flex min-h-[112px] items-center justify-between gap-6 px-6 py-5">
          <div>
            <div className="flex items-center gap-3"><div className="rounded-2xl bg-blue-100 p-3 text-blue-600"><Activity className="h-7 w-7" /></div><div><h2 className="text-2xl font-bold tracking-tight text-slate-900">Graph &amp; Combined Reports</h2><p className="mt-1 text-sm text-slate-500">Compare rainfall, groundwater level and borewell flow to understand trends and relationships.</p></div></div>
          </div>
          <div className="hidden items-center gap-2 lg:flex"><div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3 text-right shadow-sm"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Selected range</p><p className="text-sm font-bold text-slate-800">Last {days} days</p></div><div className="rounded-2xl border border-emerald-100 bg-white/80 px-4 py-3 text-right shadow-sm"><p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Data status</p><p className="text-sm font-bold text-slate-800">Live</p></div></div>
        </div>
      </div>

      <Card className="overflow-hidden border-0 bg-white shadow-sm ring-1 ring-slate-200">
        <CardContent className="p-5">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div><div className="flex items-center gap-2 text-sm font-bold text-slate-900"><span className="rounded-xl bg-sky-100 p-2 text-sky-600"><Activity className="h-4 w-4"/></span>Analysis controls</div><p className="mt-1 text-xs text-slate-500">Select the borewell, DWLR and reporting window.</p></div><div className="flex flex-wrap gap-2">{[['rainfallVsLevel','Rainfall + Level'],['flowVsLevel','Flow + Level'],['allBorewells','All Borewells']].map(([k,label])=><button key={k} type="button" onClick={()=>toggle(k)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${enabled[k]?'border-blue-200 bg-blue-50 text-blue-700':'border-slate-200 bg-white text-slate-400'}`}><span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${enabled[k]?'bg-blue-600':'bg-slate-300'}`}/>{label}</button>)}</div></div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div><Label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Borewell (Flowmeter)</Label><select data-testid="reports-fm-select" className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 shadow-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100" value={selectedFm} onChange={(e)=>setSelectedFm(e.target.value)}><option value="">— select —</option>{flowmeterIds.map(id=><option key={id} value={id}>{id}</option>)}</select></div>
            <div><Label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">DWLR (Water Level)</Label><select data-testid="reports-dwlr-select" className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 shadow-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100" value={selectedDwlr} onChange={(e)=>setSelectedDwlr(e.target.value)}><option value="">— auto —</option>{dwlrIds.map(id=><option key={id} value={id}>{id}</option>)}</select></div>
            <div><Label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Range (Days)</Label><Input type="number" min={1} max={90} value={days} onChange={(e)=>setDays(Math.max(1,Math.min(90,Number(e.target.value)||1)))} data-testid="reports-days-input" className="mt-1 h-11 rounded-xl border-slate-200 shadow-sm" /></div>
            <div className="flex items-end"><div className="flex h-11 w-full items-center justify-center rounded-xl bg-slate-50 px-3 text-xs font-medium text-slate-500 ring-1 ring-slate-200"><Activity className="mr-2 h-4 w-4 text-blue-600"/>Live analysis updates automatically</div></div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[
          ['Total Rainfall', rainfall.length ? `${rainfallTotal.toFixed(1)} mm` : '—', 'Selected period', 'bg-sky-50 text-sky-600'],
          ['Average Water Level', avgLevel != null ? `${avgLevel.toFixed(2)} m` : '—', 'DWLR readings', 'bg-emerald-50 text-emerald-600'],
          ['Maximum Rainfall', maxRain != null ? `${maxRain.toFixed(1)} mm` : '—', 'Highest daily value', 'bg-violet-50 text-violet-600'],
          ['Minimum Rainfall', minRain != null ? `${minRain.toFixed(1)} mm` : '—', 'Lowest daily value', 'bg-orange-50 text-orange-600'],
          ['Highest Water Level', highestLevel != null ? `${highestLevel.toFixed(2)} m` : '—', 'Selected period', 'bg-cyan-50 text-cyan-600'],
          ['Lowest Water Level', lowestLevel != null ? `${lowestLevel.toFixed(2)} m` : '—', 'Selected period', 'bg-amber-50 text-amber-600'],
        ].map(([label,value,sub,cls])=><div key={label} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"><div className="flex items-center gap-3"><div className={`rounded-2xl p-2.5 ${cls}`}><Activity className="h-5 w-5"/></div><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 text-xl font-bold tabular-nums text-slate-900">{value}</p><p className="mt-0.5 text-[10px] text-slate-400">{sub}</p></div></div></div>)}
      </div>

      {enabled.rainfallVsLevel && <LevelVsRainfallChart dwlrId={selectedDwlr} days={days * 2} onData={setRainfallData} />}
      {enabled.flowVsLevel && <FlowVsLevelChart flowmeterId={selectedFm} dwlrId={selectedDwlr} days={days} onData={setFlowData} />}
      {enabled.allBorewells && <AllBorewellsReport days={days} />}
      <LimitsCard canManage={canManageLimits} />
    </div>
  );
};

export default ReportsCharts;
