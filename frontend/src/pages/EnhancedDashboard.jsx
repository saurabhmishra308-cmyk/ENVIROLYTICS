import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentUser, isAuthenticated, mockLogout } from '../mockData';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { useTheme } from '../contexts/ThemeContext';
import { LogOut, Sun, Moon, Droplets, TrendingUp } from 'lucide-react';
import axios from 'axios';

// Import sub-components
import WeatherCard from '../components/WeatherCard';
import InstrumentsStatus from '../components/InstrumentsStatus';
import FlowmeterChart from '../components/FlowmeterChart';
import WaterLevelChart from '../components/WaterLevelChart';
import PHConductivityCard from '../components/PHConductivityCard';
import TDSChart from '../components/TDSChart';
import WaterQualityChart from '../components/WaterQualityChart';

// Custom error logging (replace with proper service in production)
const logError = (error, context) => {
  if (process.env.NODE_ENV === 'development') {
    console.error(`Error in ${context}:`, error);
  }
  // In production, send to error tracking service (e.g., Sentry)
};

const EnhancedDashboard = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const { isDarkMode, toggleTheme } = useTheme();
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(true);

  // Lucknow coordinates
  const LATITUDE = useMemo(() => 26.8467, []);
  const LONGITUDE = useMemo(() => 80.9462, []);
  const WEATHER_API_KEY = useMemo(() => process.env.REACT_APP_WEATHER_API_KEY, []);

  // Real-time parameter states
  const [liveData, setLiveData] = useState({
    flowRate: 125.8,
    waterLevel: 15.8,
    pH: 7.2,
    conductivity: 450,
    tds: 285,
    bod: 12.5,
    cod: 38.2,
    tss: 18.5
  });

  // Memoized historical data
  const flowmeterData = useMemo(() => [
    { time: '10:00', value: 120, id: 'flow_1' },
    { time: '11:00', value: 135, id: 'flow_2' },
    { time: '12:00', value: 128, id: 'flow_3' },
    { time: '13:00', value: 142, id: 'flow_4' },
    { time: '14:00', value: 125, id: 'flow_5' },
    { time: '15:00', value: 130, id: 'flow_6' }
  ], []);

  const waterLevelData = useMemo(() => [
    { day: 'Mon', level: 18.2, id: 'level_1' },
    { day: 'Tue', level: 17.5, id: 'level_2' },
    { day: 'Wed', level: 16.8, id: 'level_3' },
    { day: 'Thu', level: 16.2, id: 'level_4' },
    { day: 'Fri', level: 15.8, id: 'level_5' }
  ], []);

  const tdsData = useMemo(() => [
    { time: '6h ago', tds: 290, id: 'tds_1' },
    { time: '5h ago', tds: 288, id: 'tds_2' },
    { time: '4h ago', tds: 292, id: 'tds_3' },
    { time: '3h ago', tds: 287, id: 'tds_4' },
    { time: '2h ago', tds: 285, id: 'tds_5' },
    { time: 'Now', tds: liveData.tds, id: 'tds_6' }
  ], [liveData.tds]);

  // Instrument status with unique IDs
  const instruments = useMemo(() => [
    { id: 'inst_flowmeter', name: 'Flowmeter', status: 'active', location: 'ETP Inlet' },
    { id: 'inst_dwlr', name: 'DWLR', status: 'active', location: 'Borewell A' },
    { id: 'inst_ph', name: 'pH Sensor', status: 'active', location: 'Treatment Tank' },
    { id: 'inst_conductivity', name: 'Conductivity Meter', status: 'active', location: 'Outlet' },
    { id: 'inst_tds', name: 'TDS Meter', status: 'active', location: 'Main Line' },
    { id: 'inst_bod', name: 'BOD Analyzer', status: 'active', location: 'Lab Station' },
    { id: 'inst_cod', name: 'COD Analyzer', status: 'active', location: 'Lab Station' },
    { id: 'inst_tss', name: 'TSS Sensor', status: 'inactive', location: 'Secondary Tank' }
  ], []);

  // Fetch weather data
  const fetchWeatherData = useCallback(async () => {
    if (!WEATHER_API_KEY) {
      logError(new Error('Weather API key not configured'), 'fetchWeatherData');
      setLoading(false);
      return;
    }

    try {
      const response = await axios.get(
        `https://api.openweathermap.org/data/2.5/weather?lat=${LATITUDE}&lon=${LONGITUDE}&appid=${WEATHER_API_KEY}&units=metric`
      );
      setWeather(response.data);
      setLoading(false);
    } catch (error) {
      logError(error, 'fetchWeatherData');
      setLoading(false);
    }
  }, [LATITUDE, LONGITUDE, WEATHER_API_KEY]);

  // Calculate underground water flow direction based on wind
  const getWaterFlowDirection = useCallback(() => {
    if (!weather) return 'N/A';
    const windDeg = weather.wind?.deg || 0;
    const flowDeg = (windDeg + 180) % 360;
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(flowDeg / 45) % 8;
    return directions[index];
  }, [weather]);

  // Update live data
  const updateLiveData = useCallback(() => {
    setLiveData(prev => ({
      flowRate: Math.max(100, Math.min(150, prev.flowRate + (Math.random() - 0.5) * 5)),
      waterLevel: Math.max(12, Math.min(20, prev.waterLevel + (Math.random() - 0.5) * 0.2)),
      pH: Math.max(6.5, Math.min(8.5, prev.pH + (Math.random() - 0.5) * 0.1)),
      conductivity: Math.max(400, Math.min(500, prev.conductivity + (Math.random() - 0.5) * 10)),
      tds: Math.max(250, Math.min(320, prev.tds + (Math.random() - 0.5) * 5)),
      bod: Math.max(10, Math.min(15, prev.bod + (Math.random() - 0.5) * 0.3)),
      cod: Math.max(35, Math.min(42, prev.cod + (Math.random() - 0.5) * 0.5)),
      tss: Math.max(15, Math.min(22, prev.tss + (Math.random() - 0.5) * 0.4))
    }));
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) {
      navigate('/');
      return;
    }
    
    setUser(getCurrentUser());
    fetchWeatherData();

    // Setup live data update interval
    const interval = setInterval(updateLiveData, 3000);

    return () => clearInterval(interval);
  }, [navigate, fetchWeatherData, updateLiveData]);

  const handleLogout = useCallback(() => {
    mockLogout();
    navigate('/');
  }, [navigate]);

  const handleNavigateToFlowmeter = useCallback(() => {
    navigate('/flowmeter');
  }, [navigate]);

  const handleNavigateToWaterLevel = useCallback(() => {
    navigate('/water-level-recorder');
  }, [navigate]);

  if (!user) return null;

  const bgColor = isDarkMode ? 'bg-gray-900' : 'bg-gray-50';
  const textColor = isDarkMode ? 'text-white' : 'text-gray-900';
  const textMuted = isDarkMode ? 'text-gray-400' : 'text-gray-600';

  return (
    <div className={`min-h-screen ${bgColor} transition-colors duration-300`}>
      {/* Header */}
      <header className={`shadow-md ${isDarkMode ? 'bg-gray-800' : 'bg-[#1a2332]'} transition-colors duration-300`}>
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-white font-bold text-xl tracking-wide" style={{ color: '#4a9fd8' }}>ENVIROLYTICS</h1>
            <p className="text-white text-[8px] tracking-wider" style={{ opacity: 0.7 }}>SUSTAINABILITY PRIVATE LIMITED</p>
          </div>
          <div className="flex items-center gap-4">
            <Button
              onClick={toggleTheme}
              variant="outline"
              size="sm"
              className="border-white text-white hover:text-white"
              aria-label="Toggle theme"
            >
              {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <div className="text-white text-sm">
              <p className="font-medium">{user.fullName}</p>
              <p className="text-gray-300 text-xs">{user.username}</p>
            </div>
            <Button
              onClick={handleLogout}
              variant="outline"
              className="border-white text-white hover:text-white transition-colors"
              style={{ backgroundColor: '#f5a623', borderColor: '#f5a623' }}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h2 className={`text-3xl font-bold mb-2 ${textColor}`}>Dashboard - Envirolytics Monitor</h2>
          <p className={textMuted}>Real-time environmental monitoring and compliance tracking</p>
        </div>

        <WeatherCard 
          weather={weather} 
          loading={loading} 
          isDarkMode={isDarkMode}
          getWaterFlowDirection={getWaterFlowDirection}
        />

        <InstrumentsStatus instruments={instruments} isDarkMode={isDarkMode} />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <FlowmeterChart liveData={liveData} historicalData={flowmeterData} isDarkMode={isDarkMode} />
          <WaterLevelChart liveData={liveData} historicalData={waterLevelData} isDarkMode={isDarkMode} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <PHConductivityCard liveData={liveData} isDarkMode={isDarkMode} />
          <TDSChart liveData={liveData} historicalData={tdsData} isDarkMode={isDarkMode} />
        </div>

        <WaterQualityChart liveData={liveData} isDarkMode={isDarkMode} />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card 
            className={`hover:shadow-xl transition-all cursor-pointer border-2 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}
            onClick={handleNavigateToFlowmeter}
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
              <Button style={{ backgroundColor: '#4a9fd8' }} className="w-full">
                View Details →
              </Button>
            </CardContent>
          </Card>

          <Card 
            className={`hover:shadow-xl transition-all cursor-pointer border-2 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}
            onClick={handleNavigateToWaterLevel}
          >
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-lg" style={{ backgroundColor: '#27ae60' }}>
                  <TrendingUp className="h-6 w-6 text-white" />
                </div>
                <div>
                  <CardTitle className={textColor}>Water Level Recorder</CardTitle>
                  <CardDescription className={textMuted}>DWLR & groundwater analysis</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Button style={{ backgroundColor: '#27ae60' }} className="w-full">
                View Details →
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Footer */}
      <footer className={`mt-12 py-4 ${isDarkMode ? 'bg-gray-800' : 'bg-[#1a2332]'}`}>
        <div className=\"container mx-auto px-4 text-center text-white text-sm\">
          <p>© 2025 Envirolytics Sustainability Private Limited. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default EnhancedDashboard;
