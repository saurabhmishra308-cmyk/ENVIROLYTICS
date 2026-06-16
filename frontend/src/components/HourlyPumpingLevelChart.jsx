import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Activity } from 'lucide-react';
import api from '../lib/api';

const AXIS_TICK = { fontSize: 11 };

const HourlyPumpingLevelChart = () => {
  const [flowmeters, setFlowmeters] = useState([]);
  const [hardwareId, setHardwareId] = useState('');
  const [hours, setHours] = useState(24);
  const [series, setSeries] = useState([]);
  const [meta, setMeta] = useState({});
  const [loading, setLoading] = useState(false);

  // Pick the first available flowmeter
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/api/flowmeter/latest');
        if (cancelled) return;
        const ids = (data?.flowmeters || []).map((r) => r.hardware_id).filter(Boolean);
        setFlowmeters(ids);
        if (ids.length) setHardwareId(ids[0]);
      } catch (e) {
        if (process.env.NODE_ENV === 'development') console.warn('[hourly] bootstrap', e?.message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const fetchData = useCallback(async () => {
    if (!hardwareId) return;
    setLoading(true);
    try {
      const { data } = await api.get(
        `/api/reports/hourly-pumping-vs-level?hardware_id=${encodeURIComponent(hardwareId)}&hours=${hours}`,
      );
      setSeries(data?.series || []);
      setMeta({ dwlr: data?.dwlr_id });
    } catch (e) {
      if (process.env.NODE_ENV === 'development') console.warn('[hourly] fetch', e?.message);
    } finally {
      setLoading(false);
    }
  }, [hardwareId, hours]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <Card className="border-t-4" style={{ borderTopColor: '#16a085' }} data-testid="hourly-pumping-level-card">
      <CardHeader>
        <div className="flex items-center gap-3 justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg" style={{ backgroundColor: '#16a085' }}>
              <Activity className="h-5 w-5 text-white" />
            </div>
            <div>
              <CardTitle>Hourly Pumping vs Water Level</CardTitle>
              <CardDescription>
                Hour-by-hour pumped volume (KL) and the corresponding average DWLR water level (m).
              </CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Borewell</Label>
            <select
              data-testid="hourly-fm-select"
              className="w-full border rounded-md px-2 py-2 text-sm bg-white dark:bg-gray-800"
              value={hardwareId}
              onChange={(e) => setHardwareId(e.target.value)}
            >
              {flowmeters.map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs">Hours back</Label>
            <Input
              type="number" min={1} max={168}
              value={hours}
              onChange={(e) => setHours(Math.max(1, Math.min(168, Number(e.target.value) || 24)))}
              data-testid="hourly-hours-input"
            />
          </div>
          <div className="flex items-end text-xs text-gray-500">
            DWLR: <span className="ml-1 font-mono">{meta.dwlr || 'auto'}</span>
          </div>
        </div>
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : series.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No data yet.</p>
        ) : (
          <div style={{ width: '100%', height: 300 }} data-testid="hourly-chart">
            <ResponsiveContainer>
              <ComposedChart data={series}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hour_label" tick={AXIS_TICK} angle={-30} textAnchor="end" height={60} />
                <YAxis yAxisId="kl" orientation="left" tick={AXIS_TICK} label={{ value: 'Pumped (KL)', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
                <YAxis yAxisId="m"  orientation="right" tick={AXIS_TICK} label={{ value: 'Level (m)',  angle:  90, position: 'insideRight', style: { fontSize: 11 } }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="kl" dataKey="pumped_kl" fill="#4a9fd8" name="Pumped (KL)" />
                <Line yAxisId="m" type="monotone" dataKey="level_m" stroke="#27ae60" strokeWidth={2} name="Water Level (m)" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default HourlyPumpingLevelChart;
