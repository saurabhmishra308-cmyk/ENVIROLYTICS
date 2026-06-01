import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentUser, isAuthenticated, mockLogout, isAdmin } from '../mockData';
import api from '../lib/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { useTheme } from '../contexts/ThemeContext';
import { LogOut, Sun, Moon, Droplets, TrendingUp, Activity, AlertCircle } from 'lucide-react';
import axios from 'axios';

// Sub-components
import WeatherCard from '../components/WeatherCard';
import InstrumentsStatus from '../components/InstrumentsStatus';
import FlowmeterChart from '../components/FlowmeterChart';

const POLL_MS = 5000;

const logError = (error, context) => {
  if (process.env.NODE_ENV === 'development') {
    // eslint-disable-next-line no-console
    console.error(`Error in ${context}:`, error);
  }
};

const EnhancedDashboard = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const { isDarkMode, toggleTheme } = useTheme();
  const [weather, setWeather] = useState(null);
  const [loadingWeather, setLoadingWeather] = useState(true);
  const [flowmeters, setFlowmeters] = useState([]); // live readings from MQTT
  const [history, setHistory] = useState([]);
  const [mqttStatus, setMqttStatus] = useState({ connected: false });

  const LATITUDE = useMemo(() => 26.8467, []);
  const LONGITUDE = useMemo(() => 80.9462, []);
  const WEATHER_API_KEY = useMemo(() => process.env.REACT_APP_WEATHER_API_KEY, []);

  // Instrument list (purely structural — live values come from MQTT below)
  const instruments = useMemo(() => {
    const fmActive = flowmeters.length;
    return [
      { id: 'inst_flowmeter', name: 'Flowmeter', status: fmActive > 0 ? 'active' : 'inactive', location: 'ETP Inlet' },
      { id: 'inst_dwlr', name: 'DWLR', status: 'inactive', location: 'Borewell A' },
      { id: 'inst_ph', name: 'pH Sensor', status: 'inactive', location: 'Treatment Tank' },
      { id: 'inst_conductivity', name: 'Conductivity Meter', status: 'inactive', location: 'Outlet' },
      { id: 'inst_tds', name: 'TDS Meter', status: 'inactive', location: 'Main Line' },
      { id: 'inst_bod', name: 'BOD Analyzer', status: 'inactive', location: 'Lab Station' },
      { id: 'inst_cod', name: 'COD Analyzer', status: 'inactive', location: 'Lab Station' },
      { id: 'inst_tss', name: 'TSS Sensor', status: 'inactive', location: 'Secondary Tank' },
    ];
  }, [flowmeters.length]);

  const fetchWeatherData = useCallback(async () => {
    if (!WEATHER_API_KEY) {
      setLoadingWeather(false);
      return;
    }
    try {
      const response = await axios.get(
        `https://api.openweathermap.org/data/2.5/weather?lat=${LATITUDE}&lon=${LONGITUDE}&appid=${WEATHER_API_KEY}&units=metric`
      );
      setWeather(response.data);
    } catch (error) {
      logError(error, 'fetchWeatherData');
    } finally {
      setLoadingWeather(false);
    }
  }, [LATITUDE, LONGITUDE, WEATHER_API_KEY]);

  const fetchFlowmeterData = useCallback(async () => {
    try {
      const [latestRes, statusRes] = await Promise.all([
        api.get('/api/flowmeter/latest'),
        api.get('/api/flowmeter/status'),
      ]);
      const list = latestRes.data.flowmeters || [];
      setFlowmeters(list);
      setMqttStatus(statusRes.data || { connected: false });

      // Pull history for the first device
      if (list.length > 0) {
        try {
          const histRes = await api.get(`/api/flowmeter/history/${list[0].hardware_id}?limit=20`);
          const points = (histRes.data.readings || []).slice().reverse().map((r) => ({
            time: new Date(r.timestamp || r.received_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            value: Number(r.flow_rate_lpm || 0),
            id: r._id,
          }));
          setHistory(points);
        } catch {
          setHistory([]);
        }
      } else {
        setHistory([]);
      }
    } catch (e) {
      logError(e, 'fetchFlowmeterData');
    }
  }, []);

  const getWaterFlowDirection = useCallback(() => {
    if (!weather) return 'N/A';
    const windDeg = weather.wind?.deg || 0;
    const flowDeg = (windDeg + 180) % 360;
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return directions[Math.round(flowDeg / 45) % 8];
  }, [weather]);

  useEffect(() => {
    if (!isAuthenticated()) { navigate('/'); return; }
    setUser(getCurrentUser());
    fetchWeatherData();
    fetchFlowmeterData();
    const t = setInterval(fetchFlowmeterData, POLL_MS);
    return () => clearInterval(t);
  }, [navigate, fetchWeatherData, fetchFlowmeterData]);

  const handleLogout = useCallback(() => { mockLogout(); navigate('/'); }, [navigate]);

  if (!user) return null;

  const bgColor = isDarkMode ? 'bg-gray-900' : 'bg-gray-50';
  const textColor = isDarkMode ? 'text-white' : 'text-gray-900';
  const textMuted = isDarkMode ? 'text-gray-400' : 'text-gray-600';

  // Derive live values from first flowmeter (if any). Other instruments show "—" until devices come online.
  const fm = flowmeters[0];
  const liveData = {
    flowRate: fm ? Number(fm.flow_rate_lpm || 0) : null,
    waterLevel: null,
    pH: null,
    conductivity: null,
    tds: null,
    bod: null,
    cod: null,
    tss: null,
  };

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
            <Button onClick={toggleTheme} variant="outline" size="sm" className="border-white text-white hover:text-white" aria-label="Toggle theme" data-testid="dashboard-theme-toggle">
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

      <main className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h2 className={`text-3xl font-bold mb-2 ${textColor}`}>Dashboard - Envirolytics Monitor</h2>
          <p className={textMuted}>Real-time environmental monitoring driven by IoT devices</p>
        </div>

        <WeatherCard
          weather={weather}
          loading={loadingWeather}
          isDarkMode={isDarkMode}
          getWaterFlowDirection={getWaterFlowDirection}
        />

        <InstrumentsStatus instruments={instruments} isDarkMode={isDarkMode} />

        {flowmeters.length === 0 ? (
          <Card className={`mb-6 ${isDarkMode ? 'bg-gray-800 border-gray-700' : ''}`} data-testid="dashboard-empty-state">
            <CardContent className="py-12 text-center">
              <AlertCircle className="h-12 w-12 mx-auto mb-4 text-amber-500" />
              <h3 className={`text-xl font-semibold mb-2 ${textColor}`}>Awaiting Live Instrument Data</h3>
              <p className={textMuted}>
                No instruments have published readings yet. Live values will appear here as soon as IoT devices begin
                streaming via MQTT broker <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">{mqttStatus.broker || 'unconfigured'}</code>.
              </p>
              <p className={`text-xs mt-3 ${textMuted}`}>
                Status: <strong>{mqttStatus.connected ? 'Connected to broker' : 'Disconnected'}</strong>
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <FlowmeterChart liveData={liveData} historicalData={history} isDarkMode={isDarkMode} />
            <Card className={isDarkMode ? 'bg-gray-800 border-gray-700' : ''}>
              <CardHeader>
                <CardTitle className={textColor}>Active Devices</CardTitle>
                <CardDescription className={textMuted}>{flowmeters.length} device(s) reporting</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {flowmeters.map((m) => (
                  <div key={m.hardware_id} className={`flex items-center justify-between p-3 rounded ${isDarkMode ? 'bg-gray-700' : 'bg-gray-100'}`}>
                    <div>
                      <p className={`font-semibold ${textColor}`}>{m.hardware_id}</p>
                      <p className={`text-xs ${textMuted}`}>Signal: {m.signal_strength} · Temp: {Number(m.temperature || 0).toFixed(1)}°C</p>
                    </div>
                    <span className="text-xl font-bold" style={{ color: '#4a9fd8' }}>
                      {Number(m.flow_rate_lpm || 0).toFixed(2)} L/m
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
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
