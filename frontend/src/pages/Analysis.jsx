import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Droplets, TrendingUp, Activity } from 'lucide-react';
import api from '../lib/api';

const Analysis = () => {
  const [groundwater, setGroundwater] = useState([]); // aggregates of groundwater_abstraction flowmeters
  const [dwlrDevices, setDwlrDevices] = useState([]); // latest readings
  const [dwlrHistory, setDwlrHistory] = useState({}); // {hw_id: [...history]}
  const [flowHourly, setFlowHourly] = useState({}); // {hw_id: [...hourly buckets]}
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [fmRes, dwlrRes, catRes] = await Promise.all([
        api.get('/api/flowmeter/latest'),
        api.get('/api/instruments/dwlr/latest'),
        api.get('/api/flowmeter-mgmt/categories'),
      ]);
      const cats = catRes.data.categories || [];
      const catMap = Object.fromEntries(cats.map((c) => [c.hardware_id, c]));
      const allFm = fmRes.data.flowmeters || [];
      // Include flowmeters categorised as groundwater_abstraction OR with no category (default)
      const gwIds = allFm
        .filter((fm) => (catMap[fm.hardware_id]?.category || 'groundwater_abstraction') === 'groundwater_abstraction')
        .map((fm) => fm.hardware_id);

      const aggs = await Promise.all(gwIds.map((id) => api.get(`/api/flowmeter-mgmt/${id}/aggregate`).then((r) => r.data).catch(() => null)));
      setGroundwater(aggs.filter(Boolean));

      const hourly = {};
      await Promise.all(gwIds.map(async (id) => {
        try {
          const r = await api.get(`/api/flowmeter-mgmt/${id}/hourly-buckets?hours=24`);
          hourly[id] = (r.data.buckets || []);
        } catch { hourly[id] = []; }
      }));
      setFlowHourly(hourly);

      const dwlrList = dwlrRes.data.readings || [];
      setDwlrDevices(dwlrList);
      const hist = {};
      await Promise.all(dwlrList.map(async (d) => {
        try {
          const r = await api.get(`/api/instruments/dwlr/${d.hardware_id}/history?limit=50`);
          hist[d.hardware_id] = (r.data.readings || []).slice().reverse();
        } catch { hist[d.hardware_id] = []; }
      }));
      setDwlrHistory(hist);
    } catch {
      // empty state will render
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="p-6 space-y-6" data-testid="analysis-page">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Data Analysis</h1>
        <p className="text-gray-600 mt-1">Flowmeter (ground water abstraction) and DWLR (water level) analytics only.</p>
      </div>

      {/* === Flowmeter Analysis === */}
      <Card className="border-t-4" style={{ borderTopColor: '#4a9fd8' }}>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg" style={{ backgroundColor: '#4a9fd8' }}><Droplets className="h-5 w-5 text-white" /></div>
            <div>
              <CardTitle>Ground Water Abstraction — Flowmeter Analytics</CardTitle>
              <CardDescription>Hourly abstraction trend (KL) over the last 24 hours and consumption summary.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <p className="text-center py-6 text-gray-500">Loading…</p>
          ) : groundwater.length === 0 ? (
            <p className="text-center py-6 text-gray-500">No groundwater flowmeter data yet.</p>
          ) : (
            groundwater.map((agg) => {
              const series = (flowHourly[agg.hardware_id] || []).map((b) => ({ time: b.hour_label, kl: b.abstraction_kl }));
              return (
                <div key={agg.hardware_id} className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-gray-900">{agg.label || agg.hardware_id} <span className="text-xs text-gray-500">({agg.hardware_id})</span></p>
                      <p className="text-xs text-gray-500">Now: <strong>{agg.flow_rate_m3h?.toFixed(3)} m³/hr</strong></p>
                    </div>
                    <Badge className="bg-blue-500">{agg.consumption_kl?.daily?.toFixed(2)} KL / day</Badge>
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={series}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="time" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} label={{ value: 'KL', angle: -90, position: 'insideLeft', fontSize: 11 }} />
                      <Tooltip formatter={(v) => [`${v} KL`, 'Abstraction']} />
                      <Bar dataKey="kl" fill="#4a9fd8" name="Hourly KL" />
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    {['hourly', 'weekly', 'monthly', 'yearly'].map((k) => (
                      <div key={k} className="p-2 bg-blue-50 rounded">
                        <p className="text-xs text-gray-500 capitalize">{k}</p>
                        <p className="text-base font-bold text-blue-700">{(agg.consumption_kl?.[k] ?? 0).toFixed(2)} KL</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* === DWLR Analysis === */}
      <Card className="border-t-4" style={{ borderTopColor: '#27ae60' }}>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg" style={{ backgroundColor: '#27ae60' }}><TrendingUp className="h-5 w-5 text-white" /></div>
            <div>
              <CardTitle>DWLR — Water Level Analytics</CardTitle>
              <CardDescription>Recent water-level trend per recorder.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <p className="text-center py-6 text-gray-500">Loading…</p>
          ) : dwlrDevices.length === 0 ? (
            <p className="text-center py-6 text-gray-500">No DWLR data yet.</p>
          ) : (
            dwlrDevices.map((d) => {
              const series = (dwlrHistory[d.hardware_id] || []).map((r) => ({
                time: new Date(r.timestamp || r.received_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                level: Number(r.values?.LEVEL || r.values?.level || 0),
              }));
              return (
                <div key={d.hardware_id} className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-gray-900">{d.hardware_id}</p>
                      <p className="text-xs text-gray-500">Current level: <strong>{d.values?.LEVEL ?? '—'} m</strong></p>
                    </div>
                    <Badge className="bg-green-500"><Activity className="h-3 w-3 mr-1" />Live</Badge>
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={series}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="time" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} label={{ value: 'm', angle: -90, position: 'insideLeft', fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="level" stroke="#27ae60" strokeWidth={2} dot={{ r: 2 }} name="Water Level (m)" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Analysis;
