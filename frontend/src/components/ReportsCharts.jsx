import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  LineChart, Line, BarChart, Bar, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Activity, Download, Droplets, CloudRain, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import api, { formatApiError } from '../lib/api';
import { getToken, getCurrentUser } from '../mockData';
import LimitsCard from './LimitsCard';

const AXIS_TICK = { fontSize: 11 };

// =========================================================================
// 1. Rainfall vs Water Level (DWLR)
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
          <CloudRain className="h-5 w-5 text-indigo-600" /> Rainfall vs DWLR Water Level
        </CardTitle>
        <CardDescription>
          Daily rainfall (mm) overlaid with the average DWLR water level (m).
          Rainfall pulled live from <a className="underline" href="https://open-meteo.com" target="_blank" rel="noreferrer">Open-Meteo</a> ·
          last {days} days · DWLR <Badge variant="outline">{meta.dwlr_id || 'n/a'}</Badge>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading && <p className="text-sm text-gray-500">Loading…</p>}
        {!loading && data.length === 0 && <p className="text-sm text-gray-500 italic">No data for the selected range yet.</p>}
        {data.length > 0 && (
          <div style={{ width: '100%', height: 320 }} data-testid="level-vs-rainfall-chart">
            <ResponsiveContainer>
              <ComposedChart data={data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={AXIS_TICK} />
                <YAxis yAxisId="rain"  orientation="left"  tick={AXIS_TICK} label={{ value: 'Rainfall (mm)', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
                <YAxis yAxisId="level" orientation="right" tick={AXIS_TICK} label={{ value: 'Level (m)',     angle:  90, position: 'insideRight', style: { fontSize: 11 } }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar  yAxisId="rain"  dataKey="rainfall_mm" fill="#6366f1" name="Rainfall (mm)" />
                <Line yAxisId="level" type="monotone" dataKey="level_m" stroke="#27ae60" strokeWidth={2} name="Water Level (m)" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// =========================================================================
// 2. Rainfall Impact — combined rainfall + ground-water abstraction + level
// =========================================================================
const correlationLabel = (r) => {
  if (r == null) return { text: 'n/a', color: 'bg-gray-400' };
  if (r >= 0.6)   return { text: `${r}  ·  strong positive (recharge effective)`,   color: 'bg-emerald-600' };
  if (r >= 0.3)   return { text: `${r}  ·  moderate positive`,                       color: 'bg-emerald-500' };
  if (r > -0.3)   return { text: `${r}  ·  weak / no clear link`,                    color: 'bg-amber-500'   };
  if (r > -0.6)   return { text: `${r}  ·  moderate negative (over-abstraction?)`,   color: 'bg-orange-500'  };
  return            { text: `${r}  ·  strong negative (heavy over-abstraction)`,     color: 'bg-red-600'     };
};

const RainfallImpactChart = ({ days, dwlrId }) => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [meta, setMeta] = useState({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ days: String(days) });
      if (dwlrId) params.append('dwlr_id', dwlrId);
      const { data: d } = await api.get(`/api/reports/rainfall-impact?${params.toString()}`);
      setData(d.series || []);
      setMeta({ dwlr_id: d.dwlr_id, corr: d.rainfall_level_correlation });
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Failed to load impact chart');
    } finally {
      setLoading(false);
    }
  }, [dwlrId, days]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const corr = correlationLabel(meta.corr);

  return (
    <Card data-testid="rainfall-impact-card">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-cyan-600" /> Impact of Rainfall on Groundwater
            </CardTitle>
            <CardDescription>
              How daily rainfall (mm) compares against total groundwater abstraction (KL across every
              borewell) and the resulting average DWLR water level (m) · last {days} days · DWLR
              <Badge variant="outline" className="ml-1">{meta.dwlr_id || 'n/a'}</Badge>
            </CardDescription>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[10px] uppercase tracking-widest text-gray-500">Rainfall ↔ Level</p>
            <Badge className={`mt-1 ${corr.color}`} data-testid="rainfall-impact-correlation">{corr.text}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading && <p className="text-sm text-gray-500">Loading…</p>}
        {!loading && data.length === 0 && <p className="text-sm text-gray-500 italic">No data yet.</p>}
        {data.length > 0 && (
          <div style={{ width: '100%', height: 360 }} data-testid="rainfall-impact-chart">
            <ResponsiveContainer>
              <ComposedChart data={data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={AXIS_TICK} angle={-30} textAnchor="end" height={60} />
                <YAxis yAxisId="rain"  orientation="left"  tick={AXIS_TICK} label={{ value: 'Rainfall (mm) / Abstraction (KL)', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
                <YAxis yAxisId="level" orientation="right" tick={AXIS_TICK} label={{ value: 'Level (m)', angle: 90, position: 'insideRight', style: { fontSize: 11 } }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar  yAxisId="rain"  dataKey="rainfall_mm"    fill="#6366f1" name="Rainfall (mm)" />
                <Bar  yAxisId="rain"  dataKey="abstraction_kl" fill="#4a9fd8" name="Abstraction (KL)" />
                <Line yAxisId="level" type="monotone" dataKey="level_m" stroke="#27ae60" strokeWidth={2.5} dot={false} name="Water Level (m)" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="text-[11px] text-gray-500 mt-2">
          A <strong>positive</strong> correlation means water levels rise when it rains (recharge is working).
          A <strong>negative</strong> correlation typically signals over-abstraction outpacing rainfall recharge.
        </p>
      </CardContent>
    </Card>
  );
};

// =========================================================================
// 3. All-borewells consumption + grand total (downloadable report)
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

  return (
    <Card data-testid="all-borewells-card">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Droplets className="h-5 w-5 text-blue-600" /> All Borewells · Combined Consumption Report
          </CardTitle>
          <CardDescription>
            Total groundwater abstraction (KL) per borewell + grand total · last {days} days. Download as CSV.
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
              {loading ? (
                <tr><td colSpan={3} className="p-3 text-gray-500">Loading…</td></tr>
              ) : (data.borewells || []).length === 0 ? (
                <tr><td colSpan={3} className="p-3 italic text-gray-500">No borewells configured.</td></tr>
              ) : (
                <>
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
                </>
              )}
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
  const [dwlrIds, setDwlrIds] = useState([]);
  const [selectedDwlr, setSelectedDwlr] = useState('');
  const [days, setDays] = useState(30);

  const [enabled, setEnabled] = useState({
    rainfallVsLevel: true,
    rainfallImpact:  true,
    allBorewells:    true,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: dw } = await api.get('/api/instruments/dwlr/latest');
        if (cancelled) return;
        const dws = (dw?.readings || []).map((r) => r.hardware_id).filter(Boolean);
        setDwlrIds(dws);
        if (dws.length) setSelectedDwlr(dws[0]);
      } catch (e) {
        if (process.env.NODE_ENV === 'development') console.warn('[reports-bootstrap]', e?.message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const toggle = (k) => setEnabled((s) => ({ ...s, [k]: !s[k] }));

  const canManageLimits = !!(getCurrentUser()?.role === 'admin' || getCurrentUser()?.permissions?.limits);

  return (
    <div className="space-y-4" data-testid="reports-charts-section">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-cyan-600" /> Graph &amp; Combined Reports
          </CardTitle>
          <CardDescription>
            Pick a DWLR and range, then toggle the sections you want to see.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
                type="number" min={2} max={180}
                value={days}
                onChange={(e) => setDays(Math.max(2, Math.min(180, Number(e.target.value) || 30)))}
                data-testid="reports-days-input"
              />
            </div>
            <div>
              <Label className="text-xs">Show</Label>
              <div className="flex flex-wrap gap-3 text-xs mt-2">
                {[
                  { k: 'rainfallVsLevel', label: 'Rainfall vs Level' },
                  { k: 'rainfallImpact',  label: 'Rainfall Impact'   },
                  { k: 'allBorewells',    label: 'All Borewells'     },
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

      {enabled.rainfallVsLevel && <LevelVsRainfallChart dwlrId={selectedDwlr} days={days} />}
      {enabled.rainfallImpact  && <RainfallImpactChart  dwlrId={selectedDwlr} days={days} />}
      {enabled.allBorewells    && <AllBorewellsReport   days={days} />}

      <LimitsCard canManage={canManageLimits} />
    </div>
  );
};

export default ReportsCharts;
