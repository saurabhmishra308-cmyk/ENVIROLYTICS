import React, { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './ui/card';
import { CloudRain, Droplet, TrendingUp } from 'lucide-react';
import api from '../lib/api';

/**
 * "RWH Recharge" tile — renders next to the DWLR (Water Level) section on
 * the dashboard. Pulls estimated groundwater recharge from
 * `/api/rwh/recharge` which multiplies:
 *   catchment area (m²) · runoff coefficient · Open-Meteo daily rainfall (mm)
 *
 * Degrades gracefully when the client hasn't yet filled catchment area /
 * coordinates — surfaces a hint pointing to Customer Profile.
 */
export default function RwhRechargeTile({ isDarkMode }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: res } = await api.get('/api/rwh/recharge?past_days=30');
        if (!cancelled) setData(res);
      } catch (e) {
        if (!cancelled) setErr(e?.response?.data?.detail || 'Unable to fetch recharge estimate');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const text = isDarkMode ? 'text-white' : 'text-gray-900';
  const muted = isDarkMode ? 'text-gray-400' : 'text-gray-500';

  return (
    <Card
      className={`border-t-4 ${isDarkMode ? 'bg-gray-800 border-gray-700' : ''}`}
      style={{ borderTopColor: '#0ea5e9' }}
      data-testid="section-rwh-recharge"
    >
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg" style={{ backgroundColor: '#0ea5e9' }}>
            <CloudRain className="h-5 w-5 text-white" />
          </div>
          <div>
            <CardTitle className={text}>Rainwater Recharge Estimate</CardTitle>
            <CardDescription className={muted}>
              Live from local rainfall × catchment area × runoff coefficient — placed alongside DWLR groundwater levels
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className={`text-sm ${muted}`}>Loading recharge estimate…</p>
        ) : err ? (
          <p className="text-sm text-red-600">{err}</p>
        ) : !data?.available ? (
          <div className={`text-sm ${muted}`}>
            <p>{data?.reason || 'Recharge estimate unavailable.'}</p>
            <p className="mt-1 text-xs">
              Add <strong>catchment area (m²)</strong> and <strong>runoff coefficient</strong> in
              <a href="/customer-profile" className="text-blue-600 hover:underline ml-1">Customer Profile → Rainwater harvesting</a>.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" data-testid="rwh-recharge-tiles">
              <div className={`rounded-xl p-3 ring-1 ${isDarkMode ? 'bg-white/5 ring-white/10' : 'bg-sky-50 ring-sky-100'}`}>
                <p className={`text-[10px] uppercase tracking-widest ${muted}`}>Today</p>
                <p className={`text-2xl font-bold tabular-nums ${text}`} data-testid="rwh-today-litres">
                  {(data.today?.recharge_litres || 0).toLocaleString()}<span className="text-sm font-normal ml-1">L</span>
                </p>
                <p className={`text-[11px] ${muted}`}>
                  Rain: <strong>{data.today?.rainfall_mm ?? 0} mm</strong>
                </p>
              </div>
              <div className={`rounded-xl p-3 ring-1 ${isDarkMode ? 'bg-white/5 ring-white/10' : 'bg-blue-50 ring-blue-100'}`}>
                <p className={`text-[10px] uppercase tracking-widest ${muted}`}>Past 7 days</p>
                <p className={`text-2xl font-bold tabular-nums ${text}`} data-testid="rwh-week-kl">
                  {(data.past_7_days?.total_kl || 0).toLocaleString()}<span className="text-sm font-normal ml-1">KL</span>
                </p>
                <p className={`text-[11px] ${muted}`}>
                  ≈ {(data.past_7_days?.total_litres || 0).toLocaleString()} L
                </p>
              </div>
              <div className={`rounded-xl p-3 ring-1 ${isDarkMode ? 'bg-white/5 ring-white/10' : 'bg-indigo-50 ring-indigo-100'}`}>
                <p className={`text-[10px] uppercase tracking-widest ${muted}`}>Past 30 days</p>
                <p className={`text-2xl font-bold tabular-nums ${text}`} data-testid="rwh-month-kl">
                  {(data.past_30_days?.total_kl || 0).toLocaleString()}<span className="text-sm font-normal ml-1">KL</span>
                </p>
                <p className={`text-[11px] ${muted}`}>
                  ≈ {(data.past_30_days?.total_litres || 0).toLocaleString()} L
                </p>
              </div>
            </div>
            <div className={`flex flex-wrap gap-3 text-[11px] pt-1 ${muted}`}>
              <span className="flex items-center gap-1"><Droplet className="h-3 w-3" /> Catchment: <strong>{data.catchment_area_sqm} m²</strong></span>
              <span className="flex items-center gap-1"><TrendingUp className="h-3 w-3" /> Runoff coeff: <strong>{data.runoff_coefficient}</strong></span>
              {data.structure_count > 0 && (
                <span>Structures: <strong>{data.structure_count}</strong></span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
