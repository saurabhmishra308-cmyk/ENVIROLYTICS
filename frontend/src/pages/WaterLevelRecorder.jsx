import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { isAuthenticated, getCurrentUser, mockLogout } from '../mockData';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Progress } from '../components/ui/progress';
import { LogOut, ArrowLeft, Waves, TrendingDown, TrendingUp, AlertTriangle, MapPin, Activity } from 'lucide-react';

const WaterLevelRecorder = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [waterLevel, setWaterLevel] = useState(15.8);
  const [trend, setTrend] = useState('stable');

  useEffect(() => {
    if (!isAuthenticated()) {
      navigate('/');
    } else {
      setUser(getCurrentUser());
    }

    // Simulate water level updates
    const interval = setInterval(() => {
      setWaterLevel(prev => {
        const change = (Math.random() - 0.5) * 0.3;
        const newLevel = prev + change;
        if (change > 0.1) setTrend('rising');
        else if (change < -0.1) setTrend('falling');
        else setTrend('stable');
        return Math.max(10, Math.min(25, newLevel));
      });
    }, 3000);

    return () => clearInterval(interval);
  }, [navigate]);

  const handleLogout = () => {
    mockLogout();
    navigate('/');
  };

  if (!user) return null;

  const borewells = [
    { id: 'DWLR-BW-01', location: 'Borewell A - North Sector', depth: 45, level: 15.8, status: 'Normal', quality: 'Good', temp: 23.5 },
    { id: 'DWLR-BW-02', location: 'Borewell B - East Sector', depth: 52, level: 22.3, status: 'Low', quality: 'Fair', temp: 24.1 },
    { id: 'DWLR-BW-03', location: 'Borewell C - South Sector', depth: 38, level: 12.5, status: 'Normal', quality: 'Good', temp: 22.8 },
    { id: 'DWLR-BW-04', location: 'Borewell D - West Sector', depth: 48, level: 18.2, status: 'Normal', quality: 'Excellent', temp: 23.2 },
  ];

  const alerts = [
    { time: '2 hours ago', message: 'Water level dropped below 20m in DWLR-BW-02', severity: 'warning' },
    { time: '1 day ago', message: 'Maintenance scheduled for DWLR-BW-01', severity: 'info' },
    { time: '2 days ago', message: 'Heavy rainfall detected - water level rising', severity: 'info' },
  ];

  const historicalData = [
    { date: 'Jan 1', level: 18.2 },
    { date: 'Jan 8', level: 17.5 },
    { date: 'Jan 15', level: 16.8 },
    { date: 'Jan 22', level: 16.2 },
    { date: 'Jan 29', level: 15.8 },
  ];

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f5f5f5' }}>
      {/* Header */}
      <header className="shadow-md" style={{ backgroundColor: '#1a2332' }}>
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
        {/* Page Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-3 rounded-lg" style={{ backgroundColor: '#27ae60' }}>
              <Waves className="h-8 w-8 text-white" />
            </div>
            <div>
              <h2 className="text-3xl font-bold" style={{ color: '#1a2332' }}>
                Digital Water Level Recorder (DWLR)
              </h2>
              <p className="text-gray-600">Groundwater monitoring and borewell management system</p>
            </div>
          </div>
        </div>

        {/* Primary Monitoring Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Live Water Level */}
          <Card className="border-t-4" style={{ borderTopColor: '#27ae60' }}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span style={{ color: '#1a2332' }}>Live Water Level - DWLR-BW-01</span>
                <Badge className="bg-blue-500 text-white">LIVE</Badge>
              </CardTitle>
              <CardDescription>Borewell A - North Sector</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div className="text-center py-4">
                  <div className="inline-flex items-baseline gap-2 mb-2">
                    <span className="text-6xl font-bold" style={{ color: '#27ae60' }}>
                      {waterLevel.toFixed(2)}
                    </span>
                    <span className="text-2xl font-semibold text-gray-600">meters</span>
                  </div>
                  <div className="flex items-center justify-center gap-2 mt-2">
                    {trend === 'rising' && <TrendingUp className="text-green-500" />}
                    {trend === 'falling' && <TrendingDown className="text-red-500" />}
                    <span className="text-sm text-gray-600 capitalize">
                      {trend === 'rising' ? 'Water level rising' : trend === 'falling' ? 'Water level falling' : 'Level stable'}
                    </span>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-600">Depth Percentage</span>
                      <span className="font-medium" style={{ color: '#1a2332' }}>
                        {((waterLevel / 45) * 100).toFixed(1)}%
                      </span>
                    </div>
                    <Progress value={(waterLevel / 45) * 100} className="h-3" />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-blue-50 rounded-lg">
                      <p className="text-xs text-gray-600 mb-1">Total Depth</p>
                      <p className="text-xl font-bold" style={{ color: '#1a2332' }}>45.0 m</p>
                    </div>
                    <div className="p-3 bg-green-50 rounded-lg">
                      <p className="text-xs text-gray-600 mb-1">Water Quality</p>
                      <p className="text-xl font-bold" style={{ color: '#27ae60' }}>Good</p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Alerts & Notifications */}
          <Card className="border-t-4" style={{ borderTopColor: '#f5a623' }}>
            <CardHeader>
              <CardTitle style={{ color: '#1a2332' }}>Alerts & Notifications</CardTitle>
              <CardDescription>Recent system alerts and updates</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {alerts.map((alert, index) => (
                  <div
                    key={index}
                    className="flex gap-3 p-3 rounded-lg border-l-4"
                    style={{
                      backgroundColor: alert.severity === 'warning' ? '#fff8f0' : '#f0f8ff',
                      borderLeftColor: alert.severity === 'warning' ? '#f5a623' : '#4a9fd8'
                    }}
                  >
                    <AlertTriangle
                      className="h-5 w-5 flex-shrink-0 mt-0.5"
                      style={{ color: alert.severity === 'warning' ? '#f5a623' : '#4a9fd8' }}
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium" style={{ color: '#1a2332' }}>
                        {alert.message}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">{alert.time}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 p-4 rounded-lg" style={{ backgroundColor: '#e8f5e9' }}>
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="h-5 w-5" style={{ color: '#27ae60' }} />
                  <span className="font-semibold" style={{ color: '#1a2332' }}>System Health</span>
                </div>
                <p className="text-sm text-gray-600">All sensors operational. Data sync: Normal</p>
                <Progress value={98} className="h-2 mt-2" />
                <p className="text-xs text-gray-500 mt-1">98% uptime in last 30 days</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* All Borewells Overview */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle style={{ color: '#1a2332' }}>All Borewell Locations</CardTitle>
            <CardDescription>Comprehensive groundwater monitoring across sites</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {borewells.map((well) => (
                <div
                  key={well.id}
                  className="p-4 rounded-lg border hover:shadow-md transition-all"
                  style={{ 
                    backgroundColor: well.status === 'Low' ? '#fff8f0' : '#ffffff',
                    borderColor: well.status === 'Low' ? '#f5a623' : '#e0e0e0',
                    borderWidth: '2px'
                  }}
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <MapPin className="h-5 w-5 mt-1" style={{ color: '#27ae60' }} />
                      <div>
                        <h3 className="font-bold text-lg" style={{ color: '#1a2332' }}>{well.id}</h3>
                        <p className="text-sm text-gray-600">{well.location}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 flex-1">
                      <div>
                        <p className="text-xs text-gray-500">Water Level</p>
                        <p className="text-lg font-bold" style={{ color: '#27ae60' }}>{well.level}m</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Total Depth</p>
                        <p className="text-lg font-bold" style={{ color: '#1a2332' }}>{well.depth}m</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Quality</p>
                        <p className="text-lg font-bold" style={{ color: '#4a9fd8' }}>{well.quality}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Temperature</p>
                        <p className="text-lg font-bold" style={{ color: '#1a2332' }}>{well.temp}°C</p>
                      </div>
                      <div className="flex items-center">
                        <Badge className={well.status === 'Normal' ? 'bg-green-500' : 'bg-yellow-500'}>
                          {well.status}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Historical Trend */}
        <Card>
          <CardHeader>
            <CardTitle style={{ color: '#1a2332' }}>Historical Water Level Trend</CardTitle>
            <CardDescription>Monthly average water levels - DWLR-BW-01</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {historicalData.map((data, index) => (
                <div key={index} className="flex items-center gap-4">
                  <div className="w-24 text-sm font-medium" style={{ color: '#1a2332' }}>
                    {data.date}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <div 
                        className="h-8 rounded transition-all"
                        style={{ 
                          width: `${(data.level / 25) * 100}%`,
                          backgroundColor: data.level < 16 ? '#f5a623' : '#27ae60'
                        }}
                      ></div>
                      <span className="text-sm font-semibold" style={{ color: '#1a2332' }}>
                        {data.level}m
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 p-4 bg-blue-50 rounded-lg">
              <p className="text-sm" style={{ color: '#1a2332' }}>
                <strong>Analysis:</strong> Water level shows a gradual declining trend over the past month. 
                Recommended action: Monitor closely and consider water conservation measures.
              </p>
            </div>
          </CardContent>
        </Card>
      </main>

      {/* Footer */}
      <footer className="mt-12 py-4" style={{ backgroundColor: '#1a2332' }}>
        <div className="container mx-auto px-4 text-center text-white text-sm">
          <p>© 2025 Envirolytics Sustainability Private Limited. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default WaterLevelRecorder;
