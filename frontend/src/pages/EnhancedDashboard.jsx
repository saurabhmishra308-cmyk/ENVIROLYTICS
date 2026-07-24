import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentUser, isAuthenticated, mockLogout, isAdmin } from '../mockData';
import api from '../lib/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { useTheme } from '../contexts/ThemeContext';
import { LogOut, Sun, Moon, Droplets, TrendingUp, Activity, MapPin, FlaskConical, AlertCircle, Factory, Wind, Send } from 'lucide-react';
import axios from 'axios';
import { toast } from 'sonner';

import WeatherCard from '../components/WeatherCard';
import InstrumentSection from '../components/InstrumentSection';
import LocationMap from '../components/LocationMap';
import OfflineAlertsBanner from '../components/OfflineAlertsBanner';
import NotificationRecipientsCard from '../components/NotificationRecipientsCard';

const POLL_MS = 5000;
const logError = (e, c) => { if (process.env.NODE_ENV === 'development') console.error(`[${c}]`, e); };

const pickValue = (values, keys, fallback = null) => {
  if (!values) return fallback;
  for (const k of keys) if (values[k] != null) return values[k];
  return fallback;
};

const fmtNumber = (n, digits = 2) => (n == null || isNaN(n) ? '—' : Number(n).toFixed(digits));

