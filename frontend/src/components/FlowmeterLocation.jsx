import React, { useMemo } from 'react';
import { Badge } from '../components/ui/badge';

const FlowmeterLocation = ({ meter, isDarkMode }) => {
  const textColor = isDarkMode ? 'text-white' : 'text-gray-900';
  
  return (
    <div
      className="p-4 rounded-lg border-2 hover:shadow-md transition-all cursor-pointer"
      style={{ 
        borderColor: meter.status === 'Active' ? '#4a9fd8' : '#f5a623',
        backgroundColor: meter.status === 'Active' ? (isDarkMode ? '#1e3a5f' : '#f0f8ff') : (isDarkMode ? '#3d2f1f' : '#fff8f0')
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <span className={`font-bold ${textColor}`}>{meter.id}</span>
        <Badge className={meter.status === 'Active' ? 'bg-green-500' : 'bg-yellow-500'}>
          {meter.status}
        </Badge>
      </div>
      <p className="text-sm text-gray-600 mb-3">{meter.location}</p>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">Flow Rate</span>
          <span className="text-lg font-bold" style={{ color: '#4a9fd8' }}>
            {meter.flow} {meter.unit}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">Temperature</span>
          <span className={`text-sm font-medium ${textColor}`}>
            {meter.temp}°C
          </span>
        </div>
      </div>
    </div>
  );
};

export default FlowmeterLocation;
