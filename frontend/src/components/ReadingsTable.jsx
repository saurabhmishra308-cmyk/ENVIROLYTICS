import React from 'react';
import { Badge } from '../components/ui/badge';

const ReadingsTable = ({ readings }) => (
  <div className="overflow-x-auto">
    <table className="w-full">
      <thead>
        <tr className="border-b-2" style={{ borderColor: '#4a9fd8' }}>
          <th className="text-left p-3 font-semibold text-gray-900">Time</th>
          <th className="text-left p-3 font-semibold text-gray-900">Flow Rate (L/min)</th>
          <th className="text-left p-3 font-semibold text-gray-900">Volume (L)</th>
          <th className="text-left p-3 font-semibold text-gray-900">Status</th>
        </tr>
      </thead>
      <tbody>
        {readings.map((reading) => (
          <tr key={reading.id} className="border-b hover:bg-gray-50">
            <td className="p-3 font-medium text-gray-900">{reading.time}</td>
            <td className="p-3" style={{ color: '#4a9fd8' }}>{reading.flow}</td>
            <td className="p-3 text-gray-600">{reading.volume}</td>
            <td className="p-3">
              <Badge className={reading.status === 'Normal' ? 'bg-green-500' : 'bg-yellow-500'}>
                {reading.status}
              </Badge>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export default ReadingsTable;
