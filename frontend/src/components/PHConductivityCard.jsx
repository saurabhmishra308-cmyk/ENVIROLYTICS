import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { TestTube } from 'lucide-react';

const PHConductivityCard = ({ liveData, isDarkMode }) => {
  const textColor = isDarkMode ? 'text-white' : 'text-gray-900';
  const textMuted = isDarkMode ? 'text-gray-400' : 'text-gray-600';
  const cardBg = isDarkMode ? 'bg-gray-800' : 'bg-white';
  const borderColor = isDarkMode ? 'border-gray-700' : 'border-gray-200';

  return (
    <Card className={`${cardBg} ${borderColor} border`}>
      <CardHeader>
        <CardTitle className={`flex items-center gap-2 ${textColor}`}>
          <TestTube className="h-5 w-5" style={{ color: '#8b5cf6' }} />
          pH & Conductivity Monitoring
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="text-center p-4 rounded-lg" style={{ backgroundColor: isDarkMode ? '#374151' : '#f3e8ff' }}>
            <p className={`text-sm mb-2 ${textMuted}`}>pH Level</p>
            <p className="text-4xl font-bold" style={{ color: '#8b5cf6' }}>{liveData.pH.toFixed(1)}</p>
            <p className="text-xs mt-1" style={{ color: '#6b7280' }}>Neutral range</p>
          </div>
          <div className="text-center p-4 rounded-lg" style={{ backgroundColor: isDarkMode ? '#374151' : '#dbeafe' }}>
            <p className={`text-sm mb-2 ${textMuted}`}>Conductivity</p>
            <p className="text-4xl font-bold" style={{ color: '#3b82f6' }}>{liveData.conductivity.toFixed(0)}</p>
            <p className="text-xs mt-1" style={{ color: '#6b7280' }}>µS/cm</p>
          </div>
        </div>
        <div className="h-2 bg-gradient-to-r from-red-500 via-green-500 to-blue-500 rounded-full" />
        <div className="flex justify-between mt-2 text-xs" style={{ color: '#6b7280' }}>
          <span>Acidic (0-6)</span>
          <span>Neutral (7)</span>
          <span>Alkaline (8-14)</span>
        </div>
      </CardContent>
    </Card>
  );
};

export default PHConductivityCard;
