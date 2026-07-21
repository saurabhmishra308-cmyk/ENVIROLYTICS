import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentUser, isAuthenticated, mockLogout, isAdmin } from '../mockData';
import api from '../lib/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { useTheme } from '../contexts/ThemeContext';
import { LogOut, Sun, Moon, Droplets, TrendingUp, Activity, MapPin, FlaskConical, AlertCircle, Factory } from 'lucide-react';
import axios from 'axios';

import WeatherCard from '../components/WeatherCard';
import InstrumentSection from '../components/InstrumentSection';
import LockedSectionOverlay from '../components/LockedSectionOverlay';
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

const FlowmeterTile = ({ agg, isDarkMode, color, onClick }) => {
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
  const [locations, setLocations] = useState([]);

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
    } catch (e) { logError(e, 'fetchLive'); }
  }, []);

  const fetchLocations = useCallback(async () => {
    try {
      const { data } = await api.get('/api/admin/users/locations');
      setLocations(data.locations || []);
    } catch (e) { logError(e, 'locations'); }
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) { navigate('/'); return; }
    setUser(getCurrentUser());
    fetchWeather();
    fetchLive();
    fetchLocations();
    const t = setInterval(fetchLive, POLL_MS);
    // Refresh weather every 5 minutes so the "Live Weather Data" card stays current
    const tw = setInterval(fetchWeather, 5 * 60 * 1000);
    return () => { clearInterval(t); clearInterval(tw); };
  }, [navigate, fetchWeather, fetchLive, fetchLocations]);

  if (!user) return null;

  const bg = isDarkMode ? 'bg-gray-900' : 'bg-gray-50';
  const text = isDarkMode ? 'text-white' : 'text-gray-900';
  const muted = isDarkMode ? 'text-gray-400' : 'text-gray-600';

  // Group flowmeters by category
  const aggList = Object.values(aggregates);
  const groundwater = aggList.filter((a) => (a.category || 'groundwater_abstraction') === 'groundwater_abstraction');
  const stpInlet = aggList.filter((a) => a.category === 'stp_inlet');
  const stpOutlet = aggList.filter((a) => a.category === 'stp_outlet');
  const hasStp = stpInlet.length + stpOutlet.length > 0;
  const admin = isAdmin();

  // Build water-quality tiles (pH, Conductivity, TDS)
  const qualityTiles = [];
  byType.ph.forEach((r) => qualityTiles.push({ hardware_id: r.hardware_id, label: 'pH', value: pickValue(r.values, ['PH', 'ph'], '—'), unit: '', status: 'active', meta: r.values?.TEMPER != null ? `${r.values.TEMPER}°C` : null }));
  if (byType.ph.length === 0) qualityTiles.push({ hardware_id: '', label: 'pH', value: null, unit: '', status: 'inactive' });
  byType.conductivity.forEach((r) => qualityTiles.push({ hardware_id: r.hardware_id, label: 'Conductivity', value: pickValue(r.values, ['CONDUCTIVITY', 'conductivity'], '—'), unit: 'µS/cm', status: 'active' }));
  if (byType.conductivity.length === 0) qualityTiles.push({ hardware_id: '', label: 'Conductivity', value: null, unit: 'µS/cm', status: 'inactive' });
  byType.tds.forEach((r) => qualityTiles.push({ hardware_id: r.hardware_id, label: 'TDS', value: pickValue(r.values, ['TDS', 'tds'], '—'), unit: 'ppm', status: 'active' }));
  if (byType.tds.length === 0) qualityTiles.push({ hardware_id: '', label: 'TDS', value: null, unit: 'ppm', status: 'inactive' });

  // If the user owns NONE of the water-quality sensor types (or dometer/water_quality),
  // we consider the whole section "not installed" and show a locked overlay.
  const hasWaterQuality =
    byType.ph.length +
    byType.tds.length +
    byType.conductivity.length +
    (byType.dometer?.length || 0) +
    (byType.water_quality?.length || 0) > 0;

  const dwlrTiles = byType.dwlr.map((r) => ({
    hardware_id: r.hardware_id,
    label: 'DWLR',
    value: pickValue(r.values, ['LEVEL', 'level', 'WATER_LEVEL'], '—'),
    unit: 'm',
    status: 'active',
    meta: r.values?.BATTERY ? `Battery ${r.values.BATTERY}%` : null,
  }));
  const hasDwlr = dwlrTiles.length > 0;
  if (!hasDwlr) dwlrTiles.push({ hardware_id: '', label: 'DWLR', value: null, unit: 'm', status: 'inactive' });

  return (
    <div className={`min-h-screen ${bg} transition-colors duration-300`} data-testid="dashboard-page">
      <header className={`shadow-md ${isDarkMode ? 'bg-gray-800' : 'bg-[#1a2332]'}`}>
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-white font-bold text-xl tracking-wide" style={{ color: '#4a9fd8' }}>ENVIROLYTICS</h1>
            <p className="text-white text-[8px] tracking-wider" style={{ opacity: 0.7 }}>SUSTAINABILITY PRIVATE LIMITED</p>
          </div>
          <div className="flex items-center gap-4">
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${mqttStatus.connected ? 'bg-green-600' : 'bg-red-600'}`} data-testid="dashboard-mqtt-badge">
              <Activity className="h-3 w-3 text-white" />
              <span className="text-xs text-white font-medium">MQTT {mqttStatus.connected ? 'LIVE' : 'OFFLINE'}</span>
            </div>
            {isAdmin() && <span className="text-xs px-2 py-1 bg-purple-600 text-white rounded">ADMIN</span>}
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
                CENTRAL / STATE POLLUTION CONTROL BOARD · CENTRAL GROUND WATER AUTHORITY · STATE GROUND WATER AUTHORITY
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

        {/* Client Location Map */}
        <Card className={isDarkMode ? 'bg-gray-800 border-gray-700' : ''} data-testid="dashboard-map-card">
          <CardHeader>
            <CardTitle className={`flex items-center gap-2 ${text}`}>
              <MapPin className="h-5 w-5" /> Client Locations
              <span className={`ml-2 text-sm font-normal ${muted}`}>({locations.length} pin{locations.length === 1 ? '' : 's'})</span>
            </CardTitle>
            <CardDescription className={muted}>Toggle between Satellite and Streets in the top-right. Click a pin for coordinates.</CardDescription>
          </CardHeader>
          <CardContent>
            <LocationMap locations={locations} />
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
              admin ? (
                <p className={`text-sm italic ${muted}`} data-testid="groundwater-empty-admin">
                  No groundwater flowmeters registered yet. Add one from the Instruments page.
                </p>
              ) : (
                <LockedSectionOverlay
                  instrumentType="flowmeter"
                  readableType="Groundwater Flowmeter"
                  isDarkMode={isDarkMode}
                />
              )
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {groundwater.map((a) => (
                  <FlowmeterTile key={a.hardware_id} agg={a} isDarkMode={isDarkMode} color="#4a9fd8" onClick={() => navigate('/flowmeter')} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* === WATER LEVEL === */}
        {hasDwlr ? (
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
        ) : (
          <Card className={`border-t-4 ${isDarkMode ? 'bg-gray-800 border-gray-700' : ''}`} style={{ borderTopColor: '#27ae60' }} data-testid="section-water-level">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg" style={{ backgroundColor: '#27ae60' }}><TrendingUp className="h-5 w-5 text-white" /></div>
                <div>
                  <CardTitle className={text}>Water Level</CardTitle>
                  <CardDescription className={muted}>DWLR — Digital Water Level Recorder (groundwater table)</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {admin ? (
                <p className={`text-sm italic ${muted}`} data-testid="dwlr-empty-admin">
                  No DWLR devices registered yet. Add one from the Instruments page.
                </p>
              ) : (
                <LockedSectionOverlay
                  instrumentType="dwlr"
                  readableType="DWLR (Water Level Recorder)"
                  isDarkMode={isDarkMode}
                />
              )}
            </CardContent>
          </Card>
        )}

        {/* === WATER QUALITY === */}
        <Card className={`border-t-4 ${isDarkMode ? 'bg-gray-800 border-gray-700' : ''}`} style={{ borderTopColor: '#8e44ad' }} data-testid="section-water-quality">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg" style={{ backgroundColor: '#8e44ad' }}><FlaskConical className="h-5 w-5 text-white" /></div>
              <div>
                <CardTitle className={text}>Water Quality</CardTitle>
                <CardDescription className={muted}>pH, Conductivity, TDS sensors + STP Inlet / Outlet flowmeters</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Quality sensor tiles */}
            <div>
              <h3 className={`text-sm font-semibold mb-2 ${text}`}>Quality parameters</h3>
              {!hasWaterQuality && !admin ? (
                <LockedSectionOverlay
                  instrumentType="water_quality"
                  readableType="Water Quality Suite (pH / DO / BOD / COD / TSS / Cl)"
                  isDarkMode={isDarkMode}
                />
              ) : !hasWaterQuality && admin ? (
                <p className={`text-sm italic ${muted}`} data-testid="water-quality-empty-admin">
                  No water-quality sensors registered yet. Add one from the Instruments page.
                </p>
              ) : (
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
              )}
            </div>

            {/* STP Flowmeters */}
            <div>
              <h3 className={`text-sm font-semibold mb-2 flex items-center gap-2 ${text}`}>
                <Factory className="h-4 w-4" /> STP Flowmeters — inlet &amp; outlet (m³/hr, totaliser in KL)
              </h3>
              {!hasStp && !admin ? (
                <LockedSectionOverlay
                  instrumentType="stp_flowmeter"
                  readableType="STP Flowmeters (Inlet / Outlet)"
                  isDarkMode={isDarkMode}
                />
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div>
                    <p className={`text-xs uppercase tracking-wide mb-2 ${muted}`}>STP Inlet</p>
                    {stpInlet.length === 0 ? (
                      <p className={`text-xs italic ${muted}`}>No STP inlet flowmeter registered.</p>
                    ) : stpInlet.map((a) => (
                      <FlowmeterTile key={a.hardware_id} agg={a} isDarkMode={isDarkMode} color="#16a085" onClick={() => navigate('/flowmeter')} />
                    ))}
                  </div>
                  <div>
                    <p className={`text-xs uppercase tracking-wide mb-2 ${muted}`}>STP Outlet</p>
                    {stpOutlet.length === 0 ? (
                      <p className={`text-xs italic ${muted}`}>No STP outlet flowmeter registered.</p>
                    ) : stpOutlet.map((a) => (
                      <FlowmeterTile key={a.hardware_id} agg={a} isDarkMode={isDarkMode} color="#d35400" onClick={() => navigate('/flowmeter')} />
                    ))}
                  </div>
                </div>
              )}
            </div>
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
