import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Cloud, Thermometer, Droplet, Wind, CloudRain, Activity, Navigation } from 'lucide-react';

const WeatherItem = ({ Icon, color, label, value, subtext, bgColor, textMuted, textColor }) => (
  <div className="p-4 rounded-lg" style={{ backgroundColor: bgColor }}>
    <div className="flex items-center gap-2 mb-2">
      <Icon className="h-5 w-5" style={{ color }} />
      <span className={`text-sm ${textMuted}`}>{label}</span>
    </div>
    <p className={`text-2xl font-bold ${textColor}`}>{value}</p>
    {subtext && <p className="text-xs text-gray-500">{subtext}</p>}
  </div>
);

const WeatherCard = ({ weather, loading, isDarkMode, getWaterFlowDirection }) => {
  const textColor = isDarkMode ? 'text-white' : 'text-gray-900';
  const textMuted = isDarkMode ? 'text-gray-400' : 'text-gray-600';
  const cardBg = isDarkMode ? 'bg-gray-800' : 'bg-white';
  const borderColor = isDarkMode ? 'border-gray-700' : 'border-gray-200';

  const weatherItems = useMemo(() => {
    if (!weather) return [];
    
    return [
      {
        id: 'weather_temp',
        Icon: Thermometer,
        color: '#ef4444',
        label: 'Temperature',
        value: weather.main?.temp ? `${weather.main.temp.toFixed(1)}°C` : 'N/A',
        subtext: weather.main?.feels_like ? `Feels like ${weather.main.feels_like.toFixed(1)}°C` : '',
        bgColor: isDarkMode ? '#374151' : '#dbeafe'
      },
      {
        id: 'weather_humidity',
        Icon: Droplet,
        color: '#3b82f6',
        label: 'Humidity',
        value: weather.main?.humidity ? `${weather.main.humidity}%` : 'N/A',
        subtext: 'Relative humidity',
        bgColor: isDarkMode ? '#374151' : '#e0f2fe'
      },
      {
        id: 'weather_wind',
        Icon: Wind,
        color: '#10b981',
        label: 'Wind Speed',
        value: weather.wind?.speed ? `${weather.wind.speed.toFixed(1)} m/s` : 'N/A',
        subtext: weather.wind?.deg ? `Direction: ${weather.wind.deg}°` : '',
        bgColor: isDarkMode ? '#374151' : '#dcfce7'
      },
      {
        id: 'weather_rain',
        Icon: CloudRain,
        color: '#6366f1',
        label: 'Rainfall',
        value: `${weather.rain?.['1h'] || 0} mm`,
        subtext: 'Last 1 hour',
        bgColor: isDarkMode ? '#374151' : '#e0e7ff'
      },
      {
        id: 'weather_pressure',
        Icon: Activity,
        color: '#f59e0b',
        label: 'Pressure',
        value: weather.main?.pressure ? `${weather.main.pressure} hPa` : 'N/A',
        subtext: 'Atmospheric',
        bgColor: isDarkMode ? '#374151' : '#fef3c7'
      },
      {
        id: 'weather_flow',
        Icon: Navigation,
        color: '#ec4899',
        label: 'Water Flow Dir',
        value: getWaterFlowDirection(),
        subtext: 'Underground',
        bgColor: isDarkMode ? '#374151' : '#fce7f3'
      }
    ];
  }, [weather, isDarkMode, getWaterFlowDirection]);

  if (loading) {
    return (
      <Card className={`mb-6 ${cardBg} ${borderColor} border`}>
        <CardHeader>
          <CardTitle className={`flex items-center gap-2 ${textColor}`}>
            <Cloud className="h-5 w-5" />
            Live Weather Data - Lucknow
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className={textMuted}>Loading weather data...</p>
        </CardContent>
      </Card>
    );
  }

  if (!weather) {
    return (
      <Card className={`mb-6 ${cardBg} ${borderColor} border`}>
        <CardHeader>
          <CardTitle className={`flex items-center gap-2 ${textColor}`}>
            <Cloud className="h-5 w-5" />
            Live Weather Data - Lucknow
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className={textMuted}>Weather data unavailable</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`mb-6 ${cardBg} ${borderColor} border`}>
      <CardHeader>
        <CardTitle className={`flex items-center gap-2 ${textColor}`}>
          <Cloud className="h-5 w-5" />
          Live Weather Data - Lucknow
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {weatherItems.map((item) => (
            <WeatherItem
              key={item.id}
              Icon={item.Icon}
              color={item.color}
              label={item.label}
              value={item.value}
              subtext={item.subtext}
              bgColor={item.bgColor}
              textMuted={textMuted}
              textColor={textColor}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default WeatherCard;
