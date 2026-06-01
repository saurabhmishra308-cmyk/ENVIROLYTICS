import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentUser, isAuthenticated, mockLogout } from '../mockData';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { useTheme } from '../contexts/ThemeContext';
import { 
  LogOut, Droplets, Wind, TrendingUp, Gauge, Sun, Moon, 
  Cloud, CloudRain, Activity, Waves, Thermometer, Navigation,
  Beaker, FlaskConical, TestTube, Droplet
} from 'lucide-react';
import { LineChart, Line, BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import axios from 'axios';

const EnhancedDashboard = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const { isDarkMode, toggleTheme } = useTheme();
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(true);

  // Lucknow coordinates
  const LATITUDE = 26.8467;
  const LONGITUDE = 80.9462;
  const WEATHER_API_KEY = 'c739a0f981a6ec4c486c6fe9b25a2b92';

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

  useEffect(() => {
    if (!isAuthenticated()) {
      navigate('/');
    } else {
      setUser(getCurrentUser());
    }

    // Fetch weather data
    fetchWeatherData();

    // Simulate live data updates
    const interval = setInterval(() => {
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
    }, 3000);

    return () => clearInterval(interval);
  }, [navigate]);

  const fetchWeatherData = async () => {
    try {
      const response = await axios.get(
        `https://api.openweathermap.org/data/2.5/weather?lat=${LATITUDE}&lon=${LONGITUDE}&appid=${WEATHER_API_KEY}&units=metric`
      );
      setWeather(response.data);
      setLoading(false);
    } catch (error) {
      console.error('Weather fetch error:', error);
      setLoading(false);
    }
  };

  const handleLogout = () => {
    mockLogout();
    navigate('/');
  };

  if (!user) return null;

  // Historical data for charts
  const flowmeterData = [
    { time: '10:00', value: 120 },
    { time: '11:00', value: 135 },
    { time: '12:00', value: 128 },
    { time: '13:00', value: 142 },
    { time: '14:00', value: 125 },
    { time: '15:00', value: 130 }
  ];

  const waterLevelData = [
    { day: 'Mon', level: 18.2 },
    { day: 'Tue', level: 17.5 },
    { day: 'Wed', level: 16.8 },
    { day: 'Thu', level: 16.2 },
    { day: 'Fri', level: 15.8 }
  ];

  const waterQualityData = [
    { parameter: 'pH', value: liveData.pH, standard: 7.0 },
    { parameter: 'BOD', value: liveData.bod, standard: 10 },
    { parameter: 'COD', value: liveData.cod, standard: 40 },
    { parameter: 'TSS', value: liveData.tss, standard: 20 }
  ];

  const tdsData = [
    { time: '6h ago', tds: 290 },
    { time: '5h ago', tds: 288 },
    { time: '4h ago', tds: 292 },
    { time: '3h ago', tds: 287 },
    { time: '2h ago', tds: 285 },
    { time: 'Now', tds: liveData.tds }
  ];

  // Instrument status
  const instruments = [
    { name: 'Flowmeter', status: 'active', location: 'ETP Inlet' },
    { name: 'DWLR', status: 'active', location: 'Borewell A' },
    { name: 'pH Sensor', status: 'active', location: 'Treatment Tank' },
    { name: 'Conductivity Meter', status: 'active', location: 'Outlet' },
    { name: 'TDS Meter', status: 'active', location: 'Main Line' },
    { name: 'BOD Analyzer', status: 'active', location: 'Lab Station' },
    { name: 'COD Analyzer', status: 'active', location: 'Lab Station' },
    { name: 'TSS Sensor', status: 'inactive', location: 'Secondary Tank' }
  ];

  // Calculate underground water flow direction based on wind
  const getWaterFlowDirection = () => {
    if (!weather) return 'N/A';
    const windDeg = weather.wind?.deg || 0;
    // Simulate underground flow (opposite to wind for demonstration)
    const flowDeg = (windDeg + 180) % 360;
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(flowDeg / 45) % 8;
    return directions[index];
  };

  const bgColor = isDarkMode ? 'bg-gray-900' : 'bg-gray-50';
  const cardBg = isDarkMode ? 'bg-gray-800' : 'bg-white';
  const textColor = isDarkMode ? 'text-white' : 'text-gray-900';
  const textMuted = isDarkMode ? 'text-gray-400' : 'text-gray-600';
  const borderColor = isDarkMode ? 'border-gray-700' : 'border-gray-200';

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
            {/* Theme Toggle */}
            <Button
              onClick={toggleTheme}
              variant="outline"
              size="sm"
              className="border-white text-white hover:text-white"
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

        {/* Weather Data Section */}
        <Card className={`mb-6 ${cardBg} ${borderColor} border`}>
          <CardHeader>
            <CardTitle className={`flex items-center gap-2 ${textColor}`}>
              <Cloud className="h-5 w-5" />
              Live Weather Data - Lucknow
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className={textMuted}>Loading weather data...</p>
            ) : weather ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                <div className="p-4 rounded-lg" style={{ backgroundColor: isDarkMode ? '#374151' : '#dbeafe' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <Thermometer className="h-5 w-5" style={{ color: '#ef4444' }} />
                    <span className={`text-sm ${textMuted}`}>Temperature</span>
                  </div>
                  <p className={`text-2xl font-bold ${textColor}`}>{weather.main?.temp.toFixed(1)}°C</p>
                  <p className="text-xs" style={{ color: '#6b7280' }}>Feels like {weather.main?.feels_like.toFixed(1)}°C</p>
                </div>

                <div className="p-4 rounded-lg" style={{ backgroundColor: isDarkMode ? '#374151' : '#e0f2fe' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <Droplet className="h-5 w-5" style={{ color: '#3b82f6' }} />
                    <span className={`text-sm ${textMuted}`}>Humidity</span>
                  </div>
                  <p className={`text-2xl font-bold ${textColor}`}>{weather.main?.humidity}%</p>
                  <p className="text-xs" style={{ color: '#6b7280' }}>Relative humidity</p>
                </div>

                <div className="p-4 rounded-lg" style={{ backgroundColor: isDarkMode ? '#374151' : '#dcfce7' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <Wind className="h-5 w-5" style={{ color: '#10b981' }} />
                    <span className={`text-sm ${textMuted}`}>Wind Speed</span>
                  </div>
                  <p className={`text-2xl font-bold ${textColor}`}>{weather.wind?.speed.toFixed(1)} m/s</p>
                  <p className="text-xs" style={{ color: '#6b7280' }}>Direction: {weather.wind?.deg}°</p>
                </div>

                <div className="p-4 rounded-lg" style={{ backgroundColor: isDarkMode ? '#374151' : '#e0e7ff' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <CloudRain className="h-5 w-5" style={{ color: '#6366f1' }} />
                    <span className={`text-sm ${textMuted}`}>Rainfall</span>
                  </div>
                  <p className={`text-2xl font-bold ${textColor}`}>{weather.rain?.['1h'] || 0} mm</p>
                  <p className="text-xs" style={{ color: '#6b7280' }}>Last 1 hour</p>
                </div>

                <div className="p-4 rounded-lg" style={{ backgroundColor: isDarkMode ? '#374151' : '#fef3c7' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <Activity className="h-5 w-5" style={{ color: '#f59e0b' }} />
                    <span className={`text-sm ${textMuted}`}>Pressure</span>
                  </div>
                  <p className={`text-2xl font-bold ${textColor}`}>{weather.main?.pressure} hPa</p>
                  <p className="text-xs" style={{ color: '#6b7280' }}>Atmospheric</p>
                </div>

                <div className="p-4 rounded-lg" style={{ backgroundColor: isDarkMode ? '#374151' : '#fce7f3' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <Navigation className="h-5 w-5" style={{ color: '#ec4899' }} />
                    <span className={`text-sm ${textMuted}`}>Water Flow Dir</span>
                  </div>
                  <p className={`text-2xl font-bold ${textColor}`}>{getWaterFlowDirection()}</p>
                  <p className="text-xs" style={{ color: '#6b7280' }}>Underground</p>
                </div>
              </div>
            ) : (
              <p className={textMuted}>Weather data unavailable</p>
            )}
          </CardContent>
        </Card>

        {/* Instruments Status */}
        <Card className={`mb-6 ${cardBg} ${borderColor} border`}>
          <CardHeader>
            <CardTitle className={`flex items-center justify-between ${textColor}`}>
              <span>Site Instruments Status</span>
              <Badge className="bg-green-500">8 Total</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {instruments.map((instrument, idx) => (
                <div
                  key={idx}
                  className={`p-3 rounded-lg border-2 ${isDarkMode ? 'bg-gray-700' : 'bg-gray-50'}`}
                  style={{
                    borderColor: instrument.status === 'active' ? '#10b981' : '#ef4444'
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-sm font-semibold ${textColor}`}>{instrument.name}</span>
                    <div
                      className={`w-3 h-3 rounded-full ${
                        instrument.status === 'active' ? 'bg-green-500 animate-pulse' : 'bg-red-500'
                      }`}
                    ></div>
                  </div>
                  <p className="text-xs" style={{ color: '#6b7280' }}>{instrument.location}</p>
                  <Badge
                    className={`mt-2 text-xs ${
                      instrument.status === 'active' ? 'bg-green-500' : 'bg-red-500'
                    }`}
                  >
                    {instrument.status.toUpperCase()}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Graphical Representations - Row 1 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Flowmeter Chart */}
          <Card className={`${cardBg} ${borderColor} border`}>
            <CardHeader>
              <CardTitle className={`flex items-center gap-2 ${textColor}`}>
                <Droplets className="h-5 w-5" style={{ color: '#4a9fd8' }} />
                Flowmeter - Real-time Monitoring
              </CardTitle>
              <CardDescription className={textMuted}>Live flow rate (L/min)</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center mb-4">
                <span className="text-5xl font-bold" style={{ color: '#4a9fd8' }}>
                  {liveData.flowRate.toFixed(1)}
                </span>
                <span className={`text-xl ml-2 ${textMuted}`}>L/min</span>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={flowmeterData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? '#374151' : '#e5e7eb'} />
                  <XAxis dataKey="time" stroke={isDarkMode ? '#9ca3af' : '#6b7280'} />
                  <YAxis stroke={isDarkMode ? '#9ca3af' : '#6b7280'} />
                  <Tooltip contentStyle={{ backgroundColor: isDarkMode ? '#1f2937' : '#ffffff', border: '1px solid #e5e7eb' }} />
                  <Area type="monotone" dataKey="value" stroke="#4a9fd8" fill="#4a9fd8" fillOpacity={0.6} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Water Level Recorder Chart */}
          <Card className={`${cardBg} ${borderColor} border`}>
            <CardHeader>
              <CardTitle className={`flex items-center gap-2 ${textColor}`}>
                <Waves className="h-5 w-5" style={{ color: '#27ae60' }} />
                Digital Water Level Recorder
              </CardTitle>
              <CardDescription className={textMuted}>Groundwater level (meters)</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center mb-4">
                <span className="text-5xl font-bold" style={{ color: '#27ae60' }}>
                  {liveData.waterLevel.toFixed(2)}
                </span>
                <span className={`text-xl ml-2 ${textMuted}`}>meters</span>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={waterLevelData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? '#374151' : '#e5e7eb'} />
                  <XAxis dataKey="day" stroke={isDarkMode ? '#9ca3af' : '#6b7280'} />
                  <YAxis stroke={isDarkMode ? '#9ca3af' : '#6b7280'} />
                  <Tooltip contentStyle={{ backgroundColor: isDarkMode ? '#1f2937' : '#ffffff', border: '1px solid #e5e7eb' }} />
                  <Bar dataKey="level" fill="#27ae60" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Graphical Representations - Row 2 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* pH & Conductivity */}
          <Card className={`${cardBg} ${borderColor} border`}>
            <CardHeader>
              <CardTitle className={`flex items-center gap-2 ${textColor}`}>
                <TestTube className="h-5 w-5" style={{ color: '#8b5cf6' }} />
                pH & Conductivity Monitoring
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="text-center p-4 rounded-lg" style={{ backgroundColor: isDarkMode ? '#374151' : '#f3e8ff' }}>
                  <p className={`text-sm mb-2 ${textMuted}`}>pH Level</p>
                  <p className="text-4xl font-bold" style={{ color: '#8b5cf6' }}>{liveData.pH.toFixed(1)}</p>
                  <p className="text-xs mt-1" style={{ color: '#6b7280' }}>Neutral range</p>
                </div>
                <div className="text-center p-4 rounded-lg" style={{ backgroundColor: isDarkMode ? '#374151' : '#dbeafe' }}>
                  <p className={`text-sm mb-2 ${textMuted}`}>Conductivity</p>
                  <p className="text-4xl font-bold" style={{ color: '#3b82f6' }}>{liveData.conductivity.toFixed(0)}</p>
                  <p className="text-xs mt-1" style={{ color: '#6b7280' }}>µS/cm</p>
                </div>
              </div>
              <div className="h-2 bg-gradient-to-r from-red-500 via-green-500 to-blue-500 rounded-full"></div>
              <div className="flex justify-between mt-2 text-xs" style={{ color: '#6b7280' }}>
                <span>Acidic (0-6)</span>
                <span>Neutral (7)</span>
                <span>Alkaline (8-14)</span>
              </div>
            </CardContent>
          </Card>

          {/* TDS Trend */}
          <Card className={`${cardBg} ${borderColor} border`}>
            <CardHeader>
              <CardTitle className={`flex items-center gap-2 ${textColor}`}>
                <Beaker className="h-5 w-5" style={{ color: '#f59e0b' }} />
                Total Dissolved Solids (TDS)
              </CardTitle>
              <CardDescription className={textMuted}>6-hour trend (ppm)</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center mb-4">
                <span className="text-5xl font-bold" style={{ color: '#f59e0b' }}>
                  {liveData.tds.toFixed(0)}
                </span>
                <span className={`text-xl ml-2 ${textMuted}`}>ppm</span>
              </div>
              <ResponsiveContainer width="100%" height={150}>
                <LineChart data={tdsData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? '#374151' : '#e5e7eb'} />
                  <XAxis dataKey="time" stroke={isDarkMode ? '#9ca3af' : '#6b7280'} fontSize={12} />
                  <YAxis stroke={isDarkMode ? '#9ca3af' : '#6b7280'} />
                  <Tooltip contentStyle={{ backgroundColor: isDarkMode ? '#1f2937' : '#ffffff', border: '1px solid #e5e7eb' }} />
                  <Line type="monotone" dataKey="tds" stroke="#f59e0b" strokeWidth={3} dot={{ fill: '#f59e0b', r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Water Quality Parameters */}
        <Card className={`mb-6 ${cardBg} ${borderColor} border`}>
          <CardHeader>
            <CardTitle className={`flex items-center gap-2 ${textColor}`}>
              <FlaskConical className="h-5 w-5" style={{ color: '#ec4899' }} />
              Water Quality Parameters - BOD, COD, TSS
            </CardTitle>
            <CardDescription className={textMuted}>Comparison with standard limits</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={waterQualityData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? '#374151' : '#e5e7eb'} />
                    <XAxis dataKey="parameter" stroke={isDarkMode ? '#9ca3af' : '#6b7280'} />
                    <YAxis stroke={isDarkMode ? '#9ca3af' : '#6b7280'} />
                    <Tooltip contentStyle={{ backgroundColor: isDarkMode ? '#1f2937' : '#ffffff', border: '1px solid #e5e7eb' }} />
                    <Legend />
                    <Bar dataKey="value" fill="#ec4899" name="Current Value" />
                    <Bar dataKey="standard" fill="#6b7280" name="Standard Limit" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-lg" style={{ backgroundColor: isDarkMode ? '#374151' : '#fce7f3' }}>
                  <p className={`text-xs mb-1 ${textMuted}`}>BOD</p>
                  <p className="text-3xl font-bold" style={{ color: '#ec4899' }}>{liveData.bod.toFixed(1)}</p>
                  <p className="text-xs" style={{ color: '#6b7280' }}>mg/L</p>
                </div>
                <div className="p-4 rounded-lg" style={{ backgroundColor: isDarkMode ? '#374151' : '#e0e7ff' }}>
                  <p className={`text-xs mb-1 ${textMuted}`}>COD</p>
                  <p className="text-3xl font-bold" style={{ color: '#6366f1' }}>{liveData.cod.toFixed(1)}</p>
                  <p className="text-xs" style={{ color: '#6b7280' }}>mg/L</p>
                </div>
                <div className="p-4 rounded-lg" style={{ backgroundColor: isDarkMode ? '#374151' : '#dcfce7' }}>
                  <p className={`text-xs mb-1 ${textMuted}`}>TSS</p>
                  <p className="text-3xl font-bold" style={{ color: '#10b981' }}>{liveData.tss.toFixed(1)}</p>
                  <p className="text-xs" style={{ color: '#6b7280' }}>mg/L</p>
                </div>
                <div className="p-4 rounded-lg" style={{ backgroundColor: isDarkMode ? '#374151' : '#fef3c7' }}>
                  <p className={`text-xs mb-1 ${textMuted}`}>Compliance</p>
                  <p className="text-3xl font-bold" style={{ color: '#10b981' }}>98%</p>
                  <p className="text-xs" style={{ color: '#6b7280' }}>Overall</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Quick Access Modules */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card 
            className={`hover:shadow-xl transition-all cursor-pointer border-2 ${cardBg} ${borderColor}`}
            onClick={() => navigate('/flowmeter')}
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
            className={`hover:shadow-xl transition-all cursor-pointer border-2 ${cardBg} ${borderColor}`}
            onClick={() => navigate('/water-level-recorder')}
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
        <div className="container mx-auto px-4 text-center text-white text-sm">
          <p>© 2025 Envirolytics Sustainability Private Limited. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default EnhancedDashboard;
