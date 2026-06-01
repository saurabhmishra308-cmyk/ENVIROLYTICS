import React, { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Waves } from 'lucide-react';

const WaterLevelChart = ({ liveData, historicalData, isDarkMode }) => {
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
          <Waves className="h-5 w-5" style={{ color: '#27ae60' }} />
          Digital Water Level Recorder
        </CardTitle>
        <CardDescription className={textMuted}>Groundwater level (meters)</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-center mb-4">
          <span className="text-5xl font-bold" style={{ color: '#27ae60' }}>
            {liveData.waterLevel.toFixed(2)}
          </span>
          <span className={`text-xl ml-2 ${textMuted}`}>meters</span>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={historicalData}>
            <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? '#374151' : '#e5e7eb'} />
            <XAxis dataKey="day" stroke={isDarkMode ? '#9ca3af' : '#6b7280'} />
            <YAxis stroke={isDarkMode ? '#9ca3af' : '#6b7280'} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="level" fill="#27ae60" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
};

export default WaterLevelChart;
