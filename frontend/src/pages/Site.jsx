import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { MapPin, Activity, AlertTriangle } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend } from 'recharts';

const Site = () => {
  const sites = [
    { id: 1, name: 'ETP Plant A', location: 'Lucknow', status: 'Online', devices: 5, lastUpdate: '2 mins ago' },
    { id: 2, name: 'WTP Facility B', location: 'Kanpur', status: 'Online', devices: 3, lastUpdate: '5 mins ago' },
    { id: 3, name: 'Treatment Center C', location: 'Noida', status: 'Online', devices: 4, lastUpdate: '1 min ago' },
    { id: 4, name: 'Processing Unit D', location: 'Ghaziabad', status: 'Offline', devices: 2, lastUpdate: '2 hours ago' },
    { id: 5, name: 'Monitoring Station E', location: 'Agra', status: 'Offline', devices: 3, lastUpdate: '3 hours ago' },
  ];

  const statusData = [
    { name: 'Online', value: 3, color: '#a3b744' },
    { name: 'Offline', value: 2, color: '#6b7280' },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Site Management</h1>
        <p className="text-gray-600 mt-1">Monitor and manage all site locations</p>
      </div>

      {/* Site Status Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>All Sites</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {sites.map((site) => (
                <div key={site.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                  <div className="flex items-center gap-4">
                    <MapPin className="h-5 w-5 text-blue-600" />
                    <div>
                      <h3 className="font-semibold text-gray-900">{site.name}</h3>
                      <p className="text-sm text-gray-600">{site.location}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-sm font-medium">{site.devices} Devices</p>
                      <p className="text-xs text-gray-500">{site.lastUpdate}</p>
                    </div>
                    <Badge className={site.status === 'Online' ? 'bg-green-500' : 'bg-gray-500'}>
                      {site.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Site Status</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {statusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
              <div className="text-center mt-4">
                <p className="text-3xl font-bold">3/5</p>
                <p className="text-sm text-gray-600">Sites Online</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quick Stats</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Total Sites</span>
                <span className="text-lg font-bold">5</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Total Devices</span>
                <span className="text-lg font-bold">17</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Active Monitoring</span>
                <span className="text-lg font-bold text-green-600">15</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Site;
