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
import HistoricalDataPanel from '../components/HistoricalDataPanel';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { cleanLabel } from '../utils/labels';

import { Gauge2D, AerationTank, DoseRecommendation } from '../components/wq/WQWidgets';
import { STPPlantDiagram } from '../components/wq/STPPlantDiagram';
import { DoTankLinker } from '../components/wq/DoTankLinker';

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
          <HistoricalDataPanel hardwareId={selectedHw} unit={unit} deviceLabel={cleanLabel(currentDevice?._registry?.label || selectedHw)} />
        </>
      ) : tab === 'do' ? (
        <>
          {/* DO: two aeration tanks + live camera */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Wind className="h-5 w-5 text-sky-500" /> DO Analyzer — Aeration Tanks
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
            </CardHeader>
            <CardContent>
              {isAdmin && Array.isArray(currentDevice?._do_siblings) && currentDevice._do_siblings.length > 0 && (
                <DoTankLinker
                  siblings={currentDevice._do_siblings}
                  onChanged={() => load()}
                />
              )}
              {(() => {
                let tn = currentDevice?._registry?.aeration_tank_number;
                // Fallback: if the registry hasn't been configured with an
                // aeration_tank_number yet, infer it from whichever
                // DO_TANK_N key the poller baked in. Prevents a totally
                // blank card for legacy devices provisioned before the
                // inline linker existed.
                if (!tn) {
                  for (const k of Object.keys(currentValues)) {
                    const m = /^DO_TANK_(\d+)$/.exec(k);
                    if (m && currentValues[k] != null) { tn = parseInt(m[1], 10); break; }
                  }
                }
                if (!tn) {
                  return (
                    <div
                      className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
                      data-testid="do-no-tank-assigned"
                    >
                      This DO device isn&apos;t linked to an aeration tank yet.
                      {isAdmin
                        ? ' Use the dropdown above to link it to Tank 1 or Tank 2.'
                        : ' Ask your admin to link it to a tank.'}
                    </div>
                  );
                }
                const doValue = currentValues[`DO_TANK_${tn}`];
                const meta = doMeta[`DO_TANK_${tn}`] || doMeta.DO_TANK_1 || {};
                const cap = currentDevice?._registry?.do_tank_config?.[`tank_${tn}_kld`]
                  ?? currentDevice?._registry?.tank_capacity_kld;
                const vidKey = `tank_${tn}`;
                const vidPath = currentDevice?._registry?.aeration_videos?.[vidKey];
                return (
                  <div className="max-w-2xl mx-auto" data-testid={`do-tank-${tn}-card`}>
                    <AerationTank
                      tankNumber={tn}
                      doValue={doValue}
                      min={meta.min ?? 0}
                      max={meta.max ?? 20}
                      safeMin={meta.safe_min}
                      safeMax={meta.safe_max}
                      unit={unit}
                      capacityKld={cap}
                      videoSrc={vidPath ? backendAssetUrl(vidPath) : null}
                      isCustomVideo={Boolean(vidPath)}
                      temperatureC={typeof currentValues.TEMPER === 'number' ? currentValues.TEMPER : null}
                      saturationPct={typeof currentValues.DO_SATURATION === 'number' ? currentValues.DO_SATURATION : null}
                    />
                    <AerationVideoUploader
                      hardwareId={selectedHw}
                      tankNumber={tn}
                      currentUrl={vidPath}
                      canManage={isAdmin}
                      onChange={() => load()}
                    />
                  </div>
                );
              })()}
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
                telemetry={(() => {
                  let tn = currentDevice?._registry?.aeration_tank_number;
                  if (!tn) {
                    for (const k of Object.keys(currentValues)) {
                      const m = /^DO_TANK_(\d+)$/.exec(k);
                      if (m && currentValues[k] != null) { tn = parseInt(m[1], 10); break; }
                    }
                  }
                  return tn ? { [`DO_TANK_${tn}`]: currentValues[`DO_TANK_${tn}`] } : {};
                })()}
                canManage={isAdmin}
              />
            </CardContent>
          </Card>
          <HistoricalDataPanel
            hardwareId={selectedHw}
            unit={unit}
            deviceLabel={cleanLabel(currentDevice?._registry?.label || selectedHw)}
            hideParams={(() => {
              // A physical DO analyzer only measures ONE tank. Hide the
              // other tank's column so it doesn't pollute the table
              // with a full column of "—".
              const tn = currentDevice?._registry?.aeration_tank_number;
              if (tn === 1) return ['DO_TANK_2'];
              if (tn === 2) return ['DO_TANK_1'];
              return [];
            })()}
          />
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
          <HistoricalDataPanel hardwareId={selectedHw} unit={unit} deviceLabel={cleanLabel(currentDevice?._registry?.label || selectedHw)} />
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
