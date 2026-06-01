import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const GraphReport = () => {
  const hourlyData = Array.from({ length: 24 }, (_, i) => ({
    hour: `${i}:00`,
    flow: Math.random() * 50 + 80,
    pressure: Math.random() * 20 + 60,
  }));

  const dailyData = Array.from({ length: 30 }, (_, i) => ({
    day: `Day ${i + 1}`,
    flow: Math.random() * 200 + 800,
    quality: Math.random() * 10 + 85,
  }));

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Graph Reports</h1>
        <p className="text-gray-600 mt-1">Visual representation of monitoring data</p>
      </div>

      {/* Hourly Trends */}
      <Card>
        <CardHeader>
          <CardTitle>24-Hour Flow & Pressure Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={hourlyData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="hour" />
              <YAxis yAxisId="left" />
              <YAxis yAxisId="right" orientation="right" />
              <Tooltip />
              <Legend />
              <Line yAxisId="left" type="monotone" dataKey="flow" stroke="#4a9fd8" strokeWidth={2} name="Flow (L/min)" />
              <Line yAxisId="right" type="monotone" dataKey="pressure" stroke="#a3b744" strokeWidth={2} name="Pressure (bar)" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Daily Trends */}
      <Card>
        <CardHeader>
          <CardTitle>30-Day Flow Volume & Quality</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={350}>
            <AreaChart data={dailyData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" />
              <YAxis yAxisId="left" />
              <YAxis yAxisId="right" orientation="right" />
              <Tooltip />
              <Legend />
              <Area yAxisId="left" type="monotone" dataKey="flow" stroke="#4a9fd8" fill="#4a9fd8" fillOpacity={0.6} name="Flow (m³)" />
              <Area yAxisId="right" type="monotone" dataKey="quality" stroke="#27ae60" fill="#27ae60" fillOpacity={0.4} name="Quality Score" />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
};

export default GraphReport;