const TotaliserCard = ({ label, value, isDarkMode, color = '#4a9fd8' }) => (
  <div className={`p-3 rounded-lg ${isDarkMode ? 'bg-gray-700' : 'bg-gray-50'} border`}>
    <p className={`text-[11px] uppercase tracking-wide ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>{label}</p>
    <p className="text-xl font-bold mt-0.5" style={{ color }}>{fmtNumber(value, 2)}<span className="text-xs ml-1 text-gray-500">KL</span></p>
  </div>
);

const FlowmeterTile = ({ agg, isDarkMode, color, onClick, location }) => {
  const muted = isDarkMode ? 'text-gray-400' : 'text-gray-600';
  const text = isDarkMode ? 'text-white' : 'text-gray-900';
  const isLive = (agg.flow_rate_m3h || 0) > 0 || (agg.totaliser_forward_kl || 0) > 0;
  return (
    <div
      onClick={onClick}
      className={`p-4 rounded-lg border-2 ${isDarkMode ? 'bg-gray-800' : 'bg-white'} ${onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
      style={{ borderColor: isLive ? color : '#cbd5e1' }}
      data-testid={`flowmeter-tile-${agg.hardware_id}`}
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className={`font-bold ${text}`}>{agg.label || agg.hardware_id}</p>
          <p className={`text-xs ${muted}`}>{agg.hardware_id}</p>
        </div>
        <Badge className={isLive ? 'bg-green-500' : 'bg-gray-400'}>{isLive ? 'LIVE' : 'IDLE'}</Badge>
      </div>
      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-3xl font-bold" style={{ color }}>{fmtNumber(agg.flow_rate_m3h, 3)}</span>
        <span className={`text-sm ${muted}`}>m³/hr</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <TotaliserCard label="Hourly" value={agg.consumption_kl?.hourly} isDarkMode={isDarkMode} color={color} />
        <TotaliserCard label="Weekly" value={agg.consumption_kl?.weekly} isDarkMode={isDarkMode} color={color} />
        <TotaliserCard label="Monthly" value={agg.consumption_kl?.monthly} isDarkMode={isDarkMode} color={color} />
        <TotaliserCard label="Yearly" value={agg.consumption_kl?.yearly} isDarkMode={isDarkMode} color={color} />
      </div>
      {agg.totaliser_forward_kl > 0 && (
        <p className={`text-xs mt-2 ${muted}`}>Cumulative totaliser: <strong>{fmtNumber(agg.totaliser_forward_kl, 2)} KL</strong></p>
      )}
      {location && (
        <p className={`text-xs mt-2 flex items-center gap-1 ${muted}`} data-testid={`tile-location-${agg.hardware_id}`}>
          <MapPin className="h-3 w-3" />
          <span className="truncate" title={location}>{location}</span>
        </p>
      )}
    </div>
  );
};

const EnhancedDashboard = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const { isDarkMode, toggleTheme } = useTheme();

  const [weather, setWeather] = useState(null);
  const [loadingWeather, setLoadingWeather] = useState(true);
  const [aggregates, setAggregates] = useState({}); // hardware_id -> aggregate
  const [categories, setCategories] = useState([]); // [{hardware_id, category, label}]
  const [byType, setByType] = useState({ dwlr: [], ph: [], tds: [], conductivity: [] });
  const [mqttStatus, setMqttStatus] = useState({ connected: false });
  const [telemetrySources, setTelemetrySources] = useState({
    mqtt: { has_devices: true, connected: false },
    http: { has_devices: false, connected: false },
  });
  const [locations, setLocations] = useState([]);
  // hardware_id → resolved location string (device.location_name ‖ owner.location_name)
  const [locationByHw, setLocationByHw] = useState({});
  const [sendingSelfTest, setSendingSelfTest] = useState(false);

  const handleSelfTestAlert = useCallback(async () => {
    setSendingSelfTest(true);
    try {
      const { data } = await api.post('/api/notifications/test-me');
      if (data?.sent) {
        toast.success(`Test alert sent to ${data.recipient_count || 1} recipient${(data.recipient_count || 1) === 1 ? '' : 's'}.`);
      } else if (data?.reason === 'rate_limited') {
        toast.warning(`Please wait ${data.retry_after_seconds || 60}s before sending another test.`);
      } else {
        toast.error(`Not sent — ${data?.reason || 'unknown error'}`);
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to send test alert');
    } finally {
      setSendingSelfTest(false);
    }
  }, []);
  // STP + DO live snapshot for the compact tile rows
  const [stpDevices, setStpDevices] = useState([]);
  const [doDevices, setDoDevices] = useState([]);

  // Human-readable "time since last reading" + traffic-light colour used by
  // the STP & DO tile rows so ops can spot silent instruments at a glance.
  const timeSince = (iso) => {
    if (!iso) return { label: 'No data yet', color: '#94a3b8', level: 'never' };
    const ms = Date.now() - new Date(iso).getTime();
    if (Number.isNaN(ms) || ms < 0) return { label: 'No data yet', color: '#94a3b8', level: 'never' };
    const mins = Math.floor(ms / 60000);
    if (mins < 1)  return { label: 'Just now',       color: '#10b981', level: 'fresh' };
    if (mins < 60) return { label: `${mins} min ago`, color: '#10b981', level: 'fresh' };
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return { label: `${hrs} hr ago`,   color: '#f59e0b', level: 'stale' };
    const days = Math.floor(hrs / 24);
    if (days < 7)  return { label: `${days} day${days === 1 ? '' : 's'} ago`, color: '#ef4444', level: 'silent' };
    return { label: `${days} days ago`, color: '#7f1d1d', level: 'silent' };
  };

  const LATITUDE = useMemo(() => 26.8467, []);
  const LONGITUDE = useMemo(() => 80.9462, []);
  const WEATHER_API_KEY = useMemo(() => process.env.REACT_APP_WEATHER_API_KEY, []);

  const fetchWeather = useCallback(async () => {
    try {
      // Use backend proxy (Open-Meteo, no key required) — updates live every refresh.
      const r = await api.get('/api/weather/live');
      setWeather(r.data);
    } catch (e) { logError(e, 'weather'); }
    finally { setLoadingWeather(false); }
  }, []);

  const fetchLive = useCallback(async () => {
    try {
      const [fmRes, instrRes, statusRes, catRes] = await Promise.all([
        api.get('/api/flowmeter/latest'),
        api.get('/api/instruments/all/latest'),
        api.get('/api/flowmeter/status'),
        api.get('/api/flowmeter-mgmt/categories'),
      ]);
      // Pull aggregate for each flowmeter (parallel)
      const flowmeters = fmRes.data.flowmeters || [];
      const cats = catRes.data.categories || [];
      setCategories(cats);
      const aggs = await Promise.all(
        flowmeters.map((fm) => api.get(`/api/flowmeter-mgmt/${fm.hardware_id}/aggregate`).then((r) => r.data).catch(() => null))
      );
      // Also pull aggregates for any *registered* hardware that has a category but no readings yet
      const knownIds = new Set(flowmeters.map((f) => f.hardware_id));
      const extraIds = cats.map((c) => c.hardware_id).filter((id) => !knownIds.has(id));
      const extraAggs = await Promise.all(
        extraIds.map((id) => api.get(`/api/flowmeter-mgmt/${id}/aggregate`).then((r) => r.data).catch(() => null))
      );
      const aggMap = {};
      [...aggs, ...extraAggs].forEach((a) => { if (a && a.hardware_id) aggMap[a.hardware_id] = a; });
      setAggregates(aggMap);

      const grouped = instrRes.data.by_type || {};
      setByType({
        dwlr: grouped.dwlr || [],
        ph: grouped.ph || [],
        tds: grouped.tds || [],
        conductivity: grouped.conductivity || [],
      });
      setMqttStatus(statusRes.data || { connected: false });
      // Pull STP + DO latest snapshots for the compact tile rows.
      try {
        const wqRes = await api.get('/api/water-quality/latest');
        setStpDevices(wqRes.data?.stp || []);
        setDoDevices(wqRes.data?.do || []);
      } catch (_) { /* ignore — the dashboard still renders without WQ */ }
    } catch (e) { logError(e, 'fetchLive'); }
  }, []);

  const fetchLocations = useCallback(async () => {
    try {
      // `/api/instrument-registry` already scopes to the current user for non-admin
      // (admins see everything), so the map naturally shows only the client's own
      // instruments. Users see only their own devices' coordinates — nothing else.
      const { data } = await api.get('/api/instrument-registry');
      const rows = data.instruments || data.items || [];
      const mapped = rows
        .filter((it) => it.latitude != null && it.longitude != null)
        .map((it) => ({
          hardware_id: it.hardware_id,
          instrument_type: it.instrument_type,
          label: it.label || it.hardware_id,
          location_name: it.location_name || it.owner_location_name || null,
          latitude: it.latitude,
          longitude: it.longitude,
          owner_name: it.owner_name || null,
        }));
      setLocations(mapped);
      // Every registered device (with or without coords) contributes to the
      // hardware→location map so the tiles can render the 📍 line even when
      // the device has no lat/lng set.
      const byHw = {};
      rows.forEach((it) => {
        const loc = it.location_name || it.owner_location_name || null;
        if (loc) byHw[it.hardware_id] = loc;
      });
      setLocationByHw(byHw);
    } catch (e) { logError(e, 'locations'); }
  }, []);

  const fetchTelemetrySources = useCallback(async () => {
    try {
      const { data } = await api.get('/api/telemetry/sources');
      if (data) setTelemetrySources(data);
    } catch (e) { logError(e, 'telemetry_sources'); }
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) { navigate('/'); return; }
    setUser(getCurrentUser());
    fetchWeather();
    fetchLive();
    fetchLocations();
    fetchTelemetrySources();
    const t = setInterval(fetchLive, POLL_MS);
    const ts = setInterval(fetchTelemetrySources, POLL_MS * 3);
    // Refresh weather every 5 minutes so the "Live Weather Data" card stays current
    const tw = setInterval(fetchWeather, 5 * 60 * 1000);
    return () => { clearInterval(t); clearInterval(ts); clearInterval(tw); };
  }, [navigate, fetchWeather, fetchLive, fetchLocations, fetchTelemetrySources]);

  if (!user) return null;

  const bg = isDarkMode ? 'bg-gray-900' : 'bg-gray-50';
  const text = isDarkMode ? 'text-white' : 'text-gray-900';
  const muted = isDarkMode ? 'text-gray-400' : 'text-gray-600';

  // Group flowmeters by category
  const aggList = Object.values(aggregates);
  const groundwater = aggList.filter((a) => (a.category || 'groundwater_abstraction') === 'groundwater_abstraction');
  const stpInlet = aggList.filter((a) => a.category === 'stp_inlet');
  const stpOutlet = aggList.filter((a) => a.category === 'stp_outlet');

  // Build water-quality tiles (pH, Conductivity, TDS)
  const qualityTiles = [];
  byType.ph.forEach((r) => qualityTiles.push({ hardware_id: r.hardware_id, label: 'pH', value: pickValue(r.values, ['PH', 'ph'], '—'), unit: '', status: 'active', meta: r.values?.TEMPER != null ? `${r.values.TEMPER}°C` : null }));
  if (byType.ph.length === 0) qualityTiles.push({ hardware_id: '', label: 'pH', value: null, unit: '', status: 'inactive' });
  byType.conductivity.forEach((r) => qualityTiles.push({ hardware_id: r.hardware_id, label: 'Conductivity', value: pickValue(r.values, ['CONDUCTIVITY', 'conductivity'], '—'), unit: 'µS/cm', status: 'active' }));
  if (byType.conductivity.length === 0) qualityTiles.push({ hardware_id: '', label: 'Conductivity', value: null, unit: 'µS/cm', status: 'inactive' });
  byType.tds.forEach((r) => qualityTiles.push({ hardware_id: r.hardware_id, label: 'TDS', value: pickValue(r.values, ['TDS', 'tds'], '—'), unit: 'ppm', status: 'active' }));
  if (byType.tds.length === 0) qualityTiles.push({ hardware_id: '', label: 'TDS', value: null, unit: 'ppm', status: 'inactive' });

  const dwlrTiles = byType.dwlr.map((r) => ({
    hardware_id: r.hardware_id,
    label: 'DWLR',
    value: pickValue(r.values, ['LEVEL', 'LVL', 'level', 'WATER_LEVEL'], '—'),
    unit: 'mWC',
    status: 'active',
    location: locationByHw[r.hardware_id] || null,
    meta: r.manual_water_temp_c != null
      ? `${Number(r.manual_water_temp_c).toFixed(1)}°C`
      : (r.values?.WTEMP && Number(r.values.WTEMP) > 0 ? `${Number(r.values.WTEMP).toFixed(1)}°C`
         : (r.values?.BATTERY ? `Battery ${r.values.BATTERY}%`
            : (r.values?.BVOLT ? `${Number(r.values.BVOLT).toFixed(2)}V` : null))),
  }));
  if (dwlrTiles.length === 0) dwlrTiles.push({ hardware_id: '', label: 'DWLR', value: null, unit: 'mWC', status: 'inactive' });

  return (
    <div className={`min-h-screen ${bg} transition-colors duration-300`} data-testid="dashboard-page">
      <header className={`shadow-md ${isDarkMode ? 'bg-gray-800' : 'bg-[#1a2332]'}`}>
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-white font-bold text-xl tracking-wide" style={{ color: '#4a9fd8' }}>ENVIROLYTICS</h1>
            <p className="text-white text-[8px] tracking-wider" style={{ opacity: 0.7 }}>SUSTAINABILITY PRIVATE LIMITED</p>
          </div>
          <div className="flex items-center gap-4">
            {telemetrySources.mqtt?.has_devices && (
              <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${mqttStatus.connected ? 'bg-green-600' : 'bg-red-600'}`} data-testid="dashboard-mqtt-badge">
                <Activity className="h-3 w-3 text-white" />
                <span className="text-xs text-white font-medium">MQTT {mqttStatus.connected ? 'LIVE' : 'OFFLINE'}</span>
              </div>
            )}
            {telemetrySources.http?.has_devices && (
              <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${telemetrySources.http?.connected ? 'bg-green-600' : 'bg-red-600'}`} data-testid="dashboard-http-badge">
                <Activity className="h-3 w-3 text-white" />
                <span className="text-xs text-white font-medium">HTTP {telemetrySources.http?.connected ? 'LIVE' : 'OFFLINE'}</span>
              </div>
            )}
            {isAdmin() && <span className="text-xs px-2 py-1 bg-purple-600 text-white rounded">ADMIN</span>}
            <Button
              onClick={handleSelfTestAlert}
              disabled={sendingSelfTest}
              variant="outline"
              size="sm"
              className="border-white text-white hover:text-white hidden sm:inline-flex"
              title="Send a test offline-alert email to your login email + your admin-configured recipients"
              data-testid="dashboard-self-test-alert-btn"
            >
              <Send className="mr-1 h-3.5 w-3.5" />
              {sendingSelfTest ? 'Sending…' : 'Test alert'}
            </Button>
            <Button onClick={toggleTheme} variant="outline" size="sm" className="border-white text-white hover:text-white" data-testid="dashboard-theme-toggle">
              {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <div className="text-white text-sm">
              <p className="font-medium">{user.fullName}</p>
              <p className="text-gray-300 text-xs">{user.username}</p>
            </div>
            <Button onClick={() => { mockLogout(); navigate('/'); }} variant="outline" className="border-white text-white hover:text-white" style={{ backgroundColor: '#f5a623', borderColor: '#f5a623' }} data-testid="dashboard-logout-btn">
              <LogOut className="mr-2 h-4 w-4" />Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-6">
        {/* Hero / executive summary — government-grade presentation */}
        <section
          className={`relative overflow-hidden rounded-2xl border ${
            isDarkMode ? 'border-gray-700 bg-gradient-to-br from-[#1a2332] via-[#1e3a5f] to-[#1a2332]'
                       : 'border-blue-100 bg-gradient-to-br from-white via-blue-50 to-cyan-50'
          }`}
          data-testid="dashboard-hero"
        >
          {/* faint grid texture */}
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.06] pointer-events-none"
            style={{
              backgroundImage:
                'linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)',
              backgroundSize: '40px 40px',
            }}
          />
          <div className="relative p-6 md:p-8 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="space-y-1">
              <p className={`text-[10px] tracking-[0.28em] font-semibold ${
                isDarkMode ? 'text-cyan-300' : 'text-cyan-700'
              }`}>
                CENTRAL / STATE POLLUTION CONTROL BOARD · CENTRAL GROUND WATER AUTHORITY · STATE GROUND WATER AUTHORITY COMPLIANT
              </p>
              <h2 className={`text-2xl md:text-3xl lg:text-4xl font-bold leading-tight ${text}`}>
                Envirolytics Monitoring Console
              </h2>
              <p className={`text-sm ${muted}`}>
                Real-time IoT telemetry for groundwater abstraction, STP discharge, water quality &amp; rainfall recharge.
              </p>
              <p className={`text-xs ${muted}`}>
                Logged in as <span className="font-semibold">{user.fullName}</span> ·
                {' '}{new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:min-w-[480px]">
              <div className={`rounded-xl p-3 ring-1 ${isDarkMode ? 'bg-white/5 ring-white/10' : 'bg-white ring-blue-100'}`} data-testid="hero-stat-flowmeters">
                <p className={`text-[10px] uppercase tracking-widest ${muted}`}>Flowmeters</p>
                <p className={`text-2xl font-bold tabular-nums ${text}`} data-numeric="true">{aggList.length}</p>
              </div>
              <div className={`rounded-xl p-3 ring-1 ${isDarkMode ? 'bg-white/5 ring-white/10' : 'bg-white ring-blue-100'}`} data-testid="hero-stat-dwlr">
                <p className={`text-[10px] uppercase tracking-widest ${muted}`}>DWLRs</p>
                <p className={`text-2xl font-bold tabular-nums ${text}`} data-numeric="true">{byType.dwlr.length}</p>
              </div>
              <div className={`rounded-xl p-3 ring-1 ${isDarkMode ? 'bg-white/5 ring-white/10' : 'bg-white ring-blue-100'}`} data-testid="hero-stat-mqtt">
                <p className={`text-[10px] uppercase tracking-widest ${muted}`}>Stream</p>
                <p className={`text-2xl font-bold tracking-wider ${mqttStatus.connected ? 'text-emerald-500' : 'text-red-500'}`}>
                  {mqttStatus.connected ? 'LIVE' : 'OFFLINE'}
                </p>
              </div>
              <div className={`rounded-xl p-3 ring-1 ${isDarkMode ? 'bg-white/5 ring-white/10' : 'bg-white ring-blue-100'}`} data-testid="hero-stat-time">
                <p className={`text-[10px] uppercase tracking-widest ${muted}`}>Server time</p>
                <p className={`text-2xl font-bold tabular-nums ${text}`} data-numeric="true">
                  {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          </div>
        </section>

        <WeatherCard weather={weather} loading={loadingWeather} isDarkMode={isDarkMode} getWaterFlowDirection={() => '—'} />

        <OfflineAlertsBanner isDarkMode={isDarkMode} />

        {isAdmin() && <NotificationRecipientsCard isDarkMode={isDarkMode} />}

        {/* Instrument Location Map — scoped to current user's instruments */}
        <Card className={isDarkMode ? 'bg-gray-800 border-gray-700' : ''} data-testid="dashboard-map-card">
          <CardHeader>
            <CardTitle className={`flex items-center gap-2 ${text}`}>
              <MapPin className="h-5 w-5" /> Instrument Locations
              <span className={`ml-2 text-sm font-normal ${muted}`}>({locations.length} instrument{locations.length === 1 ? '' : 's'})</span>
            </CardTitle>
            <CardDescription className={muted}>
              Showing only the coordinates of instruments assigned to {isAdmin() ? 'all users' : 'you'}. Click a marker for details — colours indicate the instrument type (see legend below).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Admins get the office coordinates as the default center for reference;
                clients get the geographic centre of India (only visible if they have
                zero instruments with coords — otherwise the map auto-fits to pins). */}
            <LocationMap
              locations={locations}
              center={isAdmin() ? [26.8521723, 81.0073433] : [22.9734, 78.6569]}
              zoom={isAdmin() ? 12 : 6}
            />
          </CardContent>
        </Card>

        {/* === WATER ABSTRACTION === */}
        <Card className={`border-t-4 ${isDarkMode ? 'bg-gray-800 border-gray-700' : ''}`} style={{ borderTopColor: '#4a9fd8' }} data-testid="section-water-abstraction">
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg" style={{ backgroundColor: '#4a9fd8' }}><Droplets className="h-5 w-5 text-white" /></div>
                <div>
                  <CardTitle className={text}>Ground Water — Volumetric Water Abstraction</CardTitle>
                  <CardDescription className={muted}>Borewell flowmeter(s) measuring groundwater draw · flow in m³/hr · totaliser in KL</CardDescription>
                </div>
              </div>
              <Badge className={groundwater.some((a) => a.flow_rate_m3h > 0) ? 'bg-green-500' : 'bg-gray-400'}>{groundwater.length} device{groundwater.length === 1 ? '' : 's'}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {groundwater.length === 0 ? (
              <p className={`text-center py-6 text-sm ${muted}`}>No groundwater flowmeter registered. Use <code className="bg-gray-100 px-1 rounded">PUT /api/flowmeter-mgmt/{'{hardware_id}'}/category</code> with <code>groundwater_abstraction</code>.</p>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {groundwater.map((a) => (
                  <FlowmeterTile key={a.hardware_id} agg={a} isDarkMode={isDarkMode} color="#4a9fd8" onClick={() => navigate('/flowmeter')} location={locationByHw[a.hardware_id]} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* === WATER LEVEL === */}
        <InstrumentSection
          title="Water Level"
          subtitle="DWLR — Digital Water Level Recorder (groundwater table)"
          color="#27ae60"
          icon={TrendingUp}
          tiles={dwlrTiles}
          emptyText="No DWLR live"
          isDarkMode={isDarkMode}
          testId="section-water-level"
        />

        {/* === BOREWELL WATER QUALITY === */}
        <Card className={`border-t-4 ${isDarkMode ? 'bg-gray-800 border-gray-700' : ''}`} style={{ borderTopColor: '#8e44ad' }} data-testid="section-water-quality">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg" style={{ backgroundColor: '#8e44ad' }}><FlaskConical className="h-5 w-5 text-white" /></div>
              <div>
                <CardTitle className={text}>Borewell Water Quality</CardTitle>
                <CardDescription className={muted}>pH, Conductivity, TDS sensors on the borewell supply</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Quality sensor tiles */}
            <div>
              <h3 className={`text-sm font-semibold mb-2 ${text}`}>Quality parameters</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {qualityTiles.map((t) => (
                  <div
                    key={`${t.label}-${t.hardware_id || 'pending'}`}
                    data-testid={`tile-${t.label.toLowerCase()}-${t.hardware_id || 'pending'}`}
                    className={`p-3 rounded-lg border-2 ${isDarkMode ? 'bg-gray-700' : 'bg-gray-50'}`}
                    style={{ borderColor: t.status === 'active' ? '#10b981' : '#cbd5e1' }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-sm font-semibold ${text}`}>{t.label}</span>
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: t.status === 'active' ? '#10b981' : '#94a3b8' }} />
                    </div>
                    <p className="text-2xl font-bold" style={{ color: '#8e44ad' }}>
                      {t.value != null ? t.value : '—'}
                      {t.unit && <span className="text-base ml-1 text-gray-500">{t.unit}</span>}
                    </p>
                    <p className={`text-xs ${muted}`}>{t.hardware_id ? t.hardware_id : 'No device'}{t.meta ? ` · ${t.meta}` : ''}</p>
                  </div>
                ))}
              </div>
            </div>
            {/* STP Flowmeters block moved to the Water Quality tab (/water-quality). */}
          </CardContent>
        </Card>

        {/* === STP EFFLUENT (compact live tile row) — full visuals live in /water-quality === */}
        <Card
          className={`border-t-4 ${isDarkMode ? 'bg-gray-800 border-gray-700' : ''} cursor-pointer hover:shadow-md transition-shadow`}
          style={{ borderTopColor: '#c2410c' }}
          data-testid="section-stp-effluent"
          onClick={() => navigate('/water-quality')}
        >
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg" style={{ backgroundColor: '#c2410c' }}>
                <Factory className="h-5 w-5 text-white" />
              </div>
              <div>
                <CardTitle className={text}>Sewerage Treatment Plant water quality parameter</CardTitle>
                <CardDescription className={muted}>
                  Live COD / BOD / TSS / pH per STP device — click for full SCADA view
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {stpDevices.length === 0 ? (
              <p className={`text-xs italic ${muted}`} data-testid="stp-tiles-empty">No STP device configured.</p>
            ) : (
              <div className="space-y-4">
                {stpDevices.map((d) => {
                  const v = d.values || {};
                  const reg = d._registry || {};
                  const stale = timeSince(d.received_at);
                  const params = [
                    { k: 'PH',  label: 'pH',  val: v.PH,  unit: '',      color: '#3730a3' },
                    { k: 'TSS', label: 'TSS', val: v.TSS, unit: 'mg/L',  color: '#c2410c' },
                    { k: 'BOD', label: 'BOD', val: v.BOD, unit: 'mg/L',  color: '#166534' },
                    { k: 'COD', label: 'COD', val: v.COD, unit: 'mg/L',  color: '#a16207' },
                  ];
                  return (
                    <div key={d.hardware_id} data-testid={`stp-tile-row-${d.hardware_id}`}>
                      <div className={`text-xs font-semibold mb-1.5 ${text} flex items-center gap-2 flex-wrap`}>
                        <span>
                          {reg.label || d.hardware_id}
                          {reg.plant_capacity_kld != null && (
                            <span className={`ml-2 text-[10px] font-mono ${muted}`}>· {reg.plant_capacity_kld} KLD</span>
                          )}
                        </span>
                        <span
                          className="text-[10px] font-medium px-1.5 py-0.5 rounded-full text-white flex items-center gap-1"
                          style={{ backgroundColor: stale.color }}
                          data-testid={`stp-stale-${d.hardware_id}`}
                          title={d.received_at ? `Last reading: ${new Date(d.received_at).toLocaleString('en-IN', { hour12: false })}` : 'No reading received yet'}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-white opacity-90" />
                          {stale.label}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {params.map((p) => (
                          <div
                            key={p.k}
                            className={`p-2.5 rounded border-2 ${isDarkMode ? 'bg-gray-900' : 'bg-gray-50'}`}
                            style={{ borderColor: p.val != null ? p.color : '#cbd5e1' }}
                            data-testid={`stp-tile-${d.hardware_id}-${p.k}`}
                          >
                            <p className={`text-[10px] uppercase tracking-wide font-semibold ${muted}`}>{p.label}</p>
                            <p className="text-xl font-bold tabular-nums" style={{ color: p.color }}>
                              {p.val != null ? Number(p.val).toFixed(p.k === 'PH' ? 1 : 0) : '—'}
                              {p.unit && <span className="text-[10px] ml-1 opacity-70">{p.unit}</span>}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* === DO METER — AERATION TANK (compact live tile row) === */}
        <Card
          className={`border-t-4 ${isDarkMode ? 'bg-gray-800 border-gray-700' : ''} cursor-pointer hover:shadow-md transition-shadow`}
          style={{ borderTopColor: '#0284c7' }}
          data-testid="section-do-meter"
          onClick={() => navigate('/water-quality')}
        >
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg" style={{ backgroundColor: '#0284c7' }}>
                <Wind className="h-5 w-5 text-white" />
              </div>
              <div>
                <CardTitle className={text}>DO Analyzer (Aeration Tank) parameter</CardTitle>
                <CardDescription className={muted}>
                  Live Dissolved Oxygen readings per aeration tank — click for animated view
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {doDevices.length === 0 ? (
              <p className={`text-xs italic ${muted}`} data-testid="do-tiles-empty">No DO analyzer configured.</p>
            ) : (
              <div className="space-y-4">
                {doDevices.map((d) => {
                  const v = d.values || {};
                  const reg = d._registry || {};
                  const stale = timeSince(d.received_at);
                  const tanks = [
                    { n: 1, val: v.DO_TANK_1, cap: reg.do_tank_config?.tank_1_kld },
                    { n: 2, val: v.DO_TANK_2, cap: reg.do_tank_config?.tank_2_kld },
                  ];
                  return (
                    <div key={d.hardware_id} data-testid={`do-tile-row-${d.hardware_id}`}>
                      <div className={`text-xs font-semibold mb-1.5 ${text} flex items-center gap-2 flex-wrap`}>
                        <span>{reg.label || d.hardware_id}</span>
                        <span
                          className="text-[10px] font-medium px-1.5 py-0.5 rounded-full text-white flex items-center gap-1"
                          style={{ backgroundColor: stale.color }}
                          data-testid={`do-stale-${d.hardware_id}`}
                          title={d.received_at ? `Last reading: ${new Date(d.received_at).toLocaleString('en-IN', { hour12: false })}` : 'No reading received yet'}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-white opacity-90" />
                          {stale.label}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {tanks.map((t) => {
                          const alarm = t.val != null && (t.val < 2 || t.val > 8);
                          const active = t.val != null && !alarm;
                          const borderColor = alarm ? '#dc2626' : (active ? '#0284c7' : '#cbd5e1');
                          return (
                            <div
                              key={t.n}
                              className={`p-3 rounded border-2 ${isDarkMode ? 'bg-gray-900' : 'bg-gray-50'} flex items-center justify-between`}
                              style={{ borderColor }}
                              data-testid={`do-tile-${d.hardware_id}-tank${t.n}`}
                            >
                              <div>
                                <p className={`text-[10px] uppercase tracking-wide font-semibold ${muted}`}>Tank {t.n} DO</p>
                                <p className="text-2xl font-bold tabular-nums" style={{ color: borderColor }}>
                                  {t.val != null ? Number(t.val).toFixed(2) : '—'}
                                  <span className="text-[10px] ml-1 opacity-70">mg/L</span>
                                </p>
                              </div>
                              {t.cap != null && (
                                <div className={`text-right ${muted}`}>
                                  <p className="text-[9px] uppercase tracking-wide">Capacity</p>
                                  <p className="text-sm font-mono font-bold">{t.cap} <span className="text-[9px]">KLD</span></p>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick instrument link grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { to: '/flowmeter', label: 'Flowmeter', icon: Droplets, color: '#4a9fd8' },
            { to: '/dwlr', label: 'DWLR', icon: TrendingUp, color: '#27ae60' },
            { to: '/ph', label: 'pH', icon: FlaskConical, color: '#8e44ad' },
            { to: '/conductivity', label: 'Conductivity', icon: Activity, color: '#2980b9' },
            { to: '/tds', label: 'TDS', icon: Droplets, color: '#16a085' },
            { to: '/certificates', label: 'Certificates', icon: MapPin, color: '#f5a623' },
          ].map((q) => {
            const Icon = q.icon;
            return (
              <button
                key={q.to}
                onClick={() => navigate(q.to)}
                data-testid={`quicklink-${q.label.toLowerCase()}`}
                className={`p-4 rounded-lg border-2 hover:shadow-md transition-shadow text-left ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}
              >
                <div className="p-2 rounded inline-block mb-2" style={{ backgroundColor: q.color }}>
                  <Icon className="h-4 w-4 text-white" />
                </div>
                <p className={`text-sm font-semibold ${text}`}>{q.label}</p>
                <p className={`text-xs ${muted}`}>View details →</p>
              </button>
            );
          })}
        </div>

        {!mqttStatus.connected && (
          <Card className="border-amber-300 bg-amber-50">
            <CardContent className="py-4 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 shrink-0" />
              <p className="text-sm text-amber-800">
                <strong>MQTT broker offline.</strong> Activate HiveMQ Cloud credentials per <code>/app/IOT_DEVICE_CONFIGURATION_GUIDE.md</code>,
                or use <code className="bg-amber-100 px-1 rounded">POST /api/flowmeter-mgmt/ingest</code> /
                <code className="bg-amber-100 px-1 rounded">POST /api/instruments/ingest</code> to push demo readings.
              </p>
            </CardContent>
          </Card>
        )}
      </main>

      <footer className={`mt-12 py-4 ${isDarkMode ? 'bg-gray-800' : 'bg-[#1a2332]'}`}>
        <div className="container mx-auto px-4 text-center text-white text-sm">
          <p>© 2026 Envirolytics Sustainability Private Limited. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default EnhancedDashboard;
