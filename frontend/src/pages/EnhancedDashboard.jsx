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
import RwhRechargeTile from '../components/RwhRechargeTile';
import LocationMap from '../components/LocationMap';
import OfflineAlertsBanner from '../components/OfflineAlertsBanner';
import NotificationRecipientsCard from '../components/NotificationRecipientsCard';
import { cleanLabel } from '../utils/labels';

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
          <p className={`font-bold ${text}`}>{cleanLabel(agg.label || agg.hardware_id)}</p>
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
      const [fmRes, instrRes, statusRes, catRes, regRes] = await Promise.all([
        api.get('/api/flowmeter/latest'),
        api.get('/api/instruments/all/latest'),
        api.get('/api/flowmeter/status'),
        api.get('/api/flowmeter-mgmt/categories'),
        api.get('/api/instrument-registry'),
      ]);

      const latestFlowmeters = fmRes.data.flowmeters || [];
      const registered = regRes.data.instruments || regRes.data.items || [];
      const registeredFlowmeters = registered.filter((r) => r.instrument_type === 'flowmeter' && r.hardware_id);
      const cats = catRes.data.categories || [];
      setCategories(cats);

      const deviceById = new Map();
      registeredFlowmeters.forEach((r) => {
        deviceById.set(r.hardware_id, { hardware_id: r.hardware_id, label: r.label || r.hardware_id });
      });
      latestFlowmeters.forEach((r) => {
        if (r.hardware_id && !deviceById.has(r.hardware_id)) deviceById.set(r.hardware_id, r);
      });
      cats.forEach((c) => {
        if (c.hardware_id && !deviceById.has(c.hardware_id)) {
          deviceById.set(c.hardware_id, { hardware_id: c.hardware_id, label: c.label || c.hardware_id });
        }
      });

      const aggs = await Promise.all(
        [...deviceById.keys()].map((hardwareId) =>
          api.get(`/api/flowmeter-mgmt/${encodeURIComponent(hardwareId)}/aggregate`)
            .then((r) => r.data)
            .catch(() => ({
              hardware_id: hardwareId,
              category: null,
              label: deviceById.get(hardwareId)?.label || hardwareId,
              flow_rate_m3h: 0,
              totaliser_forward_kl: 0,
              consumption_kl: { hourly: 0, weekly: 0, monthly: 0, yearly: 0 },
            }))
        )
      );

      const categoryByHw = Object.fromEntries(cats.map((c) => [c.hardware_id, c.category]));
      const aggMap = {};
      aggs.forEach((a) => {
        if (!a?.hardware_id) return;
        aggMap[a.hardware_id] = {
          ...a,
          category: a.category || categoryByHw[a.hardware_id] || 'groundwater_abstraction',
          label: a.label || deviceById.get(a.hardware_id)?.label || a.hardware_id,
        };
      });
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
      const { data } = await api.get('/api/instrument-registry');
      const rows = data.instruments || data.items || [];
      const mapped = rows
        .filter((it) => it.latitude != null && it.longitude != null)
        .map((it) => ({
          hardware_id: it.hardware_id,
          instrument_type: it.instrument_type,
          label: cleanLabel(it.label || it.hardware_id),
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
      {/* existing JSX below this point */}
    </div>
  );
};

export default EnhancedDashboard;
