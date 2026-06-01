import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentUser, isAuthenticated, mockLogout } from '../mockData';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { LogOut, Activity, Database, Gauge, TrendingUp } from 'lucide-react';

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
    <div className="min-h-screen" style={{ backgroundColor: '#e8e8e8' }}>
      {/* Header */}
      <header className="bg-[#5c5c5c] shadow-md">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-white font-bold text-2xl tracking-wider">ASTER</h1>
            <p className="text-white text-xs tracking-widest">TECHNOLOGIES</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-white text-sm">
              <p className="font-medium">{user.fullName}</p>
              <p className="text-gray-300 text-xs">{user.username}</p>
            </div>
            <Button
              onClick={handleLogout}
              variant="outline"
              className="bg-transparent border-white text-white hover:bg-white hover:text-[#5c5c5c] transition-colors"
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
          <h2 className="text-3xl font-bold mb-2" style={{ color: '#5c5c5c' }}>
            Embark Flow Monitor
          </h2>
          <p className="text-gray-600">Welcome back, {user.fullName}! Monitor your system flows in real-time.</p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card className="border-l-4 hover:shadow-lg transition-shadow" style={{ borderLeftColor: '#a5b744' }}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Active Flows</CardTitle>
              <Activity className="h-5 w-5" style={{ color: '#a5b744' }} />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold" style={{ color: '#5c5c5c' }}>1,247</div>
              <p className="text-xs text-gray-500 mt-1">+12% from last hour</p>
            </CardContent>
          </Card>

          <Card className="border-l-4 hover:shadow-lg transition-shadow" style={{ borderLeftColor: '#6b9bd1' }}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Data Processed</CardTitle>
              <Database className="h-5 w-5" style={{ color: '#6b9bd1' }} />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold" style={{ color: '#5c5c5c' }}>2.4 TB</div>
              <p className="text-xs text-gray-500 mt-1">+8% from yesterday</p>
            </CardContent>
          </Card>

          <Card className="border-l-4 hover:shadow-lg transition-shadow" style={{ borderLeftColor: '#e67e22' }}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Performance</CardTitle>
              <Gauge className="h-5 w-5" style={{ color: '#e67e22' }} />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold" style={{ color: '#5c5c5c' }}>98.5%</div>
              <p className="text-xs text-gray-500 mt-1">System uptime</p>
            </CardContent>
          </Card>

          <Card className="border-l-4 hover:shadow-lg transition-shadow" style={{ borderLeftColor: '#27ae60' }}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Throughput</CardTitle>
              <TrendingUp className="h-5 w-5" style={{ color: '#27ae60' }} />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold" style={{ color: '#5c5c5c' }}>15.2K/s</div>
              <p className="text-xs text-gray-500 mt-1">Requests per second</p>
            </CardContent>
          </Card>
        </div>

        {/* Recent Activity */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle style={{ color: '#5c5c5c' }}>Recent Flow Activity</CardTitle>
            <CardDescription>Latest system flows and monitoring data</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[
                { id: 'F-2847', status: 'Active', type: 'Data Transfer', time: '2 min ago' },
                { id: 'F-2846', status: 'Completed', type: 'System Sync', time: '5 min ago' },
                { id: 'F-2845', status: 'Active', type: 'Analytics', time: '8 min ago' },
                { id: 'F-2844', status: 'Completed', type: 'Backup', time: '15 min ago' },
                { id: 'F-2843', status: 'Active', type: 'Data Transfer', time: '22 min ago' }
              ].map((flow) => (
                <div
                  key={flow.id}
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={`w-3 h-3 rounded-full ${
                        flow.status === 'Active' ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
                      }`}
                    />
                    <div>
                      <p className="font-medium" style={{ color: '#5c5c5c' }}>{flow.id}</p>
                      <p className="text-sm text-gray-500">{flow.type}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p
                      className={`text-sm font-medium ${
                        flow.status === 'Active' ? 'text-green-600' : 'text-gray-600'
                      }`}
                    >
                      {flow.status}
                    </p>
                    <p className="text-xs text-gray-500">{flow.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* System Information */}
        <Card>
          <CardHeader>
            <CardTitle style={{ color: '#5c5c5c' }}>System Information</CardTitle>
            <CardDescription>Current system status and configuration</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600 mb-1">Version</p>
                <p className="font-medium" style={{ color: '#5c5c5c' }}>1.0</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600 mb-1">User Role</p>
                <p className="font-medium" style={{ color: '#5c5c5c' }}>Administrator</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600 mb-1">Last Login</p>
                <p className="font-medium" style={{ color: '#5c5c5c' }}>Just now</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600 mb-1">Status</p>
                <p className="font-medium text-green-600">All Systems Operational</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>

      {/* Footer */}
      <footer className="bg-[#5c5c5c] mt-12 py-4">
        <div className="container mx-auto px-4 text-center text-white text-sm">
          <p>© 2025 Aster Technologies. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default Dashboard;
