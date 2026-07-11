import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { toast } from 'sonner';
import { Droplets, Gauge, FlaskConical, Wind, Download, FileText, Loader2, RefreshCw, Video } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import api, { formatApiError } from '../lib/api';
import { isAdmin as _isAdmin } from '../mockData';
import { LiveCameraWidget } from '../components/LiveCameraWidget';

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
const AerationTank = ({ tankNumber, doValue, min = 0, max = 20, safeMin = 2, safeMax = 8, unit = 'mg/L', capacityKld }) => {
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
      // Speed video playback with oxygen level (higher DO = more vigorous)
      const rate = Math.max(0.4, Math.min(1.6, 0.4 + (v / max) * 1.2));
      try { el.playbackRate = rate; } catch (_) {}
      el.play().catch(() => {});
    } else {
      try { el.pause(); } catch (_) {}
    }
  }, [aerationActive, v, max]);

  return (
    <div className="relative w-full" data-testid={`aeration-tank-${tankNumber}`}>
      <div
        className={`relative rounded-2xl border-4 overflow-hidden shadow-xl ${alarm ? 'border-red-400' : (aerationActive ? 'border-sky-400' : 'border-gray-400')}`}
        style={{ background: '#0f172a' }}
      >
        <video
          ref={videoRef}
          src="/aeration.mp4"
          muted
          loop
          playsInline
          preload="auto"
          className="w-full h-56 object-cover"
          style={{
            filter: aerationActive ? 'saturate(1.05) brightness(0.95)' : 'grayscale(0.6) brightness(0.55)',
            transition: 'filter 0.6s ease-in-out',
          }}
          data-testid={`aeration-video-${tankNumber}`}
        />
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

// ------------------------- STP Plant Flow Diagram (SVG) -------------------------
const STPPlantDiagram = ({ values = {}, unit = 'mg/L', plantCapacityKld, deviceLabel }) => {
  const cod = typeof values.COD === 'number' ? values.COD : null;
  const bod = typeof values.BOD === 'number' ? values.BOD : null;
  const tss = typeof values.TSS === 'number' ? values.TSS : null;
  const ph  = typeof values.PH === 'number'  ? values.PH  : null;
  const now = new Date().toLocaleString('en-IN', { hour12: true });

  // Design palette — deliberately different from the reference (which used
  // earth-tones + blue). Ours uses teal / emerald / amber / slate.
  return (
    <div className="relative w-full overflow-x-auto bg-gradient-to-br from-slate-50 to-emerald-50 rounded-xl p-4 border border-slate-200" data-testid="stp-plant-diagram">
      <style>{`
        @keyframes stpFlow  { 0% { stroke-dashoffset: 40; } 100% { stroke-dashoffset: 0; } }
        @keyframes stpPulse { 0%,100% { opacity: 0.9; } 50% { opacity: 0.4; } }
        @keyframes stpRotate { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        @keyframes stpBubbles { 0% { cy: 220; opacity: 0; } 20% { opacity: 1; } 100% { cy: 170; opacity: 0; } }
      `}</style>

      {/* Header value cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
        <div className="rounded-lg bg-white shadow-sm border border-slate-200 px-3 py-2">
          <div className="text-[10px] uppercase tracking-widest text-slate-500">Plant</div>
          <div className="text-sm font-semibold text-slate-900 truncate">{deviceLabel || '—'}</div>
          {plantCapacityKld != null && <div className="text-[10px] text-emerald-700 font-mono">{plantCapacityKld} KLD</div>}
        </div>
        {[
          { key: 'PH',  label: 'pH',  value: ph,  unit: '',       color: 'from-fuchsia-500 to-pink-500' },
          { key: 'TSS', label: 'TSS', value: tss, unit,          color: 'from-amber-500 to-orange-500' },
          { key: 'BOD', label: 'BOD', value: bod, unit,          color: 'from-emerald-500 to-teal-500' },
          { key: 'COD', label: 'COD', value: cod, unit,          color: 'from-sky-500 to-cyan-500' },
        ].map((c) => (
          <div key={c.key} className={`rounded-lg text-white shadow-md bg-gradient-to-br ${c.color} px-3 py-2`} data-testid={`stp-card-${c.key.toLowerCase()}`}>
            <div className="text-[10px] uppercase tracking-widest opacity-80">{c.label}</div>
            <div className="text-xl font-bold tabular-nums">
              {c.value != null ? c.value.toFixed(c.key === 'PH' ? 2 : 1) : '—'}
            </div>
            <div className="text-[9px] opacity-80">{c.unit}</div>
          </div>
        ))}
      </div>
      <div className="text-[10px] text-slate-500 mb-2 font-mono">Last data on: {now}</div>

      {/* SVG plant diagram */}
      <svg viewBox="0 0 900 260" className="w-full min-w-[820px]" xmlns="http://www.w3.org/2000/svg">
        {/* Ground line */}
        <line x1="10" y1="245" x2="890" y2="245" stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 3" />

        {/* --- STAGE 1: Bar Screen + Equalization tank --- */}
        <g transform="translate(20,90)">
          <rect x="0" y="0" width="90" height="120" rx="6" fill="#e0f2fe" stroke="#0284c7" strokeWidth="2" />
          <rect x="10" y="15" width="70" height="90" fill="url(#waterGrad1)" />
          {/* Vertical bar screen strips */}
          <g stroke="#475569" strokeWidth="1.5">
            {[15,25,35,45,55,65,75].map(x => <line key={x} x1={x+5} y1="15" x2={x+5} y2="105" />)}
          </g>
          <text x="45" y="135" textAnchor="middle" className="fill-slate-800" fontSize="10" fontWeight="600">Equalization</text>
          <text x="45" y="147" textAnchor="middle" className="fill-slate-500" fontSize="9">Bar Screen</text>
        </g>

        {/* Arrow 1 */}
        <path d="M 115 150 L 155 150" stroke="#0891b2" strokeWidth="3" strokeDasharray="8 4"
              style={{ animation: 'stpFlow 1s linear infinite' }} markerEnd="url(#arrow)" />

        {/* --- STAGE 2: Aeration tank (large, central) --- */}
        <g transform="translate(160,60)">
          <rect x="0" y="30" width="180" height="150" rx="8" fill="#ccfbf1" stroke="#0d9488" strokeWidth="2.5" />
          <rect x="8" y="55" width="164" height="120" fill="url(#waterGrad2)" />
          {/* Bubbles rising */}
          {[20,45,70,95,120,145].map((x, i) => (
            <circle key={x} cx={x + 10} cy={165} r={4 + (i % 2)} fill="#38bdf8" opacity="0.75"
                    style={{ animation: `stpBubbles 2.${(i * 3) % 10}s ease-in ${(i * 0.25)}s infinite` }} />
          ))}
          {/* Diffuser */}
          <rect x="8" y="170" width="164" height="6" fill="#334155" />
          {/* Blower with rotating impeller */}
          <g transform="translate(-30, 90)">
            <rect x="-8" y="-8" width="26" height="20" rx="3" fill="#f97316" />
            <g style={{ transformOrigin: '5px 2px', animation: 'stpRotate 1.4s linear infinite' }}>
              <circle cx="5" cy="2" r="7" fill="#fed7aa" />
              <line x1="-1" y1="2" x2="11" y2="2" stroke="#7c2d12" strokeWidth="1.5" />
              <line x1="5" y1="-4" x2="5" y2="8" stroke="#7c2d12" strokeWidth="1.5" />
            </g>
            <text x="5" y="30" textAnchor="middle" fontSize="8" className="fill-slate-600" fontWeight="600">BLOWER</text>
          </g>
          <text x="90" y="200" textAnchor="middle" className="fill-slate-800" fontSize="11" fontWeight="700">Aeration Tank</text>
          <text x="90" y="212" textAnchor="middle" className="fill-emerald-700" fontSize="9">
            Bacteria + O₂ → CO₂ + H₂O
          </text>
        </g>

        {/* Arrow 2 */}
        <path d="M 345 150 L 385 150" stroke="#0891b2" strokeWidth="3" strokeDasharray="8 4"
              style={{ animation: 'stpFlow 1s linear infinite' }} markerEnd="url(#arrow)" />

        {/* --- STAGE 3: Clarifier (settling) — conical --- */}
        <g transform="translate(390,80)">
          <path d="M 0 0 L 130 0 L 100 90 L 30 90 Z" fill="#fef3c7" stroke="#d97706" strokeWidth="2" />
          <path d="M 8 8 L 122 8 L 96 82 L 34 82 Z" fill="url(#waterGrad3)" />
          {/* Sludge layer */}
          <path d="M 32 78 L 98 78 L 100 90 L 30 90 Z" fill="#78350f" opacity="0.4" />
          {/* Skimmer arm */}
          <line x1="15" y1="4" x2="115" y2="4" stroke="#334155" strokeWidth="2" />
          <text x="65" y="115" textAnchor="middle" className="fill-slate-800" fontSize="10" fontWeight="600">Clarifier</text>
          <text x="65" y="127" textAnchor="middle" className="fill-slate-500" fontSize="9">(Settling)</text>
        </g>

        {/* Arrow 3 */}
        <path d="M 525 150 L 565 150" stroke="#0891b2" strokeWidth="3" strokeDasharray="8 4"
              style={{ animation: 'stpFlow 1s linear infinite' }} markerEnd="url(#arrow)" />

        {/* --- STAGE 4: PSF/ACF filters (two vertical columns) --- */}
        <g transform="translate(570,60)">
          <rect x="0" y="10" width="45" height="170" rx="18" fill="#fdf4ff" stroke="#a21caf" strokeWidth="2" />
          <rect x="4" y="30" width="37" height="130" fill="url(#waterGrad4)" />
          <circle cx="22" cy="100" r="10" fill="#c026d3" opacity="0.4" />
          <text x="22" y="200" textAnchor="middle" className="fill-slate-800" fontSize="9" fontWeight="600">PSF</text>

          <rect x="60" y="10" width="45" height="170" rx="18" fill="#f0fdfa" stroke="#0d9488" strokeWidth="2" />
          <rect x="64" y="30" width="37" height="130" fill="url(#waterGrad4)" />
          <circle cx="82" cy="100" r="10" fill="#14b8a6" opacity="0.4" />
          <text x="82" y="200" textAnchor="middle" className="fill-slate-800" fontSize="9" fontWeight="600">ACF</text>
          <text x="52" y="212" textAnchor="middle" className="fill-slate-500" fontSize="8">Softener</text>
        </g>

        {/* Arrow 4 */}
        <path d="M 690 150 L 730 150" stroke="#0891b2" strokeWidth="3" strokeDasharray="8 4"
              style={{ animation: 'stpFlow 1s linear infinite' }} markerEnd="url(#arrow)" />

        {/* --- STAGE 5: Treated water tank + outlet --- */}
        <g transform="translate(735,90)">
          <rect x="0" y="0" width="90" height="120" rx="6" fill="#dcfce7" stroke="#16a34a" strokeWidth="2" />
          <rect x="10" y="20" width="70" height="85" fill="url(#waterGrad5)" />
          {/* Outlet tap */}
          <rect x="82" y="70" width="18" height="8" fill="#334155" />
          <text x="45" y="135" textAnchor="middle" className="fill-slate-800" fontSize="10" fontWeight="600">Treated</text>
          <text x="45" y="147" textAnchor="middle" className="fill-slate-500" fontSize="9">Gardening / Flush</text>
        </g>

        {/* Gradient defs + arrow marker */}
        <defs>
          <linearGradient id="waterGrad1" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7dd3fc" />
            <stop offset="100%" stopColor="#0369a1" />
          </linearGradient>
          <linearGradient id="waterGrad2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5eead4" />
            <stop offset="100%" stopColor="#0f766e" />
          </linearGradient>
          <linearGradient id="waterGrad3" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fde68a" />
            <stop offset="100%" stopColor="#b45309" />
          </linearGradient>
          <linearGradient id="waterGrad4" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f0abfc" />
            <stop offset="100%" stopColor="#86198f" />
          </linearGradient>
          <linearGradient id="waterGrad5" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#86efac" />
            <stop offset="100%" stopColor="#15803d" />
          </linearGradient>
          <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#0891b2" />
          </marker>
        </defs>
      </svg>
    </div>
  );
};

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
  const [downloading, setDownloading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/api/water-quality/latest?unit=${encodeURIComponent(unit)}`);
      setPayload(data);
      // Auto-select first device for the current tab
      const list = tab === 'stp' ? data.stp : data.do;
      if (list?.length && !selectedHw) setSelectedHw(list[0].hardware_id);
    } catch (e) {
      const msg = formatApiError(e?.response?.data?.detail);
      toast.error(msg);
      setPayload({ error: msg });
    } finally { setLoading(false); }
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
    const list = tab === 'stp' ? payload.stp : payload.do;
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

  const currentList = tab === 'stp' ? (payload?.stp || []) : (payload?.do || []);
  const currentDevice = currentList.find((r) => r.hardware_id === selectedHw);
  const currentValues = currentDevice?.values || {};

  const downloadReport = async () => {
    if (!selectedHw) return;
    if (!reportFrom || !reportTo) { toast.error('Select from + to dates'); return; }
    setDownloading(true);
    try {
      const res = await api.post('/api/water-quality/report', {
        hardware_id: selectedHw,
        from_date: new Date(reportFrom).toISOString(),
        to_date: new Date(reportTo).toISOString(),
        format: reportFormat,
        unit,
      }, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: reportFormat === 'csv' ? 'text/csv' : 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wq_report_${selectedHw}_${reportFrom}_${reportTo}.${reportFormat}`;
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
          <p className="text-gray-600 text-sm">STP effluent + DO meter monitoring with live visualisation</p>
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
          <Wind className="h-4 w-4 inline mr-1" /> DO Meter (Aeration Tanks)
        </button>
      </div>

      {/* Device selector */}
      {currentList.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid="wq-device-picker">
          {currentList.map((d) => {
            const label = d._registry?.label || d.hardware_id;
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
            <p className="font-medium mb-1">No {tab === 'stp' ? 'STP water-quality' : 'DO meter'} devices found</p>
            <p className="text-xs">
              {isAdmin ? 'Register one from the Instruments page with type ' : 'Ask your administrator to register a '}
              <code className="bg-gray-100 px-1 rounded">{tab === 'stp' ? 'wq_stp' : 'do_meter'}</code> to see live data.
            </p>
          </CardContent>
        </Card>
      ) : tab === 'stp' ? (
        <>
          {/* STP: gauges + realistic plant flow diagram */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Gauge className="h-5 w-5 text-sky-500" /> Live Parameters — {currentDevice?._registry?.label || selectedHw}
              </CardTitle>
              <CardDescription>Real-time values from the STP water-quality analyser</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {['COD', 'BOD', 'TSS', 'PH'].map((k) => (
                  <Gauge2D
                    key={k}
                    value={currentValues[k]}
                    min={stpMeta[k]?.min ?? 0}
                    max={stpMeta[k]?.max ?? 100}
                    unit={k === 'PH' ? 'pH' : unit}
                    label={k === 'PH' ? 'pH' : k}
                    safeMin={stpMeta[k]?.safe_min}
                    safeMax={stpMeta[k]?.safe_max}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Treatment Plant Flow</CardTitle>
              <CardDescription>Live plant schematic — animated pipes, aeration blower and bubble diffuser reflect current operation</CardDescription>
            </CardHeader>
            <CardContent>
              <STPPlantDiagram
                values={currentValues}
                unit={unit}
                plantCapacityKld={currentDevice?._registry?.plant_capacity_kld}
                deviceLabel={currentDevice?._registry?.label || selectedHw}
              />
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          {/* DO: two aeration tanks + live camera */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wind className="h-5 w-5 text-sky-500" /> Aeration Tanks — {currentDevice?._registry?.label || selectedHw}
              </CardTitle>
              <CardDescription>Bubble animation speed and density reflect dissolved-oxygen concentration in each tank</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-8">
                <AerationTank
                  tankNumber={1}
                  doValue={currentValues.DO_TANK_1}
                  min={doMeta.DO_TANK_1?.min ?? 0}
                  max={doMeta.DO_TANK_1?.max ?? 20}
                  safeMin={doMeta.DO_TANK_1?.safe_min}
                  safeMax={doMeta.DO_TANK_1?.safe_max}
                  unit={unit}
                  capacityKld={currentDevice?._registry?.tank_capacity_kld}
                />
                <AerationTank
                  tankNumber={2}
                  doValue={currentValues.DO_TANK_2}
                  min={doMeta.DO_TANK_2?.min ?? 0}
                  max={doMeta.DO_TANK_2?.max ?? 20}
                  safeMin={doMeta.DO_TANK_2?.safe_min}
                  safeMax={doMeta.DO_TANK_2?.safe_max}
                  unit={unit}
                  capacityKld={currentDevice?._registry?.tank_capacity_kld}
                />
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
                {isAdmin && ' Admins can configure the stream URL per device.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LiveCameraWidget
                hardwareId={selectedHw}
                deviceLabel={currentDevice?._registry?.label || selectedHw}
                telemetry={{
                  DO_TANK_1: currentValues.DO_TANK_1,
                  DO_TANK_2: currentValues.DO_TANK_2,
                }}
                canManage={isAdmin}
              />
            </CardContent>
          </Card>
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
              <div className="flex items-end">
                <Button onClick={downloadReport} disabled={downloading} className="w-full" data-testid="wq-report-download">
                  {downloading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                  Download
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default WaterQuality;
