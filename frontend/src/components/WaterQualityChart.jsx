import React, { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { FlaskConical } from 'lucide-react';

const WaterQualityChart = ({ liveData, isDarkMode }) => {
  const textColor = isDarkMode ? 'text-white' : 'text-gray-900';
  const textMuted = isDarkMode ? 'text-gray-400' : 'text-gray-600';
  const cardBg = isDarkMode ? 'bg-gray-800' : 'bg-white';
  const borderColor = isDarkMode ? 'border-gray-700' : 'border-gray-200';

  const tooltipStyle = useMemo(() => ({
    backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
    border: '1px solid #e5e7eb'
  }), [isDarkMode]);

  const waterQualityData = useMemo(() => [
    { parameter: 'pH', value: liveData.pH, standard: 7.0, id: 'param_ph' },
    { parameter: 'BOD', value: liveData.bod, standard: 10, id: 'param_bod' },
    { parameter: 'COD', value: liveData.cod, standard: 40, id: 'param_cod' },
    { parameter: 'TSS', value: liveData.tss, standard: 20, id: 'param_tss' }
  ], [liveData]);

  return (
    <Card className={`mb-6 ${cardBg} ${borderColor} border`}>
      <CardHeader>
        <CardTitle className={`flex items-center gap-2 ${textColor}`}>
          <FlaskConical className="h-5 w-5" style={{ color: '#ec4899' }} />
          Water Quality Parameters - BOD, COD, TSS
        </CardTitle>
        <CardDescription className={textMuted}>Comparison with standard limits</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={waterQualityData}>
                <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? '#374151' : '#e5e7eb'} />
                <XAxis dataKey="parameter" stroke={isDarkMode ? '#9ca3af' : '#6b7280'} />
                <YAxis stroke={isDarkMode ? '#9ca3af' : '#6b7280'} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend />
                <Bar dataKey="value" fill="#ec4899" name="Current Value" />
                <Bar dataKey="standard" fill="#6b7280" name="Standard Limit" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-lg" style={{ backgroundColor: isDarkMode ? '#374151' : '#fce7f3' }}>
              <p className={`text-xs mb-1 ${textMuted}`}>BOD</p>
              <p className="text-3xl font-bold" style={{ color: '#ec4899' }}>{liveData.bod.toFixed(1)}</p>
              <p className="text-xs" style={{ color: '#6b7280' }}>mg/L</p>
            </div>
            <div className="p-4 rounded-lg" style={{ backgroundColor: isDarkMode ? '#374151' : '#e0e7ff' }}>
              <p className={`text-xs mb-1 ${textMuted}`}>COD</p>
              <p className="text-3xl font-bold" style={{ color: '#6366f1' }}>{liveData.cod.toFixed(1)}</p>
              <p className="text-xs" style={{ color: '#6b7280' }}>mg/L</p>
            </div>
            <div className="p-4 rounded-lg" style={{ backgroundColor: isDarkMode ? '#374151' : '#dcfce7' }}>
              <p className={`text-xs mb-1 ${textMuted}`}>TSS</p>
              <p className="text-3xl font-bold" style={{ color: '#10b981' }}>{liveData.tss.toFixed(1)}</p>
              <p className="text-xs" style={{ color: '#6b7280' }}>mg/L</p>
            </div>
            <div className="p-4 rounded-lg" style={{ backgroundColor: isDarkMode ? '#374151' : '#fef3c7' }}>
              <p className={`text-xs mb-1 ${textMuted}`}>Compliance</p>
              <p className="text-3xl font-bold" style={{ color: '#10b981' }}>98%</p>
              <p className="text-xs" style={{ color: '#6b7280' }}>Overall</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default WaterQualityChart;
