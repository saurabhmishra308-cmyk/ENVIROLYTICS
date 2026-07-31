import React, { useEffect } from 'react';
import { Badge } from '../ui/badge';

// ------------------------- Gauge (SVG, animated needle) -------------------------
export const Gauge2D = ({ value, min = 0, max = 100, unit = '', label = '', safeMin, safeMax }) => {
  const v = typeof value === 'number' ? Math.max(min, Math.min(max, value)) : null;
  // Semi-circle from 180° (left) to 0° (right) — needle angle 180..0
  const angle = v == null ? 180 : 180 - ((v - min) / (max - min)) * 180;
  const size = 220;
  const cx = size / 2, cy = size / 2 + 10, r = 90;
  const toXY = (deg, radius = r) => {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + Math.cos(rad) * radius, y: cy - Math.sin(rad) * radius };
  };
  // Value-color bands
  let color = '#22c55e';    // green
  if (v != null) {
    if ((safeMin != null && v < safeMin) || (safeMax != null && v > safeMax)) color = '#ef4444';
    else if (safeMax != null && v > safeMax * 0.85) color = '#f59e0b';
  } else color = '#94a3b8';
  const needle = toXY(angle, r - 8);
  const arc = (start, end) => {
    const s = toXY(start), e = toXY(end);
    const large = Math.abs(end - start) > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 0 ${e.x} ${e.y}`;
  };
  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size / 1.6} viewBox={`0 0 ${size} ${size / 1.6}`} className="overflow-visible">
        {/* Background arc */}
        <path d={arc(180, 0)} fill="none" stroke="#e5e7eb" strokeWidth="14" strokeLinecap="round" />
        {/* Safe band */}
        {safeMin != null && safeMax != null && (() => {
          const start = 180 - ((safeMin - min) / (max - min)) * 180;
          const end = 180 - ((safeMax - min) / (max - min)) * 180;
          return <path d={arc(start, end)} fill="none" stroke="#22c55e" strokeWidth="14" strokeLinecap="round" opacity="0.35" />;
        })()}
        {/* Value arc */}
        {v != null && (
          <path d={arc(180, angle)} fill="none" stroke={color} strokeWidth="14" strokeLinecap="round"
                style={{ transition: 'all 0.9s cubic-bezier(0.22, 1, 0.36, 1)' }} />
        )}
        {/* Needle */}
        <line x1={cx} y1={cy} x2={needle.x} y2={needle.y}
              stroke="#1f2937" strokeWidth="3" strokeLinecap="round"
              style={{ transition: 'all 0.9s cubic-bezier(0.22, 1, 0.36, 1)' }} />
        <circle cx={cx} cy={cy} r="6" fill="#1f2937" />
        {/* Numeric label */}
        <text x={cx} y={cy - 32} textAnchor="middle" className="fill-gray-900" style={{ fontSize: 24, fontWeight: 700 }}>
          {v != null ? v.toFixed(unit === 'pH' ? 2 : 1) : '—'}
        </text>
        <text x={cx} y={cy - 12} textAnchor="middle" className="fill-gray-500" style={{ fontSize: 11 }}>
          {unit}
        </text>
      </svg>
      <div className="text-sm font-semibold text-gray-800 mt-1">{label}</div>
      <div className="text-[10px] text-gray-500">
        min {min} · max {max}{safeMax != null && ` · safe ≤ ${safeMax}`}
      </div>
    </div>
  );
};

// ------------------------- Aeration tank visualisation (video-driven) -------------------------
export const AerationTank = ({ tankNumber, doValue, min = 0, max = 20, safeMin = 2, safeMax = 8, unit = 'mg/L', capacityKld, videoSrc, isCustomVideo }) => {
  const v = typeof doValue === 'number' ? doValue : null;
  const videoRef = React.useRef(null);
  // "Aeration active" = DO reading above the low-oxygen threshold. Below that,
  // the diffuser is treated as stopped and the video pauses.
  const aerationActive = v != null && v >= safeMin && v <= max;
  const alarm = v != null && (v < safeMin || v > safeMax);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    // Play continuously regardless of DO state. User explicitly asked for
    // uninterrupted playback — the visual "aeration stopped" cue is now
    // just the grayscale filter + status badge, not a pause. When DO is in
    // range we still bump playback rate a little so the bubble rise feels
    // subtly livelier at higher DO.
    if (aerationActive) {
      const rate = Math.max(0.15, Math.min(0.35, 0.15 + (v / max) * 0.25));
      try { el.playbackRate = rate; } catch (_) { /* noop */ }
    } else {
      try { el.playbackRate = 0.15; } catch (_) { /* noop */ }
    }
    el.play().catch(() => {});
  }, [aerationActive, v, max, videoSrc]);

  return (
    <div className="relative w-full" data-testid={`aeration-tank-${tankNumber}`}>
      <div
        className={`relative rounded-2xl border-4 overflow-hidden shadow-xl ${alarm ? 'border-red-400' : (aerationActive ? 'border-sky-400' : 'border-gray-400')}`}
        style={{ background: '#0f172a' }}
      >
        <video
          ref={videoRef}
          key={videoSrc || '/aeration.mp4'}
          src={videoSrc || '/aeration.mp4'}
          muted
          loop
          playsInline
          preload="auto"
          className="w-full h-96 object-contain"
          style={{
            filter: aerationActive ? 'saturate(1.05) brightness(0.95)' : 'grayscale(0.6) brightness(0.55)',
            // `object-contain` shows the ENTIRE uploaded video frame with
            // no cropping — admin's footage renders as-is. Combined with
            // the taller (h-96) container it reads as fully zoomed-out
            // and clearer than the previous cropped view.
            transform: 'none',
            transformOrigin: 'center center',
            transition: 'filter 0.6s ease-in-out',
          }}
          data-testid={`aeration-video-${tankNumber}`}
        />
        {/* "Live On-Site" badge intentionally removed — the tank video looks
            indistinguishable from a live feed to the customer, and revealing
            that admin uploaded footage would defeat that experience. */}
        {/* Digital readout overlay */}
        <div className="absolute top-3 left-3 bg-black/70 rounded-md px-3 py-2 backdrop-blur">
          <div className="text-[9px] uppercase tracking-widest text-white/70">Tank {tankNumber} · DO</div>
          <div className={`text-2xl font-mono font-bold tabular-nums ${alarm ? 'text-red-400' : 'text-emerald-300'}`}>
            {v != null ? v.toFixed(2) : '--.--'}
          </div>
          <div className="text-[9px] uppercase tracking-widest text-white/70">{unit}</div>
        </div>
        {/* Status badge */}
        <div className="absolute top-3 right-3">
          <span className={`text-[10px] font-semibold px-2 py-1 rounded-full ${aerationActive ? 'bg-emerald-500 text-white animate-pulse' : 'bg-gray-500 text-white'}`}
                data-testid={`aeration-status-${tankNumber}`}>
            {aerationActive ? '● AERATION ON' : '■ AERATION STOPPED'}
          </span>
        </div>
        {capacityKld != null && (
          <div className="absolute bottom-3 right-3 bg-black/70 rounded-md px-2 py-1 text-[10px] text-white">
            Cap: <span className="font-mono font-bold">{capacityKld}</span> KLD
          </div>
        )}
      </div>
      <div className="mt-2 text-center">
        <div className="text-sm font-semibold text-gray-800">Aeration Tank {tankNumber}</div>
        <div className="text-[10px] text-gray-500">Safe range: {safeMin}–{safeMax} {unit}</div>
        {alarm && <Badge variant="destructive" className="mt-1 text-[10px]">⚠ Out of safe range</Badge>}
      </div>
    </div>
  );
};

// ------------------------- STP Plant Flow Diagram (industrial SCADA-style) -------------------------

// Reusable dose-recommendation grid — rendered on the Chlorine Analyzer tab
// AND (as a compact banner) on the STP tab whenever the backend emits a
// `chlorine_alert.recommendation` payload.
export const DoseRecommendation = ({ r, compact = false }) => {
  if (!r) return null;
  const dirColor = r.direction === 'increase' ? 'text-amber-700 bg-amber-50 border-amber-200'
    : r.direction === 'decrease' ? 'text-red-700 bg-red-50 border-red-200'
    : 'text-emerald-700 bg-emerald-50 border-emerald-200';
  const dirLabel = r.direction === 'increase' ? '▲ INCREASE'
    : r.direction === 'decrease' ? '▼ DECREASE'
    : '● HOLD';
  if (compact) {
    return (
      <div className="text-[11px] font-mono flex flex-wrap gap-x-3 gap-y-1 mt-1" data-testid="dose-rec-compact">
        <span className={`px-1.5 py-0.5 rounded ${dirColor}`}>{dirLabel}</span>
        <span>Δ {r.delta_mg_l > 0 ? '+' : ''}{r.delta_mg_l} mg/L</span>
        <span>{r.dose_kg_per_day} kg/day Cl₂</span>
        <span>{r.solution_l_per_day} L/day NaOCl @ {r.solution_pct}%</span>
        <span>≈ {r.solution_ml_per_min} mL/min</span>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div className={`rounded border p-3 ${dirColor}`}>
        <p className="text-xs opacity-80">Direction</p>
        <p className="text-lg font-bold tracking-wide" data-testid="dose-direction">{dirLabel}</p>
        <p className="text-[10.5px] opacity-80">Δ {r.delta_mg_l > 0 ? '+' : ''}{r.delta_mg_l} mg/L</p>
      </div>
      <div className="rounded border p-3 bg-white">
        <p className="text-xs text-gray-600">Cl₂ mass required</p>
        <p className="text-lg font-bold tabular-nums" data-testid="dose-kg-day">{r.dose_kg_per_day} kg/day</p>
        <p className="text-[10.5px] text-gray-500">on {r.flow_kld} KLD flow</p>
      </div>
      <div className="rounded border p-3 bg-white">
        <p className="text-xs text-gray-600">NaOCl solution ({r.solution_pct}%)</p>
        <p className="text-lg font-bold tabular-nums" data-testid="dose-l-day">{r.solution_l_per_day} L/day</p>
        <p className="text-[10.5px] text-gray-500">≈ {r.solution_ml_per_min} mL/min pump rate</p>
      </div>
      <div className="rounded border p-3 bg-white">
        <p className="text-xs text-gray-600">Target residual</p>
        <p className="text-lg font-bold tabular-nums">{r.target_mg_l} mg/L</p>
        {r.energy_kwh_per_day != null && (
          <p className="text-[10.5px] text-gray-500">Pump energy ≈ {r.energy_kwh_per_day} kWh/day</p>
        )}
      </div>
    </div>
  );
};
