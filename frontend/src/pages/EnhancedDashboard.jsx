import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentUser, isAuthenticated, mockLogout, isAdmin } from '../mockData';
import api from '../lib/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { useTheme } from '../contexts/ThemeContext';
import { LogOut, Sun, Moon, Droplets, TrendingUp, Activity, MapPin, FlaskConical, AlertCircle } from 'lucide-react';
import axios from 'axios';

import WeatherCard from '../components/WeatherCard';
import InstrumentSection from '../components/InstrumentSection';
import LocationMap from '../components/LocationMap';

const POLL_MS = 5000;
const logError = (error, context) => {
  if (process.env.NODE_ENV === 'development') {
    // eslint-disable-next-line no-console
    console.error(`Error in ${context}:`, error);
  }
};

// Display helpers — pull common field names that any device might use.
const pickValue = (values, keys, fallback = null) => {
  if (!values) return fallback;
  for (const k of keys) {
    if (values[k] != null) return values[k];
  }
  return fallback;
};

const EnhancedDashboard = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const { isDarkMode, toggleTheme } = useTheme();

  const [weather, setWeather] = useState(null);
  const [loadingWeather, setLoadingWeather] = useState(true);
  const [flowmeters, setFlowmeters] = useState([]);
  const [byType, setByType] = useState({ dwlr: [], ph: [], tds: [], conductivity: [] });
  const [mqttStatus, setMqttStatus] = useState({ connected: false });
  const [locations, setLocations] = useState([]);

  const LATITUDE = useMemo(() => 26.8467, []);
  const LONGITUDE = useMemo(() => 80.9462, []);
  const WEATHER_API_KEY = useMemo(() => process.env.REACT_APP_WEATHER_API_KEY, []);

  const fetchWeather = useCallback(async () => {
    if (!WEATHER_API_KEY) { setLoadingWeather(false); return; }
    try {
      const r = await axios.get(
        `https://api.openweathermap.org/data/2.5/weather?lat=${LATITUDE}&lon=${LONGITUDE}&appid=${WEATHER_API_KEY}&units=metric`
      );
      setWeather(r.data);
    } catch (e) { logError(e, 'weather'); }
    finally { setLoadingWeather(false); }
  }, [LATITUDE, LONGITUDE, WEATHER_API_KEY]);

  const fetchLive = useCallback(async () => {
    try {
      const [fmRes, instrRes, statusRes] = await Promise.all([
        api.get('/api/flowmeter/latest'),
        api.get('/api/instruments/all/latest'),
        api.get('/api/flowmeter/status'),
      ]);
      setFlowmeters(fmRes.data.flowmeters || []);
      const grouped = instrRes.data.by_type || {};
      setByType({
        dwlr: grouped.dwlr || [],
        ph: grouped.ph || [],
        tds: grouped.tds || [],
        conductivity: grouped.conductivity || [],
      });
      setMqttStatus(statusRes.data || { connected: false });
    } catch (e) {
      logError(e, 'fetchLive');
    }
  }, []);

  const fetchLocations = useCallback(async () => {
    try {
      const { data } = await api.get('/api/admin/users/locations');
      setLocations(data.locations || []);
    } catch (e) {
      logError(e, 'fetchLocations');
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) { navigate('/'); return; }
    setUser(getCurrentUser());
    fetchWeather();
    fetchLive();
    fetchLocations();
    const t = setInterval(fetchLive, POLL_MS);
    return () => clearInterval(t);
  }, [navigate, fetchWeather, fetchLive, fetchLocations]);

  const handleLogout = useCallback(() => { mockLogout(); navigate('/'); }, [navigate]);

  if (!user) return null;

  const bgColor = isDarkMode ? 'bg-gray-900' : 'bg-gray-50';
  const textColor = isDarkMode ? 'text-white' : 'text-gray-900';
  const textMuted = isDarkMode ? 'text-gray-400' : 'text-gray-600';

  // ====== Build segmented tiles ======
  const flowTiles = flowmeters.map((fm) => ({
    hardware_id: fm.hardware_id,
    label: 'Flowmeter',
    value: Number(fm.flow_rate_lpm || 0).toFixed(2),
    unit: 'L/min',
    status: 'active',
    meta: `${Number(fm.forward_totalizer || 0).toFixed(0)} ${fm.unit_name || 'L'} total`,
  }));
  if (flowTiles.length === 0) {
    flowTiles.push({ hardware_id: '', label: 'Flowmeter', value: null, unit: 'L/min', status: 'inactive' });
  }

  const dwlrTiles = byType.dwlr.map((r) => ({
    hardware_id: r.hardware_id,
    label: 'DWLR',
    value: pickValue(r.values, ['LEVEL', 'level', 'WATER_LEVEL'], '—'),
    unit: 'm',
    status: 'active',
    meta: r.values?.BATTERY ? `Battery ${r.values.BATTERY}%` : null,
  }));
  if (dwlrTiles.length === 0) {
    dwlrTiles.push({ hardware_id: '', label: 'DWLR', value: null, unit: 'm', status: 'inactive' });
  }

  const phTiles = byType.ph.map((r) => ({
    hardware_id: r.hardware_id,
    label: 'pH',
    value: pickValue(r.values, ['PH', 'ph'], '—'),
    unit: '',
    status: 'active',
    meta: r.values?.TEMPER != null ? `${r.values.TEMPER}°C` : null,
  }));
  if (phTiles.length === 0) phTiles.push({ hardware_id: '', label: 'pH', value: null, unit: '', status: 'inactive' });

  const condTiles = byType.conductivity.map((r) => ({
    hardware_id: r.hardware_id,
    label: 'Conductivity',
    value: pickValue(r.values, ['CONDUCTIVITY', 'conductivity'], '—'),
    unit: 'µS/cm',
    status: 'active',
  }));
  if (condTiles.length === 0) condTiles.push({ hardware_id: '', label: 'Conductivity', value: null, unit: 'µS/cm', status: 'inactive' });

  const tdsTiles = byType.tds.map((r) => ({
    hardware_id: r.hardware_id,
    label: 'TDS',
    value: pickValue(r.values, ['TDS', 'tds'], '—'),
    unit: 'ppm',
    status: 'active',
  }));
  if (tdsTiles.length === 0) tdsTiles.push({ hardware_id: '', label: 'TDS', value: null, unit: 'ppm', status: 'inactive' });

  const qualityTiles = [...phTiles, ...condTiles, ...tdsTiles];

  return (
    <div className={`min-h-screen ${bgColor} transition-colors duration-300`} data-testid="dashboard-page">
      <header className={`shadow-md ${isDarkMode ? 'bg-gray-800' : 'bg-[#1a2332]'} transition-colors duration-300`}>
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
            <Button onClick={handleLogout} variant="outline" className="border-white text-white hover:text-white transition-colors" style={{ backgroundColor: '#f5a623', borderColor: '#f5a623' }} data-testid="dashboard-logout-btn">
              <LogOut className="mr-2 h-4 w-4" />Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-6">
        <div>
          <h2 className={`text-3xl font-bold mb-2 ${textColor}`}>Dashboard — Envirolytics Monitor</h2>
          <p className={textMuted}>Real-time environmental monitoring driven by IoT devices</p>
        </div>

        <WeatherCard weather={weather} loading={loadingWeather} isDarkMode={isDarkMode} getWaterFlowDirection={() => '—'} />

        {/* === LOCATION MAP === */}
        <Card className={isDarkMode ? 'bg-gray-800 border-gray-700' : ''} data-testid="dashboard-map-card">
          <CardHeader>
            <CardTitle className={`flex items-center gap-2 ${textColor}`}>
              <MapPin className="h-5 w-5" /> Client Locations
              <span className={`ml-2 text-sm font-normal ${textMuted}`}>({locations.length} pin{locations.length === 1 ? '' : 's'})</span>
            </CardTitle>
            <CardDescription className={textMuted}>Pins are placed using each client's latitude/longitude. Admins set these when creating users.</CardDescription>
          </CardHeader>
          <CardContent>
            <LocationMap locations={locations} />
          </CardContent>
        </Card>

        {/* === SEGMENTED SECTIONS === */}
        <InstrumentSection
          title="Water Abstraction"
          subtitle="Flowmeter — volumetric water draw"
          color="#4a9fd8"
          icon={Droplets}
          tiles={flowTiles}
          emptyText="No flowmeter live"
          isDarkMode={isDarkMode}
          testId="section-water-abstraction"
        />

        <InstrumentSection
          title="Water Level"
          subtitle="DWLR — Digital Water Level Recorder (groundwater)"
          color="#27ae60"
          icon={TrendingUp}
          tiles={dwlrTiles}
          emptyText="No DWLR live"
          isDarkMode={isDarkMode}
          testId="section-water-level"
        />

        <InstrumentSection
          title="Water Quality"
          subtitle="pH, Conductivity, TDS"
          color="#8e44ad"
          icon={FlaskConical}
          tiles={qualityTiles}
          emptyText="No water-quality sensors live"
          isDarkMode={isDarkMode}
          testId="section-water-quality"
        />

        {/* === Quick links === */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card
            className={`hover:shadow-xl transition-all cursor-pointer border-2 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}
            onClick={() => navigate('/flowmeter')}
            data-testid="dashboard-flowmeter-card"
          >
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-lg" style={{ backgroundColor: '#4a9fd8' }}>
                  <Droplets className="h-6 w-6 text-white" />
                </div>
                <div>
                  <CardTitle className={textColor}>Flowmeter Monitoring</CardTitle>
                  <CardDescription className={textMuted}>Detailed flow analysis</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Button style={{ backgroundColor: '#4a9fd8' }} className="w-full">View Details →</Button>
            </CardContent>
          </Card>

          <Card
            className={`hover:shadow-xl transition-all cursor-pointer border-2 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}
            onClick={() => navigate('/water-level-recorder')}
            data-testid="dashboard-dwlr-card"
          >
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-lg" style={{ backgroundColor: '#27ae60' }}>
                  <TrendingUp className="h-6 w-6 text-white" />
                </div>
                <div>
                  <CardTitle className={textColor}>Water Level Recorder</CardTitle>
                  <CardDescription className={textMuted}>DWLR & groundwater</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Button style={{ backgroundColor: '#27ae60' }} className="w-full">View Details →</Button>
            </CardContent>
          </Card>
        </div>

        {!mqttStatus.connected && (
          <Card className="border-amber-300 bg-amber-50">
            <CardContent className="py-4 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 shrink-0" />
              <p className="text-sm text-amber-800">
                <strong>MQTT broker offline</strong> — Configure or verify HiveMQ Cloud credentials, or use the
                <code className="mx-1 px-1 bg-amber-100 rounded">POST /api/instruments/ingest</code> admin endpoint to publish demo readings.
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
