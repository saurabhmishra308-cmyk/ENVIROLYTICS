import React, { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, WifiOff } from 'lucide-react';
import api from '../lib/api';

const POLL_MS = 60 * 1000; // re-check every 60 seconds
const THRESHOLD_HOURS = 2;

const fmtAgo = (mins) => {
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hrs < 24) return rem ? `${hrs}h ${rem}m ago` : `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h ago`;
};

const labelFor = (d) =>
  d.kind === 'flowmeter'
    ? `Flowmeter · ${d.hardware_id}`
    : `${(d.instrument_type || 'device').toUpperCase()} · ${d.hardware_id}`;

const OfflineAlertsBanner = ({ isDarkMode }) => {
  const [items, setItems] = useState([]);
  const [error, setError] = useState(false);

  const fetchOffline = useCallback(async () => {
    try {
      const { data } = await api.get(`/api/alerts/offline?hours=${THRESHOLD_HOURS}`);
      setItems(data?.offline || []);
      setError(false);
    } catch (e) {
      if (process.env.NODE_ENV === 'development') console.error('[offline-alerts]', e);
      setError(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      fetchOffline();
    };
    const t = setTimeout(tick, 0);
    const i = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
      clearInterval(i);
    };
  }, [fetchOffline]);

  if (error || items.length === 0) return null;

  const max = 6;
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;

  return (
    <div
      data-testid="offline-alerts-banner"
      className={`rounded-lg border-2 px-4 py-3 flex items-start gap-3 ${
        isDarkMode ? 'bg-red-950/40 border-red-700 text-red-100' : 'bg-red-50 border-red-300 text-red-900'
      }`}
    >
      <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0 text-red-500" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm" data-testid="offline-alerts-title">
          {items.length} device{items.length === 1 ? '' : 's'} offline · no data for ≥ {THRESHOLD_HOURS} hours
        </p>
        <ul className="mt-1.5 space-y-1 text-xs">
          {shown.map((d) => (
            <li
              key={`${d.kind}-${d.instrument_type}-${d.hardware_id}`}
              data-testid={`offline-alert-item-${d.hardware_id}`}
              className="flex items-center gap-2"
            >
              <WifiOff className="h-3 w-3 shrink-0 opacity-70" />
              <span className="font-medium">{labelFor(d)}</span>
              <span className="opacity-75">— last seen {fmtAgo(d.minutes_since_last_seen)}</span>
            </li>
          ))}
          {rest > 0 && (
            <li className="opacity-75 italic" data-testid="offline-alerts-more">
              …and {rest} more
            </li>
          )}
        </ul>
      </div>
    </div>
  );
};

export default OfflineAlertsBanner;
