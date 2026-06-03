import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { isAuthenticated, getCurrentUser, mockLogout } from '../mockData';
import api from '../lib/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { LogOut, ArrowLeft, Droplets, AlertCircle, Clock, Download, RefreshCw, BarChart3 } from 'lucide-react';
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import ReadingsTable from '../components/ReadingsTable';

// Module-level constants to avoid recreating chart prop objects each render
const AXIS_TICK = { fontSize: 11 };
const Y_LABEL_KL = { value: 'KL', angle: -90, position: 'insideLeft', fontSize: 11 };
const KL_TOOLTIP = (v) => [`${v} KL`, 'Abstraction'];

const POLL_MS = 5000;

const Flowmeter = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [latest, setLatest] = useState([]); // all flowmeters latest readings
  const [selected, setSelected] = useState(null); // hardware_id
  const [history, setHistory] = useState([]);
  const [hourly, setHourly] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mqttStatus, setMqttStatus] = useState({ connected: false });

  const fetchLatest = useCallback(async () => {
    try {
      const { data } = await api.get('/api/flowmeter/latest');
      const list = data.flowmeters || [];
      setLatest(list);
      if (!selected && list.length > 0) setSelected(list[0].hardware_id);
    } catch (e) {
      console.warn('[Flowmeter] failed to fetch latest:', e?.message || e);
    }
  }, [selected]);

  const fetchStatus = useCallback(async () => {
    try {
      const { data } = await api.get('/api/flowmeter/status');
      setMqttStatus(data);
    } catch (e) {
      console.warn('[Flowmeter] failed to fetch MQTT status:', e?.message || e);
      setMqttStatus({ connected: false });
    }
  }, []);

  const fetchHistory = useCallback(async (hwId) => {
    if (!hwId) return;
    try {
      const [histRes, hourlyRes] = await Promise.all([
        api.get(`/api/flowmeter/history/${hwId}?limit=20`),
        api.get(`/api/flowmeter-mgmt/${hwId}/hourly-buckets?hours=24`).catch(() => ({ data: { buckets: [] } })),
      ]);
      setHistory(histRes.data.readings || []);
      setHourly((hourlyRes.data.buckets || []).map((b) => ({ time: b.hour_label, kl: b.abstraction_kl })));
    } catch (e) {
      console.warn('[Flowmeter] failed to fetch history:', e?.message || e);
      setHistory([]);
      setHourly([]);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) { navigate('/'); return; }
    setUser(getCurrentUser());
    let mounted = true;
    (async () => {
      await Promise.all([fetchLatest(), fetchStatus()]);
      if (mounted) setLoading(false);
    })();
    const t = setInterval(() => { fetchLatest(); fetchStatus(); }, POLL_MS);
    return () => { mounted = false; clearInterval(t); };
  }, [navigate, fetchLatest, fetchStatus]);

  useEffect(() => {
    if (selected) fetchHistory(selected);
  }, [selected, fetchHistory, latest]);

  const handleLogout = () => { mockLogout(); navigate('/'); };

  if (!user) return null;

  const current = latest.find((r) => r.hardware_id === selected) || latest[0];
  const recentReadings = history.slice(0, 10).map((r, i) => ({
    id: r._id || `reading_${i}`,
    time: new Date(r.timestamp || r.received_at).toLocaleTimeString(),
    flow: Number(r.flow_rate_lpm || 0).toFixed(2),
    volume: Number(r.forward_totalizer || 0).toFixed(2),
    status: 'Normal',
  }));

  return (
    <div className="min-h-screen bg-gray-50" data-testid="flowmeter-page">
      <header className="shadow-md bg-[#1a2332]">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Link to="/dashboard">
              <Button variant="ghost" size="sm" className="text-white hover:text-white hover:bg-white/10" data-testid="flowmeter-back-btn">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-white font-bold text-xl tracking-wide" style={{ color: '#4a9fd8' }}>ENVIROLYTICS</h1>
              <p className="text-white text-[8px] tracking-wider" style={{ opacity: 0.7 }}>SUSTAINABILITY PRIVATE LIMITED</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Badge className={mqttStatus.connected ? 'bg-green-500' : 'bg-red-500'} data-testid="mqtt-status-badge">
              MQTT {mqttStatus.connected ? 'CONNECTED' : 'OFFLINE'}
            </Badge>
            <div className="text-white text-sm">
              <p className="font-medium">{user.fullName}</p>
              <p className="text-gray-300 text-xs">{user.username}</p>
            </div>
            <Button onClick={handleLogout} variant="outline" className="border-white text-white hover:text-white" style={{ backgroundColor: '#f5a623', borderColor: '#f5a623' }} data-testid="flowmeter-logout-btn">
              <LogOut className="mr-2 h-4 w-4" />Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-lg" style={{ backgroundColor: '#4a9fd8' }}>
              <Droplets className="h-8 w-8 text-white" />
            </div>
            <div>
              <h2 className="text-3xl font-bold text-gray-900">Flowmeter Monitoring System</h2>
              <p className="text-gray-600">Live MQTT-driven flow measurements</p>
            </div>
          </div>
          <Button onClick={() => { fetchLatest(); fetchStatus(); }} variant="outline" data-testid="flowmeter-refresh-btn">
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
        </div>

        {loading ? (
          <Card><CardContent className="py-12 text-center text-gray-500">Loading flowmeter data…</CardContent></Card>
        ) : latest.length === 0 ? (
          <Card data-testid="flowmeter-empty-state">
            <CardContent className="py-16 text-center">
              <AlertCircle className="h-12 w-12 mx-auto mb-4 text-amber-500" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">No flowmeter readings yet</h3>
              <p className="text-gray-600 max-w-xl mx-auto">
                The MQTT broker is configured but no flowmeter devices have published data to this server.
                Subscribe to a device using <code className="bg-gray-100 px-2 py-1 rounded">POST /api/flowmeter/subscribe/flowmeter</code>.
              </p>
              <p className="text-xs text-gray-500 mt-4">
                MQTT broker: {mqttStatus.broker || 'not configured'} — Status: <strong>{mqttStatus.connected ? 'Connected' : 'Disconnected'}</strong>
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
              <Card className="lg:col-span-2 border-t-4" style={{ borderTopColor: '#4a9fd8' }}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span className="text-gray-900">Live Flow Rate - {current?.hardware_id}</span>
                    <Badge className="bg-green-500 text-white">LIVE</Badge>
                  </CardTitle>
                  <CardDescription>Last updated: {current ? new Date(current.received_at || current.timestamp).toLocaleString() : '—'}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-center py-8">
                    <div className="inline-flex items-baseline gap-2 mb-4">
                      <span className="text-7xl font-bold" style={{ color: '#4a9fd8' }} data-testid="flowmeter-flow-value">
                        {Number(current?.flow_rate_lpm || 0).toFixed(2)}
                      </span>
                      <span className="text-3xl font-semibold text-gray-600">L/min</span>
                    </div>
                    <div className="grid grid-cols-3 gap-4 mt-8">
                      <div className="p-4 bg-blue-50 rounded-lg">
                        <p className="text-sm text-gray-600 mb-1">Forward Totalizer</p>
                        <p className="text-2xl font-bold text-gray-900">{Number(current?.forward_totalizer || 0).toFixed(2)}</p>
                        <p className="text-xs text-gray-500">{current?.unit_name || 'L'}</p>
                      </div>
                      <div className="p-4 bg-green-50 rounded-lg">
                        <p className="text-sm text-gray-600 mb-1">Reverse Totalizer</p>
                        <p className="text-2xl font-bold text-gray-900">{Number(current?.reverse_totalizer || 0).toFixed(2)}</p>
                        <p className="text-xs text-gray-500">{current?.unit_name || 'L'}</p>
                      </div>
                      <div className="p-4 bg-amber-50 rounded-lg">
                        <p className="text-sm text-gray-600 mb-1">Temperature</p>
                        <p className="text-2xl font-bold text-gray-900">{Number(current?.temperature || 0).toFixed(1)}</p>
                        <p className="text-xs text-gray-500">°C</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-t-4" style={{ borderTopColor: '#f5a623' }}>
                <CardHeader>
                  <CardTitle className="text-gray-900">Device Info</CardTitle>
                  <CardDescription>{current?.hardware_id}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <span className="text-sm text-gray-600">IMEI</span>
                    <span className="text-sm font-mono">{current?.imei || '—'}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <span className="text-sm text-gray-600">Signal</span>
                    <span className="text-sm font-bold">{current?.signal_strength || 0} dBm</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <span className="text-sm text-gray-600">Firmware</span>
                    <span className="text-sm">{current?.firmware_version || '—'}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <Clock className="w-4 h-4 text-gray-600" />
                    <span className="text-sm">{current ? new Date(current.received_at || current.timestamp).toLocaleTimeString() : '—'}</span>
                  </div>
                  <Button className="w-full mt-2" style={{ backgroundColor: '#4a9fd8' }} onClick={() => navigate('/reports')} data-testid="flowmeter-export-btn">
                    <Download className="mr-2 h-4 w-4" />Export Report
                  </Button>
                </CardContent>
              </Card>
            </div>

            <Card className="mb-8">
              <CardHeader>
                <CardTitle className="text-gray-900">All Flowmeters</CardTitle>
                <CardDescription>Click a device to view its history below</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {latest.map((m) => {
                    const isSel = m.hardware_id === selected;
                    return (
                      <button
                        key={m.hardware_id}
                        onClick={() => setSelected(m.hardware_id)}
                        className={`text-left p-4 rounded-lg border-2 transition-all ${isSel ? 'border-[#4a9fd8] bg-blue-50' : 'border-gray-200 hover:border-[#4a9fd8]'}`}
                        data-testid={`flowmeter-card-${m.hardware_id}`}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <span className="font-bold text-gray-900">{m.hardware_id}</span>
                          <Badge className="bg-green-500">Active</Badge>
                        </div>
                        <p className="text-2xl font-bold" style={{ color: '#4a9fd8' }}>{Number(m.flow_rate_lpm || 0).toFixed(2)}</p>
                        <p className="text-xs text-gray-500">L/min · {Number(m.temperature || 0).toFixed(1)}°C</p>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card className="mb-8">
              <CardHeader>
                <CardTitle className="text-gray-900 flex items-center gap-2"><BarChart3 className="h-5 w-5" />Hourly Ground Water Abstraction — {selected}</CardTitle>
                <CardDescription>Last 24 hours · kilolitres (KL) per hour</CardDescription>
              </CardHeader>
              <CardContent>
                {hourly.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">No hourly data yet.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={hourly}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="time" tick={AXIS_TICK} />
                      <YAxis tick={AXIS_TICK} label={Y_LABEL_KL} />
                      <Tooltip formatter={KL_TOOLTIP} />
                      <Bar dataKey="kl" fill="#4a9fd8" name="Hourly KL" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-gray-900">Recent Readings - {selected || '—'}</CardTitle>
                <CardDescription>Latest historical data points</CardDescription>
              </CardHeader>
              <CardContent>
                {recentReadings.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">No history yet for this device.</p>
                ) : (
                  <ReadingsTable readings={recentReadings} />
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>

      <footer className="mt-12 py-4 bg-[#1a2332]">
        <div className="container mx-auto px-4 text-center text-white text-sm">
          <p>© 2026 Envirolytics Sustainability Private Limited. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default Flowmeter;
