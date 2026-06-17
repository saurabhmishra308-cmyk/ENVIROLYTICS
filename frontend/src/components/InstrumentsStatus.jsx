import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';

const InstrumentsStatus = ({ instruments, isDarkMode }) => {
  const textColor = isDarkMode ? 'text-white' : 'text-gray-900';
  const cardBg = isDarkMode ? 'bg-gray-800' : 'bg-white';
  const borderColor = isDarkMode ? 'border-gray-700' : 'border-gray-200';

  return (
    <Card className={`mb-6 ${cardBg} ${borderColor} border`}>
      <CardHeader>
        <CardTitle className={`flex items-center justify-between ${textColor}`}>
          <span>Site Instruments Status</span>
          <Badge className="bg-green-500">{instruments.length} Total</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {instruments.map((instrument) => (
            <div
              key={instrument.id}
              className={`p-3 rounded-lg border-2 ${isDarkMode ? 'bg-gray-700' : 'bg-gray-50'}`}
              style={{
                borderColor: instrument.status === 'active' ? '#10b981' : '#ef4444'
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className={`text-sm font-semibold ${textColor}`}>{instrument.name}</span>
                <div
                  className={`w-3 h-3 rounded-full ${
                    instrument.status === 'active' ? 'bg-green-500 animate-pulse' : 'bg-red-500'
                  }`}
                />
              </div>
              <p className="text-xs" style={{ color: '#6b7280' }}>{instrument.location}</p>
              <Badge
                className={`mt-2 text-xs ${
                  instrument.status === 'active' ? 'bg-green-500' : 'bg-red-500'
                }`}
              >
                {instrument.status.toUpperCase()}
              </Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default InstrumentsStatus;
