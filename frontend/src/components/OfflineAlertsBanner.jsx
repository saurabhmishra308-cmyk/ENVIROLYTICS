import React, { useEffect, useState, useCallback } from 'react';
import { Radio, ShieldAlert, AlertOctagon } from 'lucide-react';
import api from '../lib/api';

const POLL_MS = 60 * 1000;
const THRESHOLD_HOURS = 2;

const TYPE_META = {
  flowmeter:    { label: 'Flowmeter',    accent: '#4a9fd8' },
  dwlr:         { label: 'DWLR',         accent: '#27ae60' },
  ph:           { label: 'pH',           accent: '#8e44ad' },
  tds:          { label: 'TDS',          accent: '#16a085' },
  conductivity: { label: 'Conductivity', accent: '#2980b9' },
};

const metaFor = (d) => {
  const key = d.kind === 'flowmeter' ? 'flowmeter' : (d.instrument_type || '').toLowerCase();
  return TYPE_META[key] || { label: (d.instrument_type || 'Device').toUpperCase(), accent: '#94a3b8' };
};

const OfflineAlertsBanner = ({ isDarkMode }) => {
  const [items, setItems] = useState([]);
  const [breaches, setBreaches] = useState([]);
  const [error, setError] = useState(false);

  const fetchAlerts = useCallback(async () => {
    try {
      const [offlineRes, breachRes] = await Promise.all([
        api.get(`/api/alerts/offline?hours=${THRESHOLD_HOURS}`),
        api.get('/api/alerts/limit-breaches').catch(() => ({ data: { breaches: [] } })),
      ]);
      setItems(offlineRes?.data?.offline || []);
      setBreaches(breachRes?.data?.breaches || []);
      setError(false);
    } catch (e) {
      if (process.env.NODE_ENV === 'development') console.error('[alerts]', e);
      setError(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = () => { if (!cancelled) fetchAlerts(); };
    const t = setTimeout(tick, 0);
    const i = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearTimeout(t); clearInterval(i); };
  }, [fetchAlerts]);

  if (error || (items.length === 0 && breaches.length === 0)) return null;

  const surface       = isDarkMode ? 'bg-[#1a2332]'        : 'bg-white';
  const border        = isDarkMode ? 'border-red-900/60'   : 'border-red-200';
  const headlineText  = isDarkMode ? 'text-red-100'        : 'text-red-900';
  const subText       = isDarkMode ? 'text-red-300/80'     : 'text-red-700/80';
  const chipBg        = isDarkMode ? 'bg-red-950/60'       : 'bg-red-50';
  const chipText      = isDarkMode ? 'text-red-100'        : 'text-red-900';
  const idText        = isDarkMode ? 'text-red-200/70'     : 'text-red-700/70';

  const totalCount = items.length + breaches.length;

  return (
    <section
      data-testid="offline-alerts-banner"
      className={`relative overflow-hidden rounded-xl border ${border} ${surface} shadow-sm`}
      aria-live="polite"
    >
      {/* Red severity rail */}
      <div className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-red-500 to-red-700" />

      <div className="pl-6 pr-5 py-4 sm:py-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="relative">
              <span className="absolute inline-flex h-full w-full rounded-full bg-red-500/40 animate-ping" />
              <span className="relative flex items-center justify-center w-9 h-9 rounded-full bg-red-600 shadow-md">
                <ShieldAlert className="h-4.5 w-4.5 text-white" aria-hidden />
              </span>
            </div>
            <div>
              <p className={`text-[10px] uppercase tracking-[0.18em] font-semibold ${subText}`}>
                Telemetry alert
              </p>
              <h3
                data-testid="offline-alerts-title"
                className={`text-base sm:text-lg font-semibold ${headlineText}`}
              >
                {items.length > 0 && (
                  <span>{items.length} device{items.length === 1 ? '' : 's'} offline</span>
                )}
                {items.length > 0 && breaches.length > 0 && <span> · </span>}
                {breaches.length > 0 && (
                  <span>{breaches.length} limit breach{breaches.length === 1 ? '' : 'es'}</span>
                )}
              </h3>
            </div>
          </div>

          <span
            className={`inline-flex items-center gap-1.5 self-start sm:self-auto px-2.5 py-1 rounded-full text-[11px] font-medium uppercase tracking-wider ${chipBg} ${chipText} ring-1 ring-red-300/40`}
          >
            <Radio className="h-3 w-3" />
            {totalCount} active
          </span>
        </div>

        {items.length > 0 && (
          <ul
            className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2"
            data-testid="offline-alerts-list"
          >
            {items.map((d) => {
              const m = metaFor(d);
              return (
                <li
                  key={`${d.kind}-${d.instrument_type}-${d.hardware_id}`}
                  data-testid={`offline-alert-item-${d.hardware_id}`}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg ${chipBg} ring-1 ring-inset ring-red-200/30`}
                >
                  <span
                    className="inline-block w-1.5 h-8 rounded-sm shrink-0"
                    style={{ backgroundColor: m.accent }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className={`text-[10px] uppercase tracking-widest font-semibold ${subText}`}>
                      {m.label}
                    </p>
                    <p className={`text-sm font-medium truncate ${chipText}`} title={d.hardware_id}>
                      {d.hardware_id}
                    </p>
                  </div>
                  <span
                    className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md ring-1 ring-red-400/40 ${idText}`}
                  >
                    {d.never_reported ? 'No data' : 'Offline'}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {breaches.length > 0 && (
          <ul
            className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2"
            data-testid="limit-breach-list"
          >
            {breaches.map((b) => (
              <li
                key={`limit-${b.hardware_id}-${b.kind}`}
                data-testid={`limit-breach-${b.hardware_id}`}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg ${chipBg} ring-1 ring-inset ring-red-200/30`}
              >
                <AlertOctagon className="h-5 w-5 shrink-0 text-red-600" />
                <div className="min-w-0 flex-1">
                  <p className={`text-[10px] uppercase tracking-widest font-semibold ${subText}`}>
                    {b.kind === 'exceeded' ? 'Limit exceeded' : 'Below minimum'}
                  </p>
                  <p className={`text-sm font-medium truncate ${chipText}`} title={b.label}>
                    {b.label} — {b.consumption_kl_this_month.toFixed(2)} / {b.kind === 'exceeded' ? b.monthly_limit_kl : b.min_limit_kl} KL
                  </p>
                </div>
                <span
                  className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md ring-1 ring-red-400/40 ${idText}`}
                >
                  {b.kind === 'exceeded' ? 'Over' : 'Under'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};

export default OfflineAlertsBanner;
