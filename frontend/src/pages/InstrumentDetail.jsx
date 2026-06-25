import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { isAuthenticated, getCurrentUser, mockLogout } from '../mockData';
import api from '../lib/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { LogOut, ArrowLeft, RefreshCw, Gauge, FlaskConical, Droplets, TrendingUp } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const META = {
  dwlr:        { title: 'Digital Water Level Recorder', subtitle: 'Groundwater level monitoring', icon: TrendingUp,    color: '#27ae60', primaryKey: 'LEVEL',        unit: 'm',     altKeys: ['LEVEL', 'level', 'WATER_LEVEL'] },
  ph:          { title: 'pH Meter',                     subtitle: 'Acidity / alkalinity',         icon: FlaskConical,  color: '#8e44ad', primaryKey: 'PH',           unit: '',      altKeys: ['PH', 'ph'] },
  tds:         { title: 'TDS Meter',                    subtitle: 'Total Dissolved Solids',       icon: Droplets,      color: '#16a085', primaryKey: 'TDS',          unit: 'ppm',   altKeys: ['TDS', 'tds'] },
  conductivity:{ title: 'Conductivity Meter',           subtitle: 'Electrical conductivity',      icon: Gauge,         color: '#2980b9', primaryKey: 'CONDUCTIVITY', unit: 'µS/cm', altKeys: ['CONDUCTIVITY', 'conductivity'] },
};

const POLL_MS = 5000;

// Stable references — kept outside the component so Recharts doesn't
// see a new object on every render (would invalidate its memoization).
const AXIS_TICK = { fontSize: 11 };
const LINE_DOT  = { r: 2 };

const pickValue = (values, keys, fallback = null) => {
  if (!values) return fallback;
  for (const k of keys) if (values[k] != null) return values[k];
  return fallback;
};

