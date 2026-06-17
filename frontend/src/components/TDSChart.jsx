import React, { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Beaker } from 'lucide-react';

const TDSChart = ({ liveData, historicalData, isDarkMode }) => {
  const textColor = isDarkMode ? 'text-white' : 'text-gray-900';
  const textMuted = isDarkMode ? 'text-gray-400' : 'text-gray-600';
  const cardBg = isDarkMode ? 'bg-gray-800' : 'bg-white';
  const borderColor = isDarkMode ? 'border-gray-700' : 'border-gray-200';

  const tooltipStyle = useMemo(() => ({
    backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
    border: '1px solid #e5e7eb'
  }), [isDarkMode]);

  const dotStyle = useMemo(() => ({ fill: '#f59e0b', r: 5 }), []);

  return (
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
          <LineChart data={historicalData}>
            <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? '#374151' : '#e5e7eb'} />
            <XAxis dataKey="time" stroke={isDarkMode ? '#9ca3af' : '#6b7280'} fontSize={12} />
            <YAxis stroke={isDarkMode ? '#9ca3af' : '#6b7280'} />
            <Tooltip contentStyle={tooltipStyle} />
            <Line type="monotone" dataKey="tds" stroke="#f59e0b" strokeWidth={3} dot={dotStyle} />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
};

export default TDSChart;
