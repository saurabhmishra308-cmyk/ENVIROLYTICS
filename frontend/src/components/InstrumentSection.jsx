import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Badge } from '../components/ui/badge';

/**
 * A dashboard section grouping one or more instrument types under a category.
 * Props:
 *   - title: 'Water Abstraction' | 'Water Level' | 'Water Quality'
 *   - subtitle: short description
 *   - color: hex accent
 *   - icon: lucide icon component
 *   - tiles: array of {hardware_id, label, value, unit, status, meta}
 *   - emptyText: shown when tiles is empty
 *   - isDarkMode: boolean
 *   - testId: stable test id
 */
const InstrumentSection = ({
  title,
  subtitle,
  color = '#4a9fd8',
  icon: Icon,
  tiles = [],
  emptyText = 'No live data',
  isDarkMode = false,
  testId,
}) => {
  const textColor = isDarkMode ? 'text-white' : 'text-gray-900';
  const muted = isDarkMode ? 'text-gray-400' : 'text-gray-600';
  const cardBg = isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white';

  const liveCount = tiles.filter((t) => t.status === 'active').length;

  return (
    <Card className={`border-t-4 ${cardBg}`} style={{ borderTopColor: color }} data-testid={testId}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg" style={{ backgroundColor: color }}>
              {Icon && <Icon className="h-5 w-5 text-white" />}
            </div>
            <div>
              <CardTitle className={textColor}>{title}</CardTitle>
              <CardDescription className={muted}>{subtitle}</CardDescription>
            </div>
          </div>
          <Badge className={liveCount > 0 ? 'bg-green-500' : 'bg-gray-400'}>
            {liveCount} / {tiles.length || 0} live
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {tiles.length === 0 ? (
          <p className={`text-center py-6 text-sm ${muted}`}>{emptyText}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {tiles.map((t) => (
              <div
                key={`${t.label}-${t.hardware_id || 'pending'}`}
                data-testid={`tile-${t.label.toLowerCase()}-${t.hardware_id || 'pending'}`}
                className={`p-3 rounded-lg border-2 ${isDarkMode ? 'bg-gray-700' : 'bg-gray-50'}`}
                style={{ borderColor: t.status === 'active' ? '#10b981' : '#cbd5e1' }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-sm font-semibold ${textColor}`}>{t.label}</span>
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: t.status === 'active' ? '#10b981' : '#94a3b8' }}
                  />
                </div>
                <p className="text-2xl font-bold" style={{ color }}>
                  {t.value != null ? t.value : '—'}
                  {t.unit && <span className="text-base ml-1 text-gray-500">{t.unit}</span>}
                </p>
                <p className={`text-xs ${muted}`}>
                  {t.hardware_id ? `${t.hardware_id}` : 'No device'}
                  {t.meta ? ` · ${t.meta}` : ''}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default InstrumentSection;
