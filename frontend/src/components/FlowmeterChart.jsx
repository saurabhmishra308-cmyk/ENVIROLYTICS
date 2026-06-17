import React, { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Droplets } from 'lucide-react';

const FlowmeterChart = ({ liveData, historicalData, isDarkMode }) => {
  const textColor = isDarkMode ? 'text-white' : 'text-gray-900';
  const textMuted = isDarkMode ? 'text-gray-400' : 'text-gray-600';
  const cardBg = isDarkMode ? 'bg-gray-800' : 'bg-white';
  const borderColor = isDarkMode ? 'border-gray-700' : 'border-gray-200';

  const tooltipStyle = useMemo(() => ({
    backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
    border: '1px solid #e5e7eb'
  }), [isDarkMode]);

  return (
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
          <AreaChart data={historicalData}>
            <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? '#374151' : '#e5e7eb'} />
            <XAxis dataKey="time" stroke={isDarkMode ? '#9ca3af' : '#6b7280'} />
            <YAxis stroke={isDarkMode ? '#9ca3af' : '#6b7280'} />
            <Tooltip contentStyle={tooltipStyle} />
            <Area type="monotone" dataKey="value" stroke="#4a9fd8" fill="#4a9fd8" fillOpacity={0.6} />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
};

export default FlowmeterChart;
