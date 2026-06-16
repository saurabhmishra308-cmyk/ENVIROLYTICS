import React, { useEffect, useState, useCallback } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { CloudRain } from 'lucide-react';
import api from '../lib/api';

const AXIS_TICK = { fontSize: 11 };

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
          Daily rainfall and DWLR water-level trend — the only graph this page shows.
        </p>
      </div>

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
