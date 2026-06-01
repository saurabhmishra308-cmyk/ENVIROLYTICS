import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Map as MapIcon, MapPin, Layers } from 'lucide-react';

const Zone = () => {
  const zones = [
    { id: 1, name: 'North Zone', sites: 2, area: '150 km²', status: 'Active', coverage: '85%' },
    { id: 2, name: 'South Zone', sites: 1, area: '120 km²', status: 'Active', coverage: '90%' },
    { id: 3, name: 'East Zone', sites: 1, area: '100 km²', status: 'Active', coverage: '78%' },
    { id: 4, name: 'West Zone', sites: 1, area: '130 km²', status: 'Inactive', coverage: '65%' },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Zone Management</h1>
        <p className="text-gray-600 mt-1">Manage geographical zones and coverage areas</p>
      </div>

      {/* Zone Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Zones</p>
                <p className="text-3xl font-bold">4</p>
              </div>
              <Layers className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Coverage Area</p>
                <p className="text-3xl font-bold">500 km²</p>
              </div>
              <MapIcon className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Active Zones</p>
                <p className="text-3xl font-bold text-green-600">3</p>
              </div>
              <MapPin className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Avg Coverage</p>
                <p className="text-3xl font-bold text-blue-600">80%</p>
              </div>
              <MapIcon className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Zones Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {zones.map((zone) => (
          <Card key={zone.id} className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{zone.name}</CardTitle>
                <Badge className={zone.status === 'Active' ? 'bg-green-500' : 'bg-gray-500'}>
                  {zone.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <span className="text-sm text-gray-600">Sites</span>
                  <span className="font-semibold">{zone.sites}</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <span className="text-sm text-gray-600">Area</span>
                  <span className="font-semibold">{zone.area}</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <span className="text-sm text-gray-600">Coverage</span>
                  <span className="font-semibold text-blue-600">{zone.coverage}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default Zone;
