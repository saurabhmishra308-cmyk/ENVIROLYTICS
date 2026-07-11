import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { toast } from 'sonner';
import { Droplets, Gauge, FlaskConical, Wind, Download, FileText, Loader2, RefreshCw } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import api from '../lib/api';
import { formatApiError } from '../lib/errors';
import { isAdmin as _isAdmin } from '../mockData';

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

// ------------------------- Aeration tank visualisation -------------------------
const AerationTank = ({ tankNumber, doValue, min = 0, max = 20, safeMin = 2, safeMax = 8, unit = 'mg/L' }) => {
  const v = typeof doValue === 'number' ? doValue : null;
  // Bubble density and speed scale with DO — more oxygen = more/faster bubbles.
  const bubbleCount = v == null ? 6 : Math.max(4, Math.min(24, Math.round(v * 1.8)));
  const speed = v == null ? 5 : Math.max(1.4, 5 - (v / max) * 3.5); // seconds per rise
  const alarm = v != null && (v < safeMin || v > safeMax);
  const fillHeight = v == null ? 60 : 55 + Math.min(20, (v / max) * 20);

  const bubbles = Array.from({ length: bubbleCount }, (_, i) => ({
    left: 6 + Math.random() * 88,
    delay: (i / bubbleCount) * speed,
    size: 6 + Math.random() * 8,
  }));

  return (
    <div className="relative w-full max-w-[280px] mx-auto" data-testid={`aeration-tank-${tankNumber}`}>
      <style>{`
        @keyframes bubbleRise-${tankNumber} {
          0% { transform: translateY(0) scale(0.6); opacity: 0; }
          15% { opacity: 0.9; }
          85% { opacity: 0.7; }
          100% { transform: translateY(-140px) scale(1); opacity: 0; }
        }
      `}</style>
      {/* Tank body */}
      <div
        className={`relative rounded-b-2xl rounded-t-md border-4 ${alarm ? 'border-red-400' : 'border-sky-400'} overflow-hidden`}
        style={{
          height: 220,
          background: 'linear-gradient(180deg, #dbeafe 0%, #93c5fd 30%, #3b82f6 100%)',
          boxShadow: 'inset 0 -15px 25px rgba(0,0,0,0.25), 0 8px 20px rgba(0,0,0,0.15)',
        }}
      >
        {/* Water surface shimmer */}
        <div className="absolute left-0 right-0 h-2 bg-white/50" style={{ top: `${100 - fillHeight}%` }} />
        {/* Bubbles */}
        {bubbles.map((b, i) => (
          <span key={i}
            className="absolute rounded-full bg-white/70"
            style={{
              left: `${b.left}%`, bottom: '4px', width: b.size, height: b.size,
              animation: `bubbleRise-${tankNumber} ${speed}s ease-in ${b.delay}s infinite`,
              boxShadow: 'inset -1px -1px 3px rgba(255,255,255,0.7), 0 0 3px rgba(255,255,255,0.5)',
            }}
          />
        ))}
        {/* Digital display panel */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-black/80 text-white rounded-md px-3 py-2 backdrop-blur-sm">
          <div className="text-[9px] uppercase tracking-widest opacity-70 text-center">Tank {tankNumber} DO</div>
          <div className={`text-2xl font-mono font-bold text-center tabular-nums ${alarm ? 'text-red-400' : 'text-emerald-300'}`}>
            {v != null ? v.toFixed(2) : '--.--'}
          </div>
          <div className="text-[9px] uppercase tracking-widest opacity-70 text-center">{unit}</div>
        </div>
        {/* Diffuser at bottom */}
        <div className="absolute bottom-0 left-0 right-0 h-3 bg-gray-700 border-t-2 border-gray-800" />
      </div>
      {/* Base */}
      <div className="h-2 bg-gray-500 rounded-b-md" style={{ width: 'calc(100% + 20px)', marginLeft: -10 }} />
      <div className="mt-2 text-center">
        <div className="text-xs font-semibold text-gray-800">Aeration Tank {tankNumber}</div>
        <div className="text-[10px] text-gray-500">Safe range: {safeMin}–{safeMax} {unit}</div>
        {alarm && <Badge variant="destructive" className="mt-1 text-[10px]">⚠ Out of safe range</Badge>}
      </div>
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
          {/* STP: gauges + flow animation */}
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
              <div className="mt-8 pt-6 border-t">
                <div className="text-sm font-semibold text-gray-700 mb-2">Treatment Process Flow</div>
                <STPProcessFlow values={currentValues} />
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          {/* DO: two aeration tanks */}
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
                />
                <AerationTank
                  tankNumber={2}
                  doValue={currentValues.DO_TANK_2}
                  min={doMeta.DO_TANK_2?.min ?? 0}
                  max={doMeta.DO_TANK_2?.max ?? 20}
                  safeMin={doMeta.DO_TANK_2?.safe_min}
                  safeMax={doMeta.DO_TANK_2?.safe_max}
                  unit={unit}
                />
              </div>
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
