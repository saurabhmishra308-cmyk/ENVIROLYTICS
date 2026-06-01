import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentUser, isAuthenticated, mockLogout } from '../mockData';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { LogOut, Droplets, Wind, TrendingUp, Gauge } from 'lucide-react';

const Dashboard = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);

  useEffect(() => {
    if (!isAuthenticated()) {
      navigate('/');
    } else {
      setUser(getCurrentUser());
    }
  }, [navigate]);

  const handleLogout = () => {
    mockLogout();
    navigate('/');
  };

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f5f5f5' }}>
      {/* Header */}
      <header className="shadow-md" style={{ backgroundColor: '#1a2332' }}>
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <img 
              src="https://www.envirolytics.in/logo-icon.png" 
              alt="Envirolytics Logo" 
              className="w-10 h-10"
            />
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
        <div className="mb-8">
          <h2 className="text-3xl font-bold mb-2" style={{ color: '#1a2332' }}>
            Environmental Monitoring Portal
          </h2>
          <p className="text-gray-600">Welcome back, {user.fullName}! Monitor your environmental compliance in real-time.</p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card className="border-l-4 hover:shadow-lg transition-shadow" style={{ borderLeftColor: '#4a9fd8' }}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Water Quality</CardTitle>
              <Droplets className="h-5 w-5" style={{ color: '#4a9fd8' }} />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold" style={{ color: '#1a2332' }}>98.2%</div>
              <p className="text-xs text-gray-500 mt-1">Compliance rate</p>
            </CardContent>
          </Card>

          <Card className="border-l-4 hover:shadow-lg transition-shadow" style={{ borderLeftColor: '#a3b744' }}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Air Quality</CardTitle>
              <Wind className="h-5 w-5" style={{ color: '#a3b744' }} />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold" style={{ color: '#1a2332' }}>87.5%</div>
              <p className="text-xs text-gray-500 mt-1">AQI monitoring</p>
            </CardContent>
          </Card>

          <Card className="border-l-4 hover:shadow-lg transition-shadow" style={{ borderLeftColor: '#f5a623' }}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">ESG Score</CardTitle>
              <Gauge className="h-5 w-5" style={{ color: '#f5a623' }} />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold" style={{ color: '#1a2332' }}>8.7/10</div>
              <p className="text-xs text-gray-500 mt-1">Sustainability rating</p>
            </CardContent>
          </Card>

          <Card className="border-l-4 hover:shadow-lg transition-shadow" style={{ borderLeftColor: '#27ae60' }}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Active Sensors</CardTitle>
              <TrendingUp className="h-5 w-5" style={{ color: '#27ae60' }} />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold" style={{ color: '#1a2332' }}>247</div>
              <p className="text-xs text-gray-500 mt-1">Real-time monitoring</p>
            </CardContent>
          </Card>
        </div>

        {/* Recent Activity */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle style={{ color: '#1a2332' }}>Recent Monitoring Activity</CardTitle>
            <CardDescription>Latest environmental data readings and compliance checks</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[
                { id: 'WQ-2847', status: 'Normal', type: 'Water Quality - pH Level', time: '2 min ago', value: '7.2' },
                { id: 'AQ-2846', status: 'Good', type: 'Air Quality - PM2.5', time: '5 min ago', value: '42 μg/m³' },
                { id: 'EF-2845', status: 'Normal', type: 'Effluent Flow Rate', time: '8 min ago', value: '125 L/min' },
                { id: 'DO-2844', status: 'Excellent', type: 'Dissolved Oxygen', time: '15 min ago', value: '8.5 mg/L' },
                { id: 'TP-2843', status: 'Normal', type: 'Temperature Monitoring', time: '22 min ago', value: '24.3°C' }
              ].map((reading) => (
                <div
                  key={reading.id}
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={`w-3 h-3 rounded-full ${
                        reading.status === 'Normal' || reading.status === 'Good' ? 'bg-green-500' : reading.status === 'Excellent' ? 'bg-blue-500 animate-pulse' : 'bg-yellow-500'
                      }`}
                    />
                    <div>
                      <p className="font-medium" style={{ color: '#1a2332' }}>{reading.id} - {reading.type}</p>
                      <p className="text-sm text-gray-500">Reading: {reading.value}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p
                      className="text-sm font-medium"
                      style={{ color: reading.status === 'Excellent' ? '#4a9fd8' : '#27ae60' }}
                    >
                      {reading.status}
                    </p>
                    <p className="text-xs text-gray-500">{reading.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* System Information */}
        <Card>
          <CardHeader>
            <CardTitle style={{ color: '#1a2332' }}>System Information</CardTitle>
            <CardDescription>Current monitoring system status and configuration</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600 mb-1">Portal Version</p>
                <p className="font-medium" style={{ color: '#1a2332' }}>1.0</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600 mb-1">User Role</p>
                <p className="font-medium" style={{ color: '#1a2332' }}>Environmental Administrator</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600 mb-1">Last Login</p>
                <p className="font-medium" style={{ color: '#1a2332' }}>Just now</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600 mb-1">System Status</p>
                <p className="font-medium text-green-600">All Sensors Operational</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600 mb-1">Compliance Rate</p>
                <p className="font-medium" style={{ color: '#1a2332' }}>98.5%</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600 mb-1">Active Projects</p>
                <p className="font-medium" style={{ color: '#1a2332' }}>12 Sites</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>

      {/* Footer */}
      <footer className="mt-12 py-4" style={{ backgroundColor: '#1a2332' }}>
        <div className="container mx-auto px-4 text-center text-white text-sm">
          <p>© 2025 Envirolytics Sustainability Private Limited. All rights reserved.</p>
          <p className="text-xs mt-1 opacity-70">CIN: U26510UP2026PTC247017</p>
        </div>
      </footer>
    </div>
  );
};

export default Dashboard;
