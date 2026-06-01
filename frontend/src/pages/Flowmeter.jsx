import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { isAuthenticated, getCurrentUser, mockLogout } from '../mockData';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { LogOut, ArrowLeft, Droplets, TrendingUp, AlertCircle, Clock, Gauge as GaugeIcon, Download } from 'lucide-react';

const Flowmeter = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [currentFlow, setCurrentFlow] = useState(125.8);
  const [totalVolume, setTotalVolume] = useState(45678.23);

  useEffect(() => {
    if (!isAuthenticated()) {
      navigate('/');
    } else {
      setUser(getCurrentUser());
    }

    // Simulate live flow rate updates
    const interval = setInterval(() => {
      setCurrentFlow(prev => {
        const change = (Math.random() - 0.5) * 10;
        return Math.max(80, Math.min(180, prev + change));
      });
      setTotalVolume(prev => prev + (Math.random() * 0.5));
    }, 2000);

    return () => clearInterval(interval);
  }, [navigate]);

  const handleLogout = () => {
    mockLogout();
    navigate('/');
  };

  if (!user) return null;

  const flowmeters = [
    { id: 'FM-001', location: 'ETP Inlet', status: 'Active', flow: 145.2, unit: 'L/min', temp: 24.5 },
    { id: 'FM-002', location: 'ETP Outlet', status: 'Active', flow: 138.7, unit: 'L/min', temp: 26.1 },
    { id: 'FM-003', location: 'WTP Main Line', status: 'Active', flow: 242.5, unit: 'L/min', temp: 22.8 },
    { id: 'FM-004', location: 'Irrigation System', status: 'Warning', flow: 89.3, unit: 'L/min', temp: 28.2 },
    { id: 'FM-005', location: 'Chemical Dosing', status: 'Active', flow: 12.8, unit: 'L/min', temp: 25.4 },
    { id: 'FM-006', location: 'Cooling Tower', status: 'Active', flow: 186.4, unit: 'L/min', temp: 31.2 },
  ];

  const recentReadings = [
    { time: '14:45', flow: 142.5, volume: 8525, status: 'Normal' },
    { time: '14:30', flow: 138.2, volume: 8310, status: 'Normal' },
    { time: '14:15', flow: 145.8, volume: 8748, status: 'Normal' },
    { time: '14:00', flow: 151.3, volume: 9078, status: 'High' },
    { time: '13:45', flow: 135.7, volume: 8142, status: 'Normal' },
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
            <div className="p-3 rounded-lg" style={{ backgroundColor: '#4a9fd8' }}>
              <Droplets className="h-8 w-8 text-white" />
            </div>
            <div>
              <h2 className="text-3xl font-bold" style={{ color: '#1a2332' }}>
                Flowmeter Monitoring System
              </h2>
              <p className="text-gray-600">Real-time water flow measurement and analytics</p>
            </div>
          </div>
        </div>

        {/* Live Monitoring Card */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <Card className="lg:col-span-2 border-t-4" style={{ borderTopColor: '#4a9fd8' }}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span style={{ color: '#1a2332' }}>Live Flow Rate - FM-001</span>
                <Badge className="bg-green-500 text-white">LIVE</Badge>
              </CardTitle>
              <CardDescription>ETP Inlet Pipeline - Real-time monitoring</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8">
                <div className="inline-flex items-baseline gap-2 mb-4">
                  <span className="text-7xl font-bold" style={{ color: '#4a9fd8' }}>
                    {currentFlow.toFixed(1)}
                  </span>
                  <span className="text-3xl font-semibold text-gray-600">L/min</span>
                </div>
                <div className="grid grid-cols-3 gap-4 mt-8">
                  <div className="p-4 bg-blue-50 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">Total Volume Today</p>
                    <p className="text-2xl font-bold" style={{ color: '#1a2332' }}>{totalVolume.toFixed(2)}</p>
                    <p className="text-xs text-gray-500">Liters</p>
                  </div>
                  <div className="p-4 bg-green-50 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">Avg Flow Rate</p>
                    <p className="text-2xl font-bold" style={{ color: '#1a2332' }}>142.3</p>
                    <p className="text-xs text-gray-500">L/min</p>
                  </div>
                  <div className="p-4 bg-amber-50 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">Uptime</p>
                    <p className="text-2xl font-bold" style={{ color: '#1a2332' }}>99.8%</p>
                    <p className="text-xs text-gray-500">Last 24h</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-t-4" style={{ borderTopColor: '#f5a623' }}>
            <CardHeader>
              <CardTitle style={{ color: '#1a2332' }}>System Status</CardTitle>
              <CardDescription>Overall system health</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                  <span className="font-medium" style={{ color: '#1a2332' }}>Active Meters</span>
                </div>
                <span className="text-lg font-bold" style={{ color: '#27ae60' }}>5</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-yellow-50 rounded-lg">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" style={{ color: '#f5a623' }} />
                  <span className="font-medium" style={{ color: '#1a2332' }}>Warnings</span>
                </div>
                <span className="text-lg font-bold" style={{ color: '#f5a623' }}>1</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-gray-600" />
                  <span className="font-medium" style={{ color: '#1a2332' }}>Last Update</span>
                </div>
                <span className="text-sm font-medium text-gray-600">2 sec ago</span>
              </div>
              <div className="pt-4">
                <Button className="w-full" style={{ backgroundColor: '#4a9fd8' }}>
                  <Download className="mr-2 h-4 w-4" />
                  Export Report
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* All Flowmeters Grid */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle style={{ color: '#1a2332' }}>All Flowmeter Locations</CardTitle>
            <CardDescription>Real-time monitoring across all installation points</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {flowmeters.map((meter) => (
                <div
                  key={meter.id}
                  className="p-4 rounded-lg border-2 hover:shadow-md transition-all cursor-pointer"
                  style={{ 
                    borderColor: meter.status === 'Active' ? '#4a9fd8' : '#f5a623',
                    backgroundColor: meter.status === 'Active' ? '#f0f8ff' : '#fff8f0'
                  }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-bold" style={{ color: '#1a2332' }}>{meter.id}</span>
                    <Badge 
                      className={meter.status === 'Active' ? 'bg-green-500' : 'bg-yellow-500'}
                    >
                      {meter.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-gray-600 mb-3">{meter.location}</p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">Flow Rate</span>
                      <span className="text-lg font-bold" style={{ color: '#4a9fd8' }}>
                        {meter.flow} {meter.unit}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">Temperature</span>
                      <span className="text-sm font-medium" style={{ color: '#1a2332' }}>
                        {meter.temp}°C
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Recent Readings Table */}
        <Card>
          <CardHeader>
            <CardTitle style={{ color: '#1a2332' }}>Recent Readings - FM-001</CardTitle>
            <CardDescription>Historical data from the last hour</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b-2" style={{ borderColor: '#4a9fd8' }}>
                    <th className="text-left p-3 font-semibold" style={{ color: '#1a2332' }}>Time</th>
                    <th className="text-left p-3 font-semibold" style={{ color: '#1a2332' }}>Flow Rate (L/min)</th>
                    <th className="text-left p-3 font-semibold" style={{ color: '#1a2332' }}>Volume (L)</th>
                    <th className="text-left p-3 font-semibold" style={{ color: '#1a2332' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentReadings.map((reading, index) => (
                    <tr key={index} className="border-b hover:bg-gray-50">
                      <td className="p-3 font-medium" style={{ color: '#1a2332' }}>{reading.time}</td>
                      <td className="p-3" style={{ color: '#4a9fd8' }}>{reading.flow}</td>
                      <td className="p-3 text-gray-600">{reading.volume}</td>
                      <td className="p-3">
                        <Badge className={reading.status === 'Normal' ? 'bg-green-500' : 'bg-yellow-500'}>
                          {reading.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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

export default Flowmeter;
