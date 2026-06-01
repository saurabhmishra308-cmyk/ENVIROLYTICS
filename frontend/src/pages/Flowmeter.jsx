import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { isAuthenticated, getCurrentUser, mockLogout } from '../mockData';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { LogOut, ArrowLeft, Droplets, AlertCircle, Clock, Download } from 'lucide-react';
import FlowmeterLocation from '../components/FlowmeterLocation';
import ReadingsTable from '../components/ReadingsTable';

const Flowmeter = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [currentFlow, setCurrentFlow] = useState(125.8);
  const [totalVolume, setTotalVolume] = useState(45678.23);

  // Memoized flowmeter locations
  const flowmeters = useMemo(() => [
    { id: 'FM-001', location: 'ETP Inlet', status: 'Active', flow: 145.2, unit: 'L/min', temp: 24.5 },
    { id: 'FM-002', location: 'ETP Outlet', status: 'Active', flow: 138.7, unit: 'L/min', temp: 26.1 },
    { id: 'FM-003', location: 'WTP Main Line', status: 'Active', flow: 242.5, unit: 'L/min', temp: 22.8 },
    { id: 'FM-004', location: 'Irrigation System', status: 'Warning', flow: 89.3, unit: 'L/min', temp: 28.2 },
    { id: 'FM-005', location: 'Chemical Dosing', status: 'Active', flow: 12.8, unit: 'L/min', temp: 25.4 },
    { id: 'FM-006', location: 'Cooling Tower', status: 'Active', flow: 186.4, unit: 'L/min', temp: 31.2 },
  ], []);

  // Memoized recent readings
  const recentReadings = useMemo(() => [
    { id: 'reading_1', time: '14:45', flow: 142.5, volume: 8525, status: 'Normal' },
    { id: 'reading_2', time: '14:30', flow: 138.2, volume: 8310, status: 'Normal' },
    { id: 'reading_3', time: '14:15', flow: 145.8, volume: 8748, status: 'Normal' },
    { id: 'reading_4', time: '14:00', flow: 151.3, volume: 9078, status: 'High' },
    { id: 'reading_5', time: '13:45', flow: 135.7, volume: 8142, status: 'Normal' },
  ], []);

  const updateFlowData = useCallback(() => {
    setCurrentFlow(prev => {
      const change = (Math.random() - 0.5) * 10;
      return Math.max(80, Math.min(180, prev + change));
    });
    setTotalVolume(prev => prev + (Math.random() * 0.5));
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) {
      navigate('/');
      return;
    }
    
    setUser(getCurrentUser());

    // Simulate live flow rate updates
    const interval = setInterval(updateFlowData, 2000);

    return () => clearInterval(interval);
  }, [navigate, updateFlowData]);

  const handleLogout = useCallback(() => {
    mockLogout();
    navigate('/');
  }, [navigate]);

  if (!user) return null;

  return (\n    <div className=\"min-h-screen bg-gray-50\">\n      {/* Header */}\n      <header className=\"shadow-md bg-[#1a2332]\">\n        <div className=\"container mx-auto px-4 py-4 flex justify-between items-center\">\n          <div className=\"flex items-center gap-4\">\n            <Link to=\"/dashboard\">\n              <Button variant=\"ghost\" size=\"sm\" className=\"text-white hover:text-white hover:bg-white/10\">\n                <ArrowLeft className=\"h-4 w-4\" />\n              </Button>\n            </Link>\n            <div>\n              <h1 className=\"text-white font-bold text-xl tracking-wide\" style={{ color: '#4a9fd8' }}>ENVIROLYTICS</h1>\n              <p className=\"text-white text-[8px] tracking-wider\" style={{ opacity: 0.7 }}>SUSTAINABILITY PRIVATE LIMITED</p>\n            </div>\n          </div>\n          <div className=\"flex items-center gap-4\">\n            <div className=\"text-white text-sm\">\n              <p className=\"font-medium\">{user.fullName}</p>\n              <p className=\"text-gray-300 text-xs\">{user.username}</p>\n            </div>\n            <Button\n              onClick={handleLogout}\n              variant=\"outline\"\n              className=\"border-white text-white hover:text-white transition-colors\"\n              style={{ backgroundColor: '#f5a623', borderColor: '#f5a623' }}\n            >\n              <LogOut className=\"mr-2 h-4 w-4\" />\n              Logout\n            </Button>\n          </div>\n        </div>\n      </header>\n\n      {/* Main Content */}\n      <main className=\"container mx-auto px-4 py-8\">\n        {/* Page Header */}\n        <div className=\"mb-8\">\n          <div className=\"flex items-center gap-3 mb-2\">\n            <div className=\"p-3 rounded-lg\" style={{ backgroundColor: '#4a9fd8' }}>\n              <Droplets className=\"h-8 w-8 text-white\" />\n            </div>\n            <div>\n              <h2 className=\"text-3xl font-bold text-gray-900\">\n                Flowmeter Monitoring System\n              </h2>\n              <p className=\"text-gray-600\">Real-time water flow measurement and analytics</p>\n            </div>\n          </div>\n        </div>\n\n        {/* Live Monitoring Card */}\n        <div className=\"grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8\">\n          <Card className=\"lg:col-span-2 border-t-4\" style={{ borderTopColor: '#4a9fd8' }}>\n            <CardHeader>\n              <CardTitle className=\"flex items-center justify-between\">\n                <span className=\"text-gray-900\">Live Flow Rate - FM-001</span>\n                <Badge className=\"bg-green-500 text-white\">LIVE</Badge>\n              </CardTitle>\n              <CardDescription>ETP Inlet Pipeline - Real-time monitoring</CardDescription>\n            </CardHeader>\n            <CardContent>\n              <div className=\"text-center py-8\">\n                <div className=\"inline-flex items-baseline gap-2 mb-4\">\n                  <span className=\"text-7xl font-bold\" style={{ color: '#4a9fd8' }}>\n                    {currentFlow.toFixed(1)}\n                  </span>\n                  <span className=\"text-3xl font-semibold text-gray-600\">L/min</span>\n                </div>\n                <div className=\"grid grid-cols-3 gap-4 mt-8\">\n                  <div className=\"p-4 bg-blue-50 rounded-lg\">\n                    <p className=\"text-sm text-gray-600 mb-1\">Total Volume Today</p>\n                    <p className=\"text-2xl font-bold text-gray-900\">{totalVolume.toFixed(2)}</p>\n                    <p className=\"text-xs text-gray-500\">Liters</p>\n                  </div>\n                  <div className=\"p-4 bg-green-50 rounded-lg\">\n                    <p className=\"text-sm text-gray-600 mb-1\">Avg Flow Rate</p>\n                    <p className=\"text-2xl font-bold text-gray-900\">142.3</p>\n                    <p className=\"text-xs text-gray-500\">L/min</p>\n                  </div>\n                  <div className=\"p-4 bg-amber-50 rounded-lg\">\n                    <p className=\"text-sm text-gray-600 mb-1\">Uptime</p>\n                    <p className=\"text-2xl font-bold text-gray-900\">99.8%</p>\n                    <p className=\"text-xs text-gray-500\">Last 24h</p>\n                  </div>\n                </div>\n              </div>\n            </CardContent>\n          </Card>\n\n          <Card className=\"border-t-4\" style={{ borderTopColor: '#f5a623' }}>\n            <CardHeader>\n              <CardTitle className=\"text-gray-900\">System Status</CardTitle>\n              <CardDescription>Overall system health</CardDescription>\n            </CardHeader>\n            <CardContent className=\"space-y-4\">\n              <div className=\"flex items-center justify-between p-3 bg-green-50 rounded-lg\">\n                <div className=\"flex items-center gap-2\">\n                  <div className=\"w-3 h-3 bg-green-500 rounded-full animate-pulse\" />\n                  <span className=\"font-medium text-gray-900\">Active Meters</span>\n                </div>\n                <span className=\"text-lg font-bold text-green-600\">5</span>\n              </div>\n              <div className=\"flex items-center justify-between p-3 bg-yellow-50 rounded-lg\">\n                <div className=\"flex items-center gap-2\">\n                  <AlertCircle className=\"w-4 h-4 text-amber-600\" />\n                  <span className=\"font-medium text-gray-900\">Warnings</span>\n                </div>\n                <span className=\"text-lg font-bold text-amber-600\">1</span>\n              </div>\n              <div className=\"flex items-center justify-between p-3 bg-gray-50 rounded-lg\">\n                <div className=\"flex items-center gap-2\">\n                  <Clock className=\"w-4 h-4 text-gray-600\" />\n                  <span className=\"font-medium text-gray-900\">Last Update</span>\n                </div>\n                <span className=\"text-sm font-medium text-gray-600\">2 sec ago</span>\n              </div>\n              <div className=\"pt-4\">\n                <Button className=\"w-full\" style={{ backgroundColor: '#4a9fd8' }}>\n                  <Download className=\"mr-2 h-4 w-4\" />\n                  Export Report\n                </Button>\n              </div>\n            </CardContent>\n          </Card>\n        </div>\n\n        {/* All Flowmeters Grid */}\n        <Card className=\"mb-8\">\n          <CardHeader>\n            <CardTitle className=\"text-gray-900\">All Flowmeter Locations</CardTitle>\n            <CardDescription>Real-time monitoring across all installation points</CardDescription>\n          </CardHeader>\n          <CardContent>\n            <div className=\"grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4\">\n              {flowmeters.map((meter) => (\n                <FlowmeterLocation key={meter.id} meter={meter} isDarkMode={false} />\n              ))}\n            </div>\n          </CardContent>\n        </Card>\n\n        {/* Recent Readings Table */}\n        <Card>\n          <CardHeader>\n            <CardTitle className=\"text-gray-900\">Recent Readings - FM-001</CardTitle>\n            <CardDescription>Historical data from the last hour</CardDescription>\n          </CardHeader>\n          <CardContent>\n            <ReadingsTable readings={recentReadings} />\n          </CardContent>\n        </Card>\n      </main>\n\n      {/* Footer */}\n      <footer className=\"mt-12 py-4 bg-[#1a2332]\">\n        <div className=\"container mx-auto px-4 text-center text-white text-sm\">\n          <p>© 2025 Envirolytics Sustainability Private Limited. All rights reserved.</p>\n        </div>\n      </footer>\n    </div>\n  );\n};\n\nexport default Flowmeter;
