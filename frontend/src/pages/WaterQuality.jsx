import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { toast } from 'sonner';
import { Droplets, Gauge, FlaskConical, Wind, Download, FileText, Loader2, RefreshCw, Video, AlertCircle, ShieldCheck } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import api, { formatApiError, backendAssetUrl } from '../lib/api';
import { isAdmin as _isAdmin } from '../mockData';
import { LiveCameraWidget } from '../components/LiveCameraWidget';
import { STPConfigDialog } from '../components/STPConfigDialog';
import { AerationVideoUploader } from '../components/AerationVideoUploader';
import { DOTankConfigDialog } from '../components/DOTankConfigDialog';
import { FlowmeterTile } from '../components/FlowmeterTile';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { cleanLabel } from '../utils/labels';

// ------------------------- Gauge (SVG, animated needle) -------------------------
const Gauge2D = ({ value, min = 0, max = 100, unit = '', label = '', safeMin, safeMax }) => {
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
const AerationTank = ({ tankNumber, doValue, min = 0, max = 20, safeMin = 2, safeMax = 8, unit = 'mg/L', capacityKld, videoSrc, isCustomVideo }) => {
  const v = typeof doValue === 'number' ? doValue : null;
  const videoRef = React.useRef(null);
  // "Aeration active" = DO reading above the low-oxygen threshold. Below that,
  // the diffuser is treated as stopped and the video pauses.
  const aerationActive = v != null && v >= safeMin && v <= max;
  const alarm = v != null && (v < safeMin || v > safeMax);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (aerationActive) {
      // Very slow, meditative playback — user asked for "very slow movement".
      // Range: 0.15× (low O2) → 0.35× (high O2). Even the fastest is well below
      // normal speed so bubble rise looks tranquil.
      const rate = Math.max(0.15, Math.min(0.35, 0.15 + (v / max) * 0.25));
      try { el.playbackRate = rate; } catch (_) { /* noop */ }
      el.play().catch(() => {});
    } else {
      try { el.pause(); } catch (_) { /* noop */ }
    }
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
          className="w-full h-56 object-cover"
          style={{
            filter: aerationActive ? 'saturate(1.05) brightness(0.95)' : 'grayscale(0.6) brightness(0.55)',
            // 25% more zoom on top of the previous 1.25 → 1.5625× (≈ +55% overall).
            transform: 'scale(1.5625)',
            transformOrigin: 'center center',
            transition: 'filter 0.6s ease-in-out, transform 0.6s ease-in-out',
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
const DoseRecommendation = ({ r, compact = false }) => {
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

const STPPlantDiagram = ({ values = {}, unit = 'mg/L', plantCapacityKld, deviceLabel, lastReceivedAt, stpUnitConfig = {}, stpDerived = {}, onEditConfig, canManage = false }) => {
  const cod = typeof values.COD === 'number' ? values.COD : null;
  const bod = typeof values.BOD === 'number' ? values.BOD : null;
  const tss = typeof values.TSS === 'number' ? values.TSS : null;
  const ph  = typeof values.PH === 'number'  ? values.PH  : null;
  const doVal = typeof values.DO === 'number' ? values.DO : null;
  const tds = typeof values.TDS === 'number' ? values.TDS : null;
  const orp = typeof values.ORP === 'number' ? values.ORP : null;
  const turb = typeof values.TURBIDITY === 'number' ? values.TURBIDITY : (typeof values.Turbidity === 'number' ? values.Turbidity : null);

  const fmtTime = (iso) => {
    if (!iso) return '--:--';
    try { return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }); }
    catch (_) { return '--:--'; }
  };
  const stamp = fmtTime(lastReceivedAt || new Date().toISOString());

  // Colour palette matching the reference image exactly
  const CARDS = [
    { key: 'PH',  label: 'pH Value',  value: ph,  fmt: (v) => v.toFixed(1),          bg: '#3730a3' }, // indigo
    { key: 'TSS', label: 'TSS Value', value: tss, fmt: (v) => v.toFixed(0),          bg: '#c2410c' }, // orange-700
    { key: 'BOD', label: 'BOD Value', value: bod, fmt: (v) => v.toFixed(0),          bg: '#166534' }, // green-800
    { key: 'COD', label: 'COD Value', value: cod, fmt: (v) => v.toFixed(0),          bg: '#a16207' }, // yellow-700 / amber
  ];

  // Configured unit values, falling back to "—" until admin fills them in.
  const cfg = stpUnitConfig || {};
  const blowers = cfg.air_blowers || [];
  const ffp = cfg.filter_feed_pump || {};
  const gf = cfg.gardening_flushing || {};
  const gardeningKld = stpDerived?.gardening_flushing_kld_today;
  const energyKwh = stpDerived?.energy_kwh_per_day;
  const energyMode = stpDerived?.energy_mode || 'auto';

  return (
    <div id={`scada-snapshot-${deviceLabel || 'stp'}`} className="relative w-full bg-white rounded-xl p-4 border border-slate-200" data-testid="stp-plant-diagram">
      <style>{`
        @keyframes stpFlow  { 0% { stroke-dashoffset: 40; } 100% { stroke-dashoffset: 0; } }
        @keyframes stpRotate { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        @keyframes stpBubbles { 0% { cy: 220; opacity: 0; } 20% { opacity: 1; } 100% { cy: 170; opacity: 0; } }
        @keyframes stpBlink { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
      `}</style>

      {/* ─────────────── Header: 4 colored value cards + Water Quality summary ─────────────── */}
      <div className="flex flex-col xl:flex-row gap-3 mb-5">
        {/* Left: 4 value cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 flex-1">
          {CARDS.map((c) => (
            <div
              key={c.key}
              className="rounded shadow-md text-white overflow-hidden"
              style={{ background: c.bg }}
              data-testid={`stp-card-${c.key.toLowerCase()}`}
            >
              <div className="grid grid-cols-[1fr_auto] items-center border-b border-white/25">
                <div className="px-3 py-2 text-xs font-medium">{c.label} -</div>
                <div className="px-4 py-2 text-lg font-semibold tabular-nums min-w-[64px] text-center">
                  {c.value != null ? c.fmt(c.value) : '0'}
                </div>
              </div>
              <div className="grid grid-cols-[1fr_auto] items-center">
                <div className="px-3 py-1.5 text-[11px] opacity-90">Last Data On -</div>
                <div className="px-4 py-1.5 text-xs font-mono tabular-nums opacity-95">{stamp}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Right: Water Quality summary box */}
        <div className="xl:w-[220px] rounded border border-slate-300 bg-white shadow-sm p-2" data-testid="stp-wq-summary">
          <div className="text-[10px] text-slate-600 font-semibold text-center border-b border-slate-200 pb-1 mb-1">Water Quality</div>
          <table className="w-full text-[10px] leading-4">
            <tbody>
              {[
                { k: 'pH', v: ph, unit: '', danger: ph != null && (ph < 6.5 || ph > 8.5) },
                { k: 'TDS (in ppm)', v: tds, unit: '', danger: tds != null && tds > 500 },
                { k: 'ORP (in mV)', v: orp, unit: '', danger: false },
                { k: 'Turbidity (in NTU)', v: turb, unit: '', danger: false },
                { k: 'TSS (in ppm)', v: tss, unit: '', danger: tss != null && tss > 100 },
                { k: 'BOD (in mg/L)', v: bod, unit: '', danger: bod != null && bod > 30 },
                { k: 'COD (in mg/L)', v: cod, unit: '', danger: cod != null && cod > 250 },
                { k: 'DO (in mg/L)', v: doVal, unit: '', danger: doVal != null && doVal < 2 },
              ].map((row) => (
                <tr key={row.k}>
                  <td className="text-slate-700 pr-1 whitespace-nowrap">{row.k} :</td>
                  <td className={`text-right font-mono tabular-nums ${row.danger ? 'text-red-600' : 'text-slate-900'}`}>
                    {row.v != null ? Number(row.v).toString() : '0'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─────────────── Plant capacity banner ─────────────── */}
      <div className="flex items-center justify-between text-xs text-slate-600 mb-2 px-1">
        <div>
          <span className="font-semibold text-slate-800">{deviceLabel || 'STP Plant'}</span>
          {plantCapacityKld != null && (
            <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 font-mono text-[11px]" data-testid="stp-plant-capacity">
              Capacity: <b>{plantCapacityKld}</b> KLD
            </span>
          )}
        </div>
        <div className="text-[10px] text-slate-500 font-mono">Live plant schematic · SCADA view</div>
      </div>

      {/* ─────────────── SCADA-style plant diagram ─────────────── */}
      <div className="overflow-x-auto border border-slate-200 rounded-lg bg-white">
        <svg viewBox="0 0 1440 480" className="w-full min-w-[1360px]" xmlns="http://www.w3.org/2000/svg">
          {/* Backdrop grid to feel like an SCADA HMI */}
          <defs>
            <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#f1f5f9" strokeWidth="0.5" />
            </pattern>
            <linearGradient id="waterFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#7dd3fc" />
              <stop offset="100%" stopColor="#0369a1" />
            </linearGradient>
            <linearGradient id="tankBrown" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e5d3b3" />
              <stop offset="100%" stopColor="#a68a64" />
            </linearGradient>
            <marker id="arrGreen" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#22c55e" />
            </marker>
            <marker id="arrBlue" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#0284c7" />
            </marker>
          </defs>
          <rect width="1440" height="480" fill="url(#grid)" />

          {/* ── Top output rail (green — treated water to Gardening + Cooling Tower) ── */}
          <path d="M 1090 55 L 1090 260 L 1330 260 L 1330 55" fill="none" stroke="#16a34a" strokeWidth="3" />
          <path d="M 1200 55 L 1200 260 L 1420 260 L 1420 55" fill="none" stroke="#16a34a" strokeWidth="3" />
          {/* Destination labels */}
          <g>
            <rect x="1055" y="30" width="80" height="28" rx="3" fill="#ffffff" stroke="#16a34a" strokeWidth="1.5" />
            <text x="1095" y="49" textAnchor="middle" fontSize="12" fill="#065f46" fontWeight="600">Gardening</text>
          </g>
          <g>
            <rect x="1370" y="30" width="100" height="28" rx="3" fill="#ffffff" stroke="#16a34a" strokeWidth="1.5" />
            <text x="1420" y="49" textAnchor="middle" fontSize="12" fill="#065f46" fontWeight="600">Cooling Tower</text>
          </g>

          {/* Flow particles on green rail */}
          <g stroke="#22c55e" strokeWidth="1" fill="none" strokeDasharray="6 8" style={{ animation: 'stpFlow 1.2s linear infinite' }}>
            <path d="M 1090 60 L 1090 260 L 1420 260 L 1420 60" />
          </g>

          {/* ═════════════════ STAGE 1: Bar Screen ═════════════════ */}
          <g transform="translate(20, 300)">
            <rect x="0" y="0" width="20" height="70" fill="#fef3c7" stroke="#a16207" strokeWidth="1" />
            {[8, 18, 28, 38, 48, 58].map((y) => (
              <line key={y} x1="4" y1={y} x2="16" y2={y - 4} stroke="#78350f" strokeWidth="1.5" />
            ))}
            <text x="10" y="88" textAnchor="middle" fontSize="9" fill="#475569" fontWeight="500">Bar</text>
            <text x="10" y="99" textAnchor="middle" fontSize="9" fill="#475569" fontWeight="500">Screen</text>
          </g>

          {/* Blue inlet pipe */}
          <path d="M 42 335 L 90 335" stroke="#0284c7" strokeWidth="4" markerEnd="url(#arrBlue)"  fill="none" />

          {/* ═════════════════ STAGE 2: Equalization Tank ═════════════════ */}
          <Tank x={95} y={280} w={110} h={110} name="Equalization Tank" fillLevel={0} capacityKld={cfg.equalization_tank_kld} />

          {/* Sewage Transfer Pump 1 (top-side pump) */}
          <PumpBadge x={165} y={215} label="Sewage Transfer&#10;Pump - 1" flowKld={cfg.equalization_tank_kld} />
          {/* Pipe from Equalization → up → across to blowers/aeration */}
          <path d="M 200 335 L 240 335" stroke="#0284c7" strokeWidth="4"  fill="none" />
          <path d="M 200 300 L 200 260 L 285 260" stroke="#0284c7" strokeWidth="4"  fill="none" />

          {/* ═════════════════ STAGE 3: Air Blowers (up to 3× — driven by config) ═════════════════ */}
          {[0, 1, 2].map((i) => {
            const b = blowers[i] || {};
            const xs = [240, 310, 380][i];
            return (
              <AirBlower
                key={i}
                x={xs}
                y={355}
                label={b.label || `Air Blower - ${i + 1}`}
                capacity={b.capacity_m3ph}
                powerKw={b.power_kw}
              />
            );
          })}

          {/* Air pipes running above blowers into aeration diffuser */}
          <path d="M 260 355 L 260 300 L 480 300" stroke="#94a3b8" strokeWidth="2" strokeDasharray="4 3"  fill="none" />
          <path d="M 330 355 L 330 300" stroke="#94a3b8" strokeWidth="2" strokeDasharray="4 3"  fill="none" />
          <path d="M 400 355 L 400 300" stroke="#94a3b8" strokeWidth="2" strokeDasharray="4 3"  fill="none" />

          {/* ═════════════════ STAGE 4: MBBR / Aeration Tank ═════════════════ */}
          <g transform="translate(460, 280)">
            <rect x="0" y="0" width="130" height="110" fill="url(#tankBrown)" stroke="#78350f" strokeWidth="1.5" />
            {/* Water fill */}
            <rect x="4" y="20" width="122" height="86" fill="#a5b4fc" opacity="0.7" />
            {/* Diffuser plate */}
            <rect x="10" y="98" width="110" height="4" fill="#334155" />
            {/* Air bubbles */}
            {[15, 30, 45, 60, 75, 90, 105].map((x, i) => (
              <g key={x}>
                <circle cx={x} cy={85 - (i % 3) * 15} r={2.5} fill="#38bdf8" style={{ animation: `stpBubbles 2.${(i*2)%9}s ease-in ${(i*0.2)}s infinite` }} />
                <circle cx={x + 5} cy={70 - (i % 4) * 10} r={2} fill="#7dd3fc" style={{ animation: `stpBubbles 2.${(i*3)%9}s ease-in ${(i*0.35)}s infinite` }} />
              </g>
            ))}
            {/* MBBR floating media carriers — small green rings suspended in the middle of the tank */}
            {[
              [22, 55], [38, 70], [55, 55], [72, 65], [90, 55], [108, 68],
              [30, 40], [50, 45], [70, 42], [92, 40], [110, 48],
            ].map(([cx, cy], i) => (
              <g key={`mbbr-${i}`} opacity="0.9">
                <circle cx={cx} cy={cy} r="4" fill="none" stroke="#059669" strokeWidth="1.2" />
                <circle cx={cx} cy={cy} r="1.5" fill="#10b981" />
              </g>
            ))}
            <text x="65" y="128" textAnchor="middle" fontSize="10" fill="#1e293b" fontWeight="600">MBBR / Aeration Tank</text>
            {cfg.aeration_tank_kld != null && (
              <g>
                <rect x="4" y="4" width="60" height="16" rx="2" fill="#78350f" stroke="#ffffff" strokeWidth="0.75" />
                <text x="34" y="15" textAnchor="middle" fontSize="10" fill="#ffffff" fontWeight="700" fontFamily="monospace">{cfg.aeration_tank_kld} KLD</text>
              </g>
            )}
          </g>

          {/* Sludge Transfer pumps (mid, above pipe) */}
          <PumpBadge x={615} y={230} label="Sludge Transfer&#10;Pump - 1" flowKld={cfg.settling_tank_kld} />
          <PumpBadge x={685} y={230} label="Sludge Transfer&#10;Pump - 2" flowKld={cfg.settling_tank_kld} />

          {/* Aeration → Settling pipe */}
          <path d="M 590 335 L 640 335" stroke="#0284c7" strokeWidth="4" markerEnd="url(#arrBlue)"  fill="none" />

          {/* ═════════════════ STAGE 5: Settling Tank (trapezoid clarifier) ═════════════════ */}
          <g transform="translate(645, 285)">
            <path d="M 0 0 L 90 0 L 70 85 L 20 85 Z" fill="#93c5fd" stroke="#1d4ed8" strokeWidth="1.5" />
            <path d="M 4 4 L 86 4 L 68 78 L 22 78 Z" fill="#dbeafe" opacity="0.7" />
            <line x1="10" y1="8" x2="80" y2="8" stroke="#1e293b" strokeWidth="1.5" />
            <text x="45" y="108" textAnchor="middle" fontSize="10" fill="#1e293b" fontWeight="600">Settling Tank</text>
            {cfg.settling_tank_kld != null && (
              <g>
                <rect x="15" y="30" width="60" height="14" fill="#ffffff" stroke="#1d4ed8" strokeWidth="0.75" />
                <text x="45" y="41" textAnchor="middle" fontSize="9" fill="#1e40af" fontWeight="700" fontFamily="monospace">{cfg.settling_tank_kld} KLD</text>
              </g>
            )}
          </g>

          {/* Settling → Filter Feed */}
          <path d="M 735 335 L 785 335" stroke="#0284c7" strokeWidth="4" markerEnd="url(#arrBlue)"  fill="none" />

          {/* Sludge Dewatering — draws sludge from the Settling Tank base and outputs a dried
              cake. Placed below/beside the clarifier to show the sludge-line branch. */}
          <g transform="translate(645, 415)">
            {/* Sludge line from clarifier base */}
            <path d="M 30 -20 L 30 5" stroke="#78350f" strokeWidth="2.5" strokeDasharray="4 3" fill="none" />
            {/* Body */}
            <rect x="0" y="5" width="88" height="42" rx="3" fill="#fef3c7" stroke="#a16207" strokeWidth="1.5" />
            {/* Belt-press rollers */}
            <circle cx="18" cy="26" r="7" fill="#e5d3b3" stroke="#78350f" strokeWidth="1.2" style={{ transformOrigin: '18px 26px', animation: 'stpRotate 6s linear infinite' }} />
            <circle cx="42" cy="26" r="7" fill="#e5d3b3" stroke="#78350f" strokeWidth="1.2" style={{ transformOrigin: '42px 26px', animation: 'stpRotate 6s linear infinite' }} />
            <rect x="9" y="19" width="42" height="14" fill="none" stroke="#78350f" strokeWidth="1" />
            {/* Cake output arrow */}
            <path d="M 70 26 L 96 26" stroke="#a16207" strokeWidth="3" markerEnd="url(#arrBlue)" fill="none" />
            <text x="44" y="60" textAnchor="middle" fontSize="9" fill="#78350f" fontWeight="600">Sludge Dewatering</text>
            <text x="102" y="24" fontSize="8" fill="#78350f" fontWeight="600">Cake</text>
          </g>

          {/* UV Disinfection — violet tube placed on the treated-water rail between
              the Filter Feed Tank and PSF/ACF filter train. Displayed as a horizontal
              cylinder with two glowing UV lamps inside. */}
          <g transform="translate(895, 240)">
            <rect x="0" y="0" width="72" height="20" rx="10" fill="#faf5ff" stroke="#7c3aed" strokeWidth="1.5" />
            {/* UV lamps */}
            <line x1="8" y1="10" x2="66" y2="10" stroke="#a855f7" strokeWidth="2.5" strokeDasharray="4 2" style={{ animation: 'stpBlink 1.8s ease-in-out infinite' }} />
            <text x="36" y="35" textAnchor="middle" fontSize="9" fill="#6b21a8" fontWeight="700">UV Disinfection</text>
            {/* Inflow / outflow arrows */}
            <path d="M -12 10 L 0 10" stroke="#7c3aed" strokeWidth="2.5" markerEnd="url(#arrBlue)" fill="none" />
            <path d="M 72 10 L 88 10" stroke="#7c3aed" strokeWidth="2.5" markerEnd="url(#arrBlue)" fill="none" />
          </g>

          {/* Chlorine Dosing — small yellow hexagon dosing station downstream of UV.
              A vertical dosing line drips into the treated-water flow. */}
          <g transform="translate(990, 220)">
            {/* Chemical tank */}
            <rect x="0" y="0" width="30" height="30" rx="2" fill="#fef08a" stroke="#a16207" strokeWidth="1.4" />
            <rect x="3" y="8" width="24" height="20" fill="#fde047" opacity="0.7" />
            <text x="15" y="22" textAnchor="middle" fontSize="9" fill="#78350f" fontWeight="800">Cl₂</text>
            {/* Dosing pipe → flow rail */}
            <path d="M 15 30 L 15 60" stroke="#a16207" strokeWidth="2" strokeDasharray="3 2" fill="none" />
            <circle cx="15" cy="62" r="1.6" fill="#a16207">
              <animate attributeName="cy" values="60;68;60" dur="1.4s" repeatCount="indefinite" />
            </circle>
            <text x="15" y="80" textAnchor="middle" fontSize="9" fill="#78350f" fontWeight="700">Chlorine</text>
            <text x="15" y="90" textAnchor="middle" fontSize="8" fill="#78350f">Dosing</text>
          </g>

          {/* ═════════════════ STAGE 6: Filter Feed Tank ═════════════════ */}
          <Tank x={790} y={280} w={100} h={110} name="Filter Feed Tank" fillLevel={0} capacityKld={cfg.filter_feed_tank_kld} />

          {/* Filter Feed Pumps (2×) — vertical blue pump cylinders */}
          <FeedPump x={905} y={280} label="Filter Feed&#10;Pump - 1" flowKld={ffp.capacity_kld} />
          <FeedPump x={950} y={280} label="Filter Feed&#10;Pump - 2" flowKld={ffp.capacity_kld} />

          {/* Filter feed → PSF pipe */}
          <path d="M 890 335 L 900 335" stroke="#0284c7" strokeWidth="4"  fill="none" />
          <path d="M 985 320 L 1005 320 L 1005 300" stroke="#22c55e" strokeWidth="3"  fill="none" />

          {/* ═════════════════ STAGE 7: PSF / ACF / Softener columns ═════════════════ */}
          <FilterColumn x={1000} y={300} label="PSF" color="#3730a3" />
          <FilterColumn x={1035} y={300} label="ACF" color="#3730a3" />
          <FilterColumn x={1070} y={300} label="Softener" color="#3730a3" />

          {/* Energy Usage badge (top) — auto-computed OR manual override.
              For non-admin clients we omit the mode suffix so it looks
              identical whether the number is compiled or admin-entered. */}
          <g transform="translate(940, 165)">
            <rect x="0" y="0" width="90" height="22" fill="#ffffff" stroke="#f59e0b" strokeWidth="1.5" />
            <text x="45" y="14" textAnchor="middle" fontSize="9" fill="#78350f" fontWeight="600">
              Energy Usage{canManage ? ` (${energyMode === 'manual' ? 'manual' : 'auto'})` : ''}
            </text>
            <rect x="0" y="24" width="90" height="30" fill="#fef3c7" stroke="#f59e0b" strokeWidth="1.5" />
            <text x="45" y="42" textAnchor="middle" fontSize="14" fill="#78350f" fontWeight="700" fontFamily="monospace">
              {energyKwh != null ? energyKwh : '0'}
            </text>
            <text x="45" y="52" textAnchor="middle" fontSize="8" fill="#78350f" fontWeight="500">kWh/day</text>
          </g>

          {/* PSF outlet → Gardening tank */}
          <path d="M 1105 320 L 1145 320" stroke="#22c55e" strokeWidth="3" markerEnd="url(#arrGreen)"  fill="none" />

          {/* ═════════════════ STAGE 8: Gardening / Flushing Tank ═════════════════ */}
          <Tank x={1150} y={280} w={100} h={110} name="Gardening / Flushing Tank" fillLevel={0} capacityKld={gardeningKld} accent="#16a34a" />
          {/* Source badge — admin-only. Clients never see whether the value is manual or flowmeter-derived. */}
          {canManage && gf.source && (
            <g transform="translate(1150, 258)">
              <rect x="0" y="0" width={gf.source === 'flowmeter' ? 90 : 55} height="14" fill="#dcfce7" stroke="#16a34a" strokeWidth="0.75" />
              <text x={(gf.source === 'flowmeter' ? 90 : 55) / 2} y="10" textAnchor="middle" fontSize="8.5" fill="#166534" fontWeight="700">
                {gf.source === 'flowmeter' ? '🔗 FM · Live' : '✎ Manual'}
              </text>
            </g>
          )}

          {/* Gardening pumps */}
          <FeedPump x={1265} y={280} label="Gardening&#10;Pump - 1" flowKld={gardeningKld} />
          <FeedPump x={1305} y={280} label="Gardening&#10;Pump - 2" flowKld={gardeningKld} />

          {/* ═════════════════ STAGE 9: Treated Water Tank ═════════════════ */}
          <Tank x={1355} y={280} w={80} h={110} name="Treated Water Tank" fillLevel={0} capacityKld={cfg.treated_water_tank_kld} accent="#0891b2" />
          <FeedPump x={1345} y={410} label="Cooling Tower&#10;Pump - 1" flowKld={cfg.treated_water_tank_kld} compact />
          <FeedPump x={1385} y={410} label="Cooling Tower&#10;Pump - 2" flowKld={cfg.treated_water_tank_kld} compact />

          {/* Bottom ground line */}
          <line x1="0" y1="470" x2="1440" y2="470" stroke="#cbd5e1" strokeWidth="1" />
        </svg>
      </div>

      {/* ─────────────── Treatment train stage strip ─────────────── */}
      <div className="mt-3 flex items-center gap-1 overflow-x-auto py-2 border-t border-slate-100" data-testid="stp-stage-strip">
        {[
          { key: 'screen',       label: 'Bar Screen',        color: '#a16207' },
          { key: 'equalization', label: 'Equalization',      color: '#0284c7' },
          { key: 'mbbr',         label: 'MBBR / Aeration',   color: '#059669' },
          { key: 'clarifier',    label: 'Clarifier',         color: '#1d4ed8' },
          { key: 'sludge',       label: 'Sludge Dewatering', color: '#a16207' },
          { key: 'uv',           label: 'UV Disinfection',   color: '#7c3aed' },
          { key: 'chlorine',     label: 'Chlorine Dosing',   color: '#a16207' },
          { key: 'outlet',       label: 'Treated Outlet',    color: '#16a34a' },
        ].map((s, i, arr) => (
          <React.Fragment key={s.key}>
            <div
              className="flex-shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-semibold text-white shadow-sm whitespace-nowrap"
              style={{ background: s.color }}
              data-testid={`stp-stage-${s.key}`}
            >
              {i + 1}. {s.label}
            </div>
            {i < arr.length - 1 && (
              <svg width="14" height="10" className="flex-shrink-0"><path d="M 0 5 L 12 5" stroke="#94a3b8" strokeWidth="1.5" markerEnd="url(#arrBlue)" fill="none" /></svg>
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Energy breakdown table — visible when auto mode has data */}
      {energyMode === 'auto' && stpDerived?.energy_breakdown?.length > 0 && (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded border border-amber-200 bg-amber-50/50 p-3" data-testid="stp-energy-breakdown">
            <div className="text-xs font-semibold text-amber-900 mb-1.5">Energy breakdown (kWh/day)</div>
            <div className="text-[11px] text-amber-900 space-y-0.5 font-mono">
              {stpDerived.energy_breakdown.map((row, i) => (
                <div key={i} className="flex justify-between">
                  <span>{row.label}</span>
                  <span className="font-bold tabular-nums">{row.kwh.toFixed(2)}</span>
                </div>
              ))}
              <div className="flex justify-between pt-1 mt-1 border-t border-amber-300 text-amber-950 font-bold">
                <span>Total</span>
                <span className="tabular-nums">{energyKwh?.toFixed(2)}</span>
              </div>
            </div>
          </div>
          {gardeningKld != null && (
            <div className="rounded border border-emerald-200 bg-emerald-50/50 p-3">
              <div className="text-xs font-semibold text-emerald-900 mb-1.5">Gardening / Flushing usage today</div>
              <div className="text-2xl font-bold text-emerald-900 font-mono tabular-nums" data-testid="stp-gardening-kld">
                {gardeningKld} <span className="text-sm font-medium">KLD</span>
              </div>
              {canManage && (
                <div className="text-[10px] text-emerald-800 mt-0.5">
                  Source: {gf.source === 'flowmeter' ? `Linked flowmeter · ${gf.linked_flowmeter_hw_id}` : 'Manual (admin-entered)'}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ------------------------- Sub-components used by the plant SVG -------------------------
const Tank = ({ x, y, w, h, name, fillLevel = 0, capacityKld, accent = '#a16207' }) => {
  const fillH = Math.max(2, (h - 20) * (fillLevel / 100 || 0.05));
  const displayKld = capacityKld != null ? capacityKld : '—';
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect x="0" y="0" width={w} height={h} fill="url(#tankBrown)" stroke={accent} strokeWidth="1.5" />
      {/* Fill level indicator (blue) */}
      <rect x="4" y={h - fillH - 4} width={w - 8} height={fillH} fill="#60a5fa" opacity="0.85" />
      {/* Level % */}
      <text x={w / 2} y={h / 2} textAnchor="middle" fontSize="12" fill="#1e293b" fontWeight="700">{fillLevel}%</text>
      {/* Capacity badge on bottom-left */}
      <g transform={`translate(2, ${h - 20})`}>
        <rect x="0" y="0" width="48" height="16" fill="#ffffff" stroke={accent} strokeWidth="1" />
        <text x="24" y="12" textAnchor="middle" fontSize="10" fill="#1e293b" fontWeight="600" fontFamily="monospace">{displayKld} KLD</text>
      </g>
      {/* Label under */}
      <rect x={-4} y={h + 6} width={w + 8} height="18" fill="#ffffff" stroke="#94a3b8" strokeWidth="0.5" />
      <text x={w / 2} y={h + 19} textAnchor="middle" fontSize="10" fill="#1e293b" fontWeight="600">{name}</text>
    </g>
  );
};

const PumpBadge = ({ x, y, label, flowKld }) => (
  <g transform={`translate(${x}, ${y})`}>
    <rect x="-24" y="0" width="48" height="20" fill="#ffffff" stroke="#94a3b8" strokeWidth="1" />
    {label.split('\n').map((ln, i) => (
      <text key={i} x="0" y={i === 0 ? 9 : 17} textAnchor="middle" fontSize="7.5" fill="#1e293b" fontWeight="500">{ln}</text>
    ))}
    {/* KLD flow bubble above */}
    <g transform="translate(0, -30)">
      <rect x="-16" y="0" width="32" height="14" rx="2" fill="#ffffff" stroke="#0284c7" strokeWidth="1" />
      <text x="0" y="10" textAnchor="middle" fontSize="9" fill="#0369a1" fontWeight="700" fontFamily="monospace">
        {flowKld != null ? flowKld : '—'} KLD
      </text>
    </g>
    <text x="0" y="30" textAnchor="middle" fontSize="8" fill="#64748b" fontFamily="monospace">00:00 HH:MM</text>
    {/* Pump icon */}
    <g transform="translate(-8, 22)">
      <circle cx="8" cy="8" r="8" fill="#f59e0b" style={{ animation: 'stpBlink 2s ease-in-out infinite' }} />
      <g style={{ transformOrigin: '8px 8px', animation: 'stpRotate 2s linear infinite' }}>
        <line x1="8" y1="2" x2="8" y2="14" stroke="#78350f" strokeWidth="1.5" />
        <line x1="2" y1="8" x2="14" y2="8" stroke="#78350f" strokeWidth="1.5" />
      </g>
    </g>
  </g>
);

const AirBlower = ({ x, y, label, capacity, powerKw }) => (
  <g transform={`translate(${x}, ${y})`}>
    <rect x="0" y="0" width="50" height="35" fill="#3b82f6" stroke="#1e40af" strokeWidth="1.2" rx="3" />
    {/* Impeller */}
    <g transform="translate(25, 17)">
      <circle cx="0" cy="0" r="10" fill="#bfdbfe" />
      <g style={{ transformOrigin: '0 0', animation: 'stpRotate 0.8s linear infinite' }}>
        <line x1="-8" y1="0" x2="8" y2="0" stroke="#1e3a8a" strokeWidth="2" />
        <line x1="0" y1="-8" x2="0" y2="8" stroke="#1e3a8a" strokeWidth="2" />
      </g>
      <circle cx="0" cy="0" r="2.5" fill="#1e3a8a" />
    </g>
    <text x="25" y="52" textAnchor="middle" fontSize="8.5" fill="#1e293b" fontWeight="600">{label}</text>
    {(capacity != null || powerKw != null) && (
      <g>
        <rect x="-4" y="-16" width="58" height="14" rx="2" fill="#ffffff" stroke="#1e40af" strokeWidth="0.75" />
        <text x="25" y="-6" textAnchor="middle" fontSize="8" fill="#1e40af" fontWeight="700" fontFamily="monospace">
          {capacity != null ? `${capacity} m³/h` : '—'}{powerKw != null ? ` · ${powerKw} kW` : ''}
        </text>
      </g>
    )}
  </g>
);

const FeedPump = ({ x, y, label, flowKld, compact = false }) => (
  <g transform={`translate(${x}, ${y})`}>
    {/* KLD flow bubble above */}
    <g transform="translate(20, -20)">
      <rect x="-16" y="0" width="32" height="14" rx="2" fill="#ffffff" stroke="#0284c7" strokeWidth="1" />
      <text x="0" y="10" textAnchor="middle" fontSize="9" fill="#0369a1" fontWeight="700" fontFamily="monospace">
        {flowKld != null ? flowKld : '—'} KLD
      </text>
    </g>
    <rect x="0" y="0" width="40" height={compact ? 30 : 40} fill="#60a5fa" stroke="#1d4ed8" strokeWidth="1.2" rx="3" />
    <g transform={`translate(20, ${compact ? 15 : 20})`}>
      <circle cx="0" cy="0" r="9" fill="#dbeafe" />
      <g style={{ transformOrigin: '0 0', animation: 'stpRotate 1.2s linear infinite' }}>
        <line x1="-7" y1="0" x2="7" y2="0" stroke="#1e3a8a" strokeWidth="1.8" />
        <line x1="0" y1="-7" x2="0" y2="7" stroke="#1e3a8a" strokeWidth="1.8" />
      </g>
    </g>
    {label.split('\n').map((ln, i) => (
      <text key={i} x="20" y={(compact ? 42 : 52) + i * 10} textAnchor="middle" fontSize="8" fill="#1e293b" fontWeight="500">{ln}</text>
    ))}
  </g>
);

const FilterColumn = ({ x, y, label, color = '#3730a3' }) => (
  <g transform={`translate(${x}, ${y})`}>
    <rect x="0" y="0" width="28" height="70" rx="10" fill={color} stroke="#1e1b4b" strokeWidth="1.2" />
    <rect x="4" y="8" width="20" height="54" rx="6" fill="#818cf8" opacity="0.7" />
    <circle cx="14" cy="35" r="5" fill="#c7d2fe" opacity="0.9" />
    <text x="14" y="88" textAnchor="middle" fontSize="10" fill="#1e293b" fontWeight="600">{label}</text>
  </g>
);

// ------------------------- STP process flow animation -------------------------
const STPProcessFlow = ({ values = {} }) => {
  const stages = [
    { label: 'Inlet',      key: 'TSS', color: '#7c3aed' },
    { label: 'Primary',    key: 'COD', color: '#0ea5e9' },
    { label: 'Aeration',   key: 'BOD', color: '#22c55e' },
    { label: 'Clarifier',  key: 'TSS', color: '#f59e0b' },
    { label: 'Outlet',     key: 'PH',  color: '#3b82f6' },
  ];
  return (
    <div className="relative w-full py-4">
      <style>{`
        @keyframes flowParticle {
          0% { left: 0%; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { left: 100%; opacity: 0; }
        }
      `}</style>
      {/* Pipeline */}
      <div className="relative h-3 bg-gradient-to-r from-purple-400 via-emerald-400 to-blue-500 rounded-full mx-4">
        {/* Flowing particles */}
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i}
            className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-white shadow-md"
            style={{ animation: `flowParticle 4s linear ${i * 0.6}s infinite` }}
          />
        ))}
      </div>
      {/* Stages */}
      <div className="grid grid-cols-5 gap-2 mt-4">
        {stages.map((s, idx) => (
          <div key={idx} className="flex flex-col items-center">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center text-white font-bold shadow-lg"
              style={{ backgroundColor: s.color }}
            >
              {idx + 1}
            </div>
            <div className="text-xs font-semibold text-gray-800 mt-1 text-center">{s.label}</div>
            {values[s.key] != null && (
              <div className="text-[10px] text-gray-500 tabular-nums mt-0.5">
                {s.key}: {Number(values[s.key]).toFixed(1)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// ------------------------- MAIN PAGE -------------------------
const WaterQuality = () => {
  const isAdmin = _isAdmin();
  const [tab, setTab] = useState('stp'); // 'stp' | 'do'
  const [unit, setUnit] = useState('mg/L');
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState(null);

  const [selectedHw, setSelectedHw] = useState(null);
  const [range, setRange] = useState('daily');
  const [history, setHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Report download form
  const [reportFrom, setReportFrom] = useState('');
  const [reportTo, setReportTo] = useState('');
  const [reportFormat, setReportFormat] = useState('csv');
  const [reportTank, setReportTank] = useState('both'); // 'both' | '1' | '2' — DO only
  const [downloading, setDownloading] = useState(false);

  // STP config dialog
  const [showStpConfig, setShowStpConfig] = useState(false);
  // DO tank capacity dialog
  const [showDoTankConfig, setShowDoTankConfig] = useState(false);
  // Print-SCADA-snapshot button state
  const [printing, setPrinting] = useState(false);

  const printSCADASnapshot = async () => {
    const label = cleanLabel(currentDevice?._registry?.label || selectedHw || 'stp');
    const node = document.getElementById(`scada-snapshot-${label}`);
    if (!node) { toast.error('SCADA diagram not ready'); return; }
    setPrinting(true);
    try {
      // 2× resolution so the exported PDF is sharp on A4 landscape
      const canvas = await html2canvas(node, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
        // Ensure animations don't blur the snapshot
        onclone: (docClone) => {
          docClone.querySelectorAll('[style*="animation"]').forEach((el) => {
            el.style.animation = 'none';
          });
        },
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      // Title band
      pdf.setFontSize(14);
      pdf.setTextColor('#0f172a');
      pdf.text(`STP SCADA Snapshot — ${label}`, 10, 12);
      pdf.setFontSize(9);
      pdf.setTextColor('#475569');
      pdf.text(
        `Exported: ${new Date().toLocaleString('en-IN', { hour12: false })} · Envirolytics Monitor`,
        10, 17,
      );

      // Fit image into A4 landscape below the title band
      const imgRatio = canvas.width / canvas.height;
      const targetW = pageW - 20;
      const targetH = Math.min(pageH - 30, targetW / imgRatio);
      const finalW = targetH * imgRatio > targetW ? targetW : targetH * imgRatio;
      pdf.addImage(imgData, 'PNG', (pageW - finalW) / 2, 22, finalW, targetH);

      const fname = `scada_${label.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`;
      pdf.save(fname);
      toast.success('SCADA snapshot exported');
    } catch (e) {
      toast.error('Snapshot export failed — see console');
      console.error(e);
    } finally { setPrinting(false); }
  };

  // STP flowmeters (inlet + outlet) — sourced from flowmeter-mgmt aggregate endpoint.
  const [stpFlowmeters, setStpFlowmeters] = useState({ inlet: [], outlet: [] });

  const loadStpFlowmeters = async () => {
    try {
      const { data } = await api.get('/api/flowmeter-mgmt/categories');
      const cats = data?.categories || data?.items || data || [];
      const relevant = cats.filter((c) => c.category === 'stp_inlet' || c.category === 'stp_outlet');
      if (!relevant.length) { setStpFlowmeters({ inlet: [], outlet: [] }); return; }
      const results = await Promise.all(
        relevant.map((c) =>
          api.get(`/api/flowmeter-mgmt/${encodeURIComponent(c.hardware_id)}/aggregate`)
            .then((r) => ({ ...r.data, category: c.category, label: c.label || c.hardware_id }))
            .catch(() => null),
        ),
      );
      const inlet = results.filter((a) => a && a.category === 'stp_inlet');
      const outlet = results.filter((a) => a && a.category === 'stp_outlet');
      setStpFlowmeters({ inlet, outlet });
    } catch (_) { setStpFlowmeters({ inlet: [], outlet: [] }); }
  };

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/api/water-quality/latest?unit=${encodeURIComponent(unit)}`);
      setPayload(data);
      // Auto-select first device for the current tab
      const list = tab === 'stp' ? data.stp : (tab === 'do' ? data.do : (data.chlorine || []));
      if (list?.length && !selectedHw) setSelectedHw(list[0].hardware_id);
    } catch (e) {
      const msg = formatApiError(e?.response?.data?.detail);
      toast.error(msg);
      setPayload({ error: msg });
    } finally { setLoading(false); }
    // Refresh flowmeter aggregates in parallel
    loadStpFlowmeters();
  };

  useEffect(() => { load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [unit]);
  useEffect(() => {
    // Refresh latest every 30 seconds
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [unit]);

  // When tab changes, pick a device of that type
  useEffect(() => {
    if (!payload) return;
    const list = tab === 'stp' ? payload.stp : (tab === 'do' ? payload.do : (payload.chlorine || []));
    if (list?.length) {
      const already = list.some((r) => r.hardware_id === selectedHw);
      if (!already) setSelectedHw(list[0].hardware_id);
    } else {
      setSelectedHw(null);
    }
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [tab, payload]);

  // Fetch history for the selected device + range
  useEffect(() => {
    if (!selectedHw) { setHistory(null); return; }
    let cancelled = false;
    (async () => {
      setHistoryLoading(true);
      try {
        const { data } = await api.get(
          `/api/water-quality/history/${encodeURIComponent(selectedHw)}?range=${range}&unit=${encodeURIComponent(unit)}`,
        );
        if (!cancelled) setHistory(data);
      } catch (e) {
        if (!cancelled) toast.error(formatApiError(e?.response?.data?.detail));
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedHw, range, unit]);

  const currentList = tab === 'stp'
    ? (payload?.stp || [])
    : (tab === 'do' ? (payload?.do || []) : (payload?.chlorine || []));
  const currentDevice = currentList.find((r) => r.hardware_id === selectedHw);
  const currentValues = currentDevice?.values || {};

  const downloadReport = async () => {
    if (!selectedHw) return;
    if (!reportFrom || !reportTo) { toast.error('Select from + to dates'); return; }
    setDownloading(true);
    try {
      const isDo = tab === 'do';
      const payload = {
        hardware_id: selectedHw,
        from_date: new Date(reportFrom).toISOString(),
        to_date: new Date(reportTo).toISOString(),
        format: reportFormat,
        unit,
      };
      if (isDo) payload.tank = reportTank;
      const res = await api.post('/api/water-quality/report', payload, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: reportFormat === 'csv' ? 'text/csv' : 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const tankSuffix = isDo && reportTank !== 'both' ? `_tank${reportTank}` : '';
      a.download = `wq_report_${selectedHw}${tankSuffix}_${reportFrom}_${reportTo}.${reportFormat}`;
      document.body.appendChild(a); a.click(); a.remove();
      toast.success('Report downloaded');
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Report download failed');
    } finally { setDownloading(false); }
  };

  const stpMeta = payload?.stp_params_meta || {};
  const doMeta = payload?.do_params_meta || {};

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
            <Droplets className="h-8 w-8 text-sky-500" /> Water Quality
          </h1>
          <p className="text-gray-600 text-sm">STP effluent + DO analyzer monitoring with live visualisation</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex bg-gray-100 rounded-lg p-1" data-testid="unit-toggle">
            {['mg/L', 'ppm'].map((u) => (
              <button key={u}
                onClick={() => setUnit(u)}
                className={`px-3 py-1 rounded text-xs font-medium transition ${unit === u ? 'bg-white shadow text-sky-700' : 'text-gray-600'}`}
                data-testid={`unit-${u.replace('/', '')}`}
              >
                {u}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} data-testid="wq-refresh">
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 border-b" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'stp'}
          onClick={() => setTab('stp')}
          className={`px-6 py-3 text-sm font-medium border-b-2 transition ${tab === 'stp' ? 'border-sky-500 text-sky-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          data-testid="wq-tab-stp"
        >
          <FlaskConical className="h-4 w-4 inline mr-1" /> STP Parameters
        </button>
        <button
          role="tab"
          aria-selected={tab === 'do'}
          onClick={() => setTab('do')}
          className={`px-6 py-3 text-sm font-medium border-b-2 transition ${tab === 'do' ? 'border-sky-500 text-sky-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          data-testid="wq-tab-do"
        >
          <Wind className="h-4 w-4 inline mr-1" /> DO Analyzer (Aeration Tanks)
        </button>
        <button
          role="tab"
          aria-selected={tab === 'chlorine'}
          onClick={() => setTab('chlorine')}
          className={`px-6 py-3 text-sm font-medium border-b-2 transition ${tab === 'chlorine' ? 'border-sky-500 text-sky-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          data-testid="wq-tab-chlorine"
        >
          <Droplets className="h-4 w-4 inline mr-1" /> Chlorine Analyzer
        </button>
      </div>

      {/* Device selector */}
      {currentList.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid="wq-device-picker">
          {currentList.map((d) => {
            const label = cleanLabel(d._registry?.label || d.hardware_id);
            return (
              <button key={d.hardware_id}
                onClick={() => setSelectedHw(d.hardware_id)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${selectedHw === d.hardware_id ? 'bg-sky-500 text-white border-sky-500' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                data-testid={`wq-device-${d.hardware_id}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {loading && !payload ? (
        <div className="text-center py-16"><Loader2 className="h-8 w-8 animate-spin mx-auto text-gray-400" /></div>
      ) : currentList.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-gray-500">
            <Droplets className="h-12 w-12 mx-auto mb-3 text-gray-300" />
            <p className="font-medium mb-1">No {tab === 'stp' ? 'STP water-quality' : (tab === 'do' ? 'DO analyzer' : 'chlorine analyzer')} devices found</p>
            <p className="text-xs">
              {isAdmin ? 'Register one from the Instruments page with type ' : 'Ask your administrator to register a '}
              <code className="bg-gray-100 px-1 rounded">{tab === 'stp' ? 'wq_stp' : (tab === 'do' ? 'do_meter' : 'chlorine_analyzer')}</code> to see live data.
            </p>
          </CardContent>
        </Card>
      ) : tab === 'stp' ? (
        <>
          {/* Chlorine alert banner — only when we have a live chlorine reading
              that is outside the admin-configured band. */}
          {currentDevice?.chlorine_alert && currentDevice.chlorine_alert.status !== 'unknown' && currentDevice.chlorine_alert.status !== 'ok' && (
            <div
              className={`rounded-lg border p-3 text-sm ${currentDevice.chlorine_alert.status === 'low' ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-red-50 border-red-300 text-red-900'}`}
              data-testid="stp-chlorine-alert"
            >
              <div className="flex items-center gap-3">
                <AlertCircle className={`h-5 w-5 ${currentDevice.chlorine_alert.status === 'low' ? 'text-amber-600' : 'text-red-600'}`} />
                <div className="flex-1">
                  <strong>Chlorine {currentDevice.chlorine_alert.status === 'low' ? 'below' : 'above'} safe range —</strong>{' '}
                  {currentDevice.chlorine_alert.action}.
                  <span className="ml-2 font-mono text-xs opacity-80">
                    reading {typeof currentValues.CHLORINE === 'number' ? currentValues.CHLORINE.toFixed(2) : '—'} mg/L · safe band {currentDevice.chlorine_alert.min}–{currentDevice.chlorine_alert.max} mg/L
                  </span>
                </div>
              </div>
              {currentDevice.chlorine_alert.recommendation && (
                <div className="pl-8 pt-2 border-t border-current/20 mt-2">
                  <DoseRecommendation r={currentDevice.chlorine_alert.recommendation} compact />
                </div>
              )}
            </div>
          )}
          {/* STP: gauges + realistic plant flow diagram */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Gauge className="h-5 w-5 text-sky-500" /> Live Parameters — {cleanLabel(currentDevice?._registry?.label || selectedHw)}
                </span>
                {isAdmin && selectedHw && (
                  <a href={`/certificates?tab=photos&hardware_id=${encodeURIComponent(selectedHw)}`} className="text-xs text-blue-600 hover:underline flex items-center gap-1" data-testid="wq-stp-photos-link">
                    📷 Manage instrument photos & location
                  </a>
                )}
              </CardTitle>
              <CardDescription>Real-time values from the STP water-quality analyser. Turbidity is derived from TSS · k (k = {currentDevice?._registry?.turbidity_k ?? 0.5}); chlorine is monitored against the {currentDevice?.chlorine_alert?.min ?? 0.2}–{currentDevice?.chlorine_alert?.max ?? 2.0} mg/L residual band.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                {['COD', 'BOD', 'TSS', 'PH', 'TURBIDITY', 'CHLORINE'].map((k) => (
                  <Gauge2D
                    key={k}
                    value={currentValues[k]}
                    min={stpMeta[k]?.min ?? 0}
                    max={stpMeta[k]?.max ?? 100}
                    unit={k === 'PH' ? 'pH' : (k === 'TURBIDITY' ? 'NTU' : (k === 'CHLORINE' ? 'mg/L' : unit))}
                    label={k === 'PH' ? 'pH' : (k === 'TURBIDITY' ? 'Turbidity' : (k === 'CHLORINE' ? 'Chlorine' : k))}
                    safeMin={stpMeta[k]?.safe_min}
                    safeMax={stpMeta[k]?.safe_max}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Treatment Plant Flow</span>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={printSCADASnapshot} disabled={printing} data-testid="stp-print-snapshot-btn">
                    {printing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileText className="h-4 w-4 mr-1" />}
                    Print SCADA snapshot
                  </Button>
                  {isAdmin && (
                    <Button size="sm" variant="outline" onClick={() => setShowStpConfig(true)} data-testid="stp-configure-plant-btn">
                      ⚙ Configure Plant
                    </Button>
                  )}
                </div>
              </CardTitle>
              <CardDescription>Live plant schematic — animated pipes, aeration blower and bubble diffuser reflect current operation. Export a PDF snapshot for compliance audits or monthly ops reviews.</CardDescription>
            </CardHeader>
            <CardContent>
              <STPPlantDiagram
                values={currentValues}
                unit={unit}
                plantCapacityKld={currentDevice?._registry?.plant_capacity_kld}
                deviceLabel={cleanLabel(currentDevice?._registry?.label || selectedHw)}
                lastReceivedAt={currentDevice?.received_at}
                stpUnitConfig={currentDevice?._registry?.stp_unit_config}
                stpDerived={currentDevice?._registry?.stp_derived}
                canManage={isAdmin}
                onEditConfig={() => setShowStpConfig(true)}
              />
            </CardContent>
          </Card>

          {/* STP Flowmeters — inlet & outlet (moved from Dashboard) */}
          <Card data-testid="stp-flowmeters-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Droplets className="h-5 w-5 text-sky-600" /> STP Flowmeters — inlet &amp; outlet
              </CardTitle>
              <CardDescription>Live m³/hr and cumulative KL totaliser for the STP inlet and outlet flowmeters.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs uppercase tracking-wide mb-2 text-gray-600 font-semibold">STP Inlet</p>
                  {stpFlowmeters.inlet.length === 0 ? (
                    <p className="text-xs italic text-gray-500" data-testid="stp-inlet-empty">No STP inlet flowmeter registered.</p>
                  ) : stpFlowmeters.inlet.map((a) => (
                    <FlowmeterTile key={a.hardware_id} agg={a} color="#16a085" onClick={() => window.open('/flowmeter', '_self')} />
                  ))}
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide mb-2 text-gray-600 font-semibold">STP Outlet</p>
                  {stpFlowmeters.outlet.length === 0 ? (
                    <p className="text-xs italic text-gray-500" data-testid="stp-outlet-empty">No STP outlet flowmeter registered.</p>
                  ) : stpFlowmeters.outlet.map((a) => (
                    <FlowmeterTile key={a.hardware_id} agg={a} color="#d35400" onClick={() => window.open('/flowmeter', '_self')} />
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      ) : tab === 'do' ? (
        <>
          {/* DO: two aeration tanks + live camera */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Wind className="h-5 w-5 text-sky-500" /> Aeration Tanks — {cleanLabel(currentDevice?._registry?.label || selectedHw)}
                </span>
                <div className="flex items-center gap-3">
                  {isAdmin && selectedHw && (
                    <a href={`/certificates?tab=photos&hardware_id=${encodeURIComponent(selectedHw)}`} className="text-xs text-blue-600 hover:underline" data-testid="wq-do-photos-link">
                      📷 Manage instrument photos & location
                    </a>
                  )}
                  {isAdmin && (
                    <Button size="sm" variant="outline" onClick={() => setShowDoTankConfig(true)} data-testid="do-configure-tanks-btn">
                      ⚙ Configure Tank Capacities
                    </Button>
                  )}
                </div>
              </CardTitle>
              <CardDescription>
                Bubble animation speed and density reflect dissolved-oxygen concentration in each tank
                {isAdmin && currentDevice?._registry && (
                  <span className="ml-2 inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-900 rounded px-2 py-0.5 font-medium" data-testid="wq-do-owner-badge">
                    Client: {currentDevice._registry.owner_name || currentDevice._registry.owner_email || currentDevice._registry.owner_user_id || '—'}
                    {currentDevice._registry.location_name ? ` · ${currentDevice._registry.location_name}` : ''}
                  </span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-8">
                <div>
                  <AerationTank
                    tankNumber={1}
                    doValue={currentValues.DO_TANK_1}
                    min={doMeta.DO_TANK_1?.min ?? 0}
                    max={doMeta.DO_TANK_1?.max ?? 20}
                    safeMin={doMeta.DO_TANK_1?.safe_min}
                    safeMax={doMeta.DO_TANK_1?.safe_max}
                    unit={unit}
                    capacityKld={
                      currentDevice?._registry?.do_tank_config?.tank_1_kld
                      ?? currentDevice?._registry?.tank_capacity_kld
                    }
                    videoSrc={currentDevice?._registry?.aeration_videos?.tank_1 ? backendAssetUrl(currentDevice._registry.aeration_videos.tank_1) : null}
                    isCustomVideo={Boolean(currentDevice?._registry?.aeration_videos?.tank_1)}
                  />
                  <AerationVideoUploader
                    hardwareId={selectedHw}
                    tankNumber={1}
                    currentUrl={currentDevice?._registry?.aeration_videos?.tank_1}
                    canManage={isAdmin}
                    onChange={() => load()}
                  />
                </div>
                <div>
                  <AerationTank
                    tankNumber={2}
                    doValue={currentValues.DO_TANK_2}
                    min={doMeta.DO_TANK_2?.min ?? 0}
                    max={doMeta.DO_TANK_2?.max ?? 20}
                    safeMin={doMeta.DO_TANK_2?.safe_min}
                    safeMax={doMeta.DO_TANK_2?.safe_max}
                    unit={unit}
                    capacityKld={
                      currentDevice?._registry?.do_tank_config?.tank_2_kld
                      ?? currentDevice?._registry?.tank_capacity_kld
                    }
                    videoSrc={currentDevice?._registry?.aeration_videos?.tank_2 ? backendAssetUrl(currentDevice._registry.aeration_videos.tank_2) : null}
                    isCustomVideo={Boolean(currentDevice?._registry?.aeration_videos?.tank_2)}
                  />
                  <AerationVideoUploader
                    hardwareId={selectedHw}
                    tankNumber={2}
                    currentUrl={currentDevice?._registry?.aeration_videos?.tank_2}
                    canManage={isAdmin}
                    onChange={() => load()}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Live camera widget — right next to DO meter */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Video className="h-5 w-5 text-red-500" /> Live Camera Feed
              </CardTitle>
              <CardDescription>
                Real-time video of the biological aeration tank with live DO telemetry overlay.
                {isAdmin && ' Admins can configure the stream URL or upload video.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LiveCameraWidget
                hardwareId={selectedHw}
                deviceLabel={cleanLabel(currentDevice?._registry?.label || selectedHw)}
                telemetry={{
                  DO_TANK_1: currentValues.DO_TANK_1,
                  DO_TANK_2: currentValues.DO_TANK_2,
                }}
                canManage={isAdmin}
              />
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          {/* Chlorine Analyzer — mirrors DO layout: live tiles + alerts */}
          {currentDevice?.chlorine_alert && currentDevice.chlorine_alert.status !== 'unknown' && (
            <div
              className={`rounded-lg border p-3 text-sm flex items-center gap-3 ${
                currentDevice.chlorine_alert.status === 'low' ? 'bg-amber-50 border-amber-300 text-amber-900'
                : currentDevice.chlorine_alert.status === 'high' ? 'bg-red-50 border-red-300 text-red-900'
                : 'bg-emerald-50 border-emerald-300 text-emerald-900'
              }`}
              data-testid="chlorine-analyzer-alert"
            >
              {currentDevice.chlorine_alert.status === 'ok'
                ? <ShieldCheck className="h-5 w-5 text-emerald-600" />
                : <AlertCircle className={`h-5 w-5 ${currentDevice.chlorine_alert.status === 'low' ? 'text-amber-600' : 'text-red-600'}`} />}
              <div className="flex-1">
                <strong>
                  {currentDevice.chlorine_alert.status === 'low' && 'Under-chlorination — '}
                  {currentDevice.chlorine_alert.status === 'high' && 'Over-chlorination — '}
                  {currentDevice.chlorine_alert.status === 'ok' && 'Residual chlorine is in the safe range — '}
                </strong>
                {currentDevice.chlorine_alert.action}.
                <span className="ml-2 font-mono text-xs opacity-80">
                  reading {typeof currentValues.CHLORINE === 'number' ? currentValues.CHLORINE.toFixed(2) : '—'} mg/L · safe band {currentDevice.chlorine_alert.min}–{currentDevice.chlorine_alert.max} mg/L
                </span>
              </div>
            </div>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Droplets className="h-5 w-5 text-sky-500" /> Chlorine Analyzer — {cleanLabel(currentDevice?._registry?.label || selectedHw)}
                </span>
                {isAdmin && selectedHw && (
                  <a href={`/certificates?tab=photos&hardware_id=${encodeURIComponent(selectedHw)}`} className="text-xs text-blue-600 hover:underline" data-testid="wq-cl-photos-link">
                    📷 Manage instrument photos & location
                  </a>
                )}
              </CardTitle>
              <CardDescription>
                Free-residual chlorine (mg/L) with in-band alerting. Safe band <b>{currentDevice?.chlorine_alert?.min ?? 0.2}</b>–<b>{currentDevice?.chlorine_alert?.max ?? 2.0}</b> mg/L
                {isAdmin && ' — configurable per device via /api/water-quality/{hw}/thresholds'}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {['CHLORINE', 'CHLORINE_DOSE'].map((k) => {
                  const meta = payload?.chlorine_params_meta?.[k] || {};
                  const cmin = k === 'CHLORINE' ? (currentDevice?.chlorine_alert?.min ?? meta.safe_min) : meta.safe_min;
                  const cmax = k === 'CHLORINE' ? (currentDevice?.chlorine_alert?.max ?? meta.safe_max) : meta.safe_max;
                  return (
                    <Gauge2D
                      key={k}
                      value={currentValues[k]}
                      min={meta.min ?? 0}
                      max={meta.max ?? 5}
                      unit="mg/L"
                      label={k === 'CHLORINE' ? 'Free Chlorine' : 'Dose Setpoint'}
                      safeMin={cmin}
                      safeMax={cmax}
                    />
                  );
                })}
              </div>
              {currentDevice?._registry?.plant_capacity_kld != null && (
                <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-mono" data-testid="chlorine-plant-capacity">
                  Plant capacity: <b>{currentDevice._registry.plant_capacity_kld}</b> KLD
                </div>
              )}
            </CardContent>
          </Card>
          {/* Automated dose recommendation — shown when the admin has set at
              least a target + flow (chlorine_alert.recommendation is only
              emitted when we have enough inputs to compute it). */}
          {currentDevice?.chlorine_alert?.recommendation && (
            <Card data-testid="chlorine-dose-recommendation">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FlaskConical className="h-5 w-5 text-amber-500" /> Recommended Dose (automated)
                </CardTitle>
                <CardDescription>
                  Computed from the live chlorine reading, admin-set target and plant flow. Updates every 30 s.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DoseRecommendation r={currentDevice.chlorine_alert.recommendation} />
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* History + Reports */}
      {selectedHw && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Historical Trends</span>
              <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
                {['daily', 'weekly', 'monthly'].map((r) => (
                  <button key={r}
                    onClick={() => setRange(r)}
                    className={`px-3 py-1 text-xs font-medium rounded ${range === r ? 'bg-white shadow text-sky-700' : 'text-gray-600'}`}
                    data-testid={`wq-range-${r}`}
                  >
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </button>
                ))}
              </div>
            </CardTitle>
            <CardDescription>Aggregated averages over the selected range</CardDescription>
          </CardHeader>
          <CardContent>
            {historyLoading ? (
              <div className="text-center py-8"><Loader2 className="h-6 w-6 animate-spin mx-auto text-gray-400" /></div>
            ) : !history?.series?.length ? (
              <div className="text-center py-8 text-gray-500 text-sm">No data yet for this range.</div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={history.series}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  {(history.params || []).map((p, idx) => (
                    <Line key={p} type="monotone" dataKey={p}
                          stroke={['#0ea5e9', '#f59e0b', '#8b5cf6', '#22c55e'][idx % 4]}
                          strokeWidth={2} dot={false} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      )}

      {/* Report download */}
      {selectedHw && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" /> Download Report
            </CardTitle>
            <CardDescription>Export raw readings for the selected device in CSV or PDF</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div><Label className="text-xs">From</Label>
                <Input type="date" value={reportFrom} onChange={(e) => setReportFrom(e.target.value)} data-testid="wq-report-from" />
              </div>
              <div><Label className="text-xs">To</Label>
                <Input type="date" value={reportTo} onChange={(e) => setReportTo(e.target.value)} data-testid="wq-report-to" />
              </div>
              <div><Label className="text-xs">Format</Label>
                <select className="w-full border rounded px-2 py-2 text-sm"
                        value={reportFormat} onChange={(e) => setReportFormat(e.target.value)}
                        data-testid="wq-report-format">
                  <option value="csv">CSV</option>
                  <option value="pdf">PDF</option>
                </select>
              </div>
              {/* DO tank picker — only for the DO Analyzer tab */}
              {tab === 'do' && (
                <div>
                  <Label className="text-xs">Tank</Label>
                  <select className="w-full border rounded px-2 py-2 text-sm"
                          value={reportTank} onChange={(e) => setReportTank(e.target.value)}
                          data-testid="wq-report-tank">
                    <option value="both">Both tanks</option>
                    <option value="1">Tank 1 only</option>
                    <option value="2">Tank 2 only</option>
                  </select>
                </div>
              )}
              <div className={tab === 'do' ? 'md:col-span-4 flex justify-end mt-2' : 'flex items-end'}>
                <Button onClick={downloadReport} disabled={downloading} className={tab === 'do' ? 'w-40' : 'w-full'} data-testid="wq-report-download">
                  {downloading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                  Download
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Admin-only STP config dialog */}
      {isAdmin && selectedHw && (
        <STPConfigDialog
          open={showStpConfig}
          onOpenChange={setShowStpConfig}
          hardwareId={selectedHw}
          deviceLabel={cleanLabel(currentDevice?._registry?.label || selectedHw)}
          existing={currentDevice?._registry?.stp_unit_config}
          onSaved={load}
        />
      )}

      {/* Admin-only DO tank capacity dialog */}
      {isAdmin && selectedHw && (
        <DOTankConfigDialog
          open={showDoTankConfig}
          onOpenChange={setShowDoTankConfig}
          hardwareId={selectedHw}
          deviceLabel={cleanLabel(currentDevice?._registry?.label || selectedHw)}
          existing={currentDevice?._registry?.do_tank_config}
          onSaved={load}
        />
      )}
    </div>
  );
};

export default WaterQuality;
