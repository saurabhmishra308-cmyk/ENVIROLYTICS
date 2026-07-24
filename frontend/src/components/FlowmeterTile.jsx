import React from 'react';
import { Badge } from './ui/badge';
import { cleanLabel } from '../utils/labels';

const fmtNumber = (n, d = 2) => {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('en-IN', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
};

const TotaliserCard = ({ label, value, isDarkMode, color }) => (
  <div className={`p-2 rounded ${isDarkMode ? 'bg-gray-900' : 'bg-gray-100'}`}>
    <p className={`text-[10px] uppercase tracking-wide ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>{label}</p>
    <p className="text-sm font-bold tabular-nums" style={{ color }}>{fmtNumber(value, 2)}<span className="text-[10px] ml-0.5 opacity-70">KL</span></p>
  </div>
);

/** Compact aggregate card for a flowmeter, showing m³/hr + hourly/weekly/monthly/yearly KL. */
export const FlowmeterTile = ({ agg, isDarkMode, color = '#4a9fd8', onClick }) => {
  const muted = isDarkMode ? 'text-gray-400' : 'text-gray-600';
  const text = isDarkMode ? 'text-white' : 'text-gray-900';
  const isLive = (agg.flow_rate_m3h || 0) > 0 || (agg.totaliser_forward_kl || 0) > 0;
  return (
    <div
      onClick={onClick}
      className={`p-4 rounded-lg border-2 ${isDarkMode ? 'bg-gray-800' : 'bg-white'} ${onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
      style={{ borderColor: isLive ? color : '#cbd5e1' }}
      data-testid={`flowmeter-tile-${agg.hardware_id}`}
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className={`font-bold ${text}`}>{cleanLabel(agg.label || agg.hardware_id)}</p>
          <p className={`text-xs ${muted}`}>{agg.hardware_id}</p>
        </div>
        <Badge className={isLive ? 'bg-green-500' : 'bg-gray-400'}>{isLive ? 'LIVE' : 'IDLE'}</Badge>
      </div>
      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-3xl font-bold" style={{ color }}>{fmtNumber(agg.flow_rate_m3h, 3)}</span>
        <span className={`text-sm ${muted}`}>m³/hr</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <TotaliserCard label="Hourly"  value={agg.consumption_kl?.hourly}  isDarkMode={isDarkMode} color={color} />
        <TotaliserCard label="Weekly"  value={agg.consumption_kl?.weekly}  isDarkMode={isDarkMode} color={color} />
        <TotaliserCard label="Monthly" value={agg.consumption_kl?.monthly} isDarkMode={isDarkMode} color={color} />
        <TotaliserCard label="Yearly"  value={agg.consumption_kl?.yearly}  isDarkMode={isDarkMode} color={color} />
      </div>
      {agg.totaliser_forward_kl > 0 && (
        <p className={`text-xs mt-2 ${muted}`}>Cumulative totaliser: <strong>{fmtNumber(agg.totaliser_forward_kl, 2)} KL</strong></p>
      )}
    </div>
  );
};

export default FlowmeterTile;