const InstrumentDetail = ({ type }) => {
  const navigate = useNavigate();
  const meta = META[type];
  const [user, setUser] = useState(null);
  const [devices, setDevices] = useState([]);
  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  // The "current" device for the live card — derive from the selected hardware_id,
  // falling back to the first device in the list.
  const current = useMemo(
    () => devices.find((d) => d.hardware_id === selected) || devices[0] || null,
    [devices, selected],
  );

  // Secondary values shown on the live card, excluding the primary metric keys.
  // Memoised so we don't re-filter/slice on every render when nothing changed.
  const secondaryValues = useMemo(() => {
    if (!current?.values) return [];
    return Object.entries(current.values)
      .filter(([k]) => !meta.altKeys.includes(k))
      .slice(0, 6);
  }, [current, meta.altKeys]);

  const fetchDevices = useCallback(async () => {
    try {
      const { data } = await api.get(`/api/instruments/${type}/latest`);
      const list = data.readings || [];
      setDevices(list);
      if (!selected && list.length > 0) setSelected(list[0].hardware_id);
    } catch (e) {
      if (process.env.NODE_ENV === 'development') console.warn(`[InstrumentDetail:${type}] failed to fetch devices:`, e?.message || e);
    }
  }, [type, selected]);

  const fetchHistory = useCallback(async (hw) => {
    if (!hw) return;
    try {
      const { data } = await api.get(`/api/instruments/${type}/${hw}/history?limit=50`);
      setHistory((data.readings || []).slice().reverse());
    } catch (e) {
      if (process.env.NODE_ENV === 'development') console.warn(`[InstrumentDetail:${type}] failed to fetch history:`, e?.message || e);
      setHistory([]);
    }
  }, [type]);

  useEffect(() => {
    if (!isAuthenticated()) { navigate('/'); return; }
    setUser(getCurrentUser());
    let mounted = true;
    (async () => {
      await fetchDevices();
      if (mounted) setLoading(false);
    })();
    const t = setInterval(fetchDevices, POLL_MS);
    return () => { mounted = false; clearInterval(t); };
  }, [navigate, fetchDevices]);

  useEffect(() => { if (selected) fetchHistory(selected); }, [selected, fetchHistory, devices]);

  if (!user || !meta) return null;
  const Icon = meta.icon;

  const chartData = history.map((r) => ({
    time: new Date(r.timestamp || r.received_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    value: Number(pickValue(r.values, meta.altKeys, 0)),
  }));

  return (
    <div className="min-h-screen bg-gray-50" data-testid={`detail-${type}-page`}>
      <header className="shadow-md bg-[#1a2332]">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Link to="/dashboard">
              <Button variant="ghost" size="sm" className="text-white hover:text-white hover:bg-white/10">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-white font-bold text-xl tracking-wide" style={{ color: '#4a9fd8' }}>ENVIROLYTICS</h1>
              <p className="text-white text-[8px] tracking-wider" style={{ opacity: 0.7 }}>SUSTAINABILITY PRIVATE LIMITED</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-white text-sm">
              <p className="font-medium">{user.fullName}</p>
              <p className="text-gray-300 text-xs">{user.username}</p>
            </div>
            <Button onClick={() => { mockLogout(); navigate('/'); }} variant="outline" className="border-white text-white hover:text-white" style={{ backgroundColor: '#f5a623', borderColor: '#f5a623' }} data-testid={`detail-${type}-logout`}>
              <LogOut className="mr-2 h-4 w-4" />Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-lg" style={{ backgroundColor: meta.color }}>
              <Icon className="h-7 w-7 text-white" />
            </div>
            <div>
              <h2 className="text-3xl font-bold text-gray-900">{meta.title}</h2>
              <p className="text-gray-600">{meta.subtitle}</p>
            </div>
          </div>
          <Button variant="outline" onClick={fetchDevices} data-testid={`detail-${type}-refresh`}>
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
        </div>

        {loading ? (
          <Card><CardContent className="py-12 text-center text-gray-500">Loading {meta.title.toLowerCase()} data…</CardContent></Card>
        ) : devices.length === 0 ? (
          <Card data-testid={`detail-${type}-empty`}>
            <CardContent className="py-16 text-center">
              <Icon className="h-12 w-12 mx-auto mb-4" style={{ color: meta.color }} />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">No {meta.title.toLowerCase()} readings yet</h3>
              <p className="text-gray-600 max-w-xl mx-auto">
                Subscribe a device via <code className="bg-gray-100 px-2 py-1 rounded text-sm">POST /api/instruments/subscribe</code> with
                <span className="font-mono"> {`{ "instrument_type": "${type}", "hardware_id": "…" }`}</span>
                or push a demo reading via <code className="bg-gray-100 px-2 py-1 rounded text-sm">POST /api/instruments/ingest?instrument_type={type}</code>.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
              <Card className="lg:col-span-2 border-t-4" style={{ borderTopColor: meta.color }}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>Live — {current?.hardware_id}</span>
                    <Badge className="bg-green-500 text-white">LIVE</Badge>
                  </CardTitle>
                  <CardDescription>Last updated {current ? new Date(current.received_at || current.timestamp).toLocaleString() : '—'}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-center py-6">
                    <div className="inline-flex items-baseline gap-2 mb-4">
                      <span className="text-6xl font-bold" style={{ color: meta.color }} data-testid={`detail-${type}-value`}>
                        {pickValue(current?.values, meta.altKeys, '—')}
                      </span>
                      {meta.unit && <span className="text-2xl font-semibold text-gray-600">{meta.unit}</span>}
                    </div>
                    {current?.values && (
                      <div className="grid grid-cols-3 gap-3 mt-6">
                        {secondaryValues.map(([k, v]) => (
                          <div key={k} className="p-3 bg-gray-50 rounded">
                            <p className="text-xs text-gray-500 uppercase">{k}</p>
                            <p className="text-lg font-bold text-gray-900">{String(v)}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-t-4" style={{ borderTopColor: '#f5a623' }}>
                <CardHeader><CardTitle>Devices ({devices.length})</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {devices.map((d) => (
                    <button
                      key={d.hardware_id}
                      onClick={() => setSelected(d.hardware_id)}
                      className={`w-full text-left p-3 rounded border-2 ${d.hardware_id === selected ? 'border-current bg-blue-50' : 'border-gray-200 hover:border-current'}`}
                      style={{ color: d.hardware_id === selected ? meta.color : undefined }}
                      data-testid={`detail-${type}-device-${d.hardware_id}`}
                    >
                      <p className="font-bold text-gray-900">{d.hardware_id}</p>
                      <p className="text-xl font-bold" style={{ color: meta.color }}>
                        {pickValue(d.values, meta.altKeys, '—')}{meta.unit}
                      </p>
                    </button>
                  ))}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>History — {selected || '—'}</CardTitle>
                <CardDescription>Last {chartData.length} readings</CardDescription>
              </CardHeader>
              <CardContent>
                {chartData.length === 0 ? (
                  <p className="text-center py-8 text-gray-500">No history yet.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="time" tick={AXIS_TICK} />
                      <YAxis tick={AXIS_TICK} />
                      <Tooltip />
                      <Line type="monotone" dataKey="value" stroke={meta.color} strokeWidth={2} dot={LINE_DOT} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
};

export default InstrumentDetail;
