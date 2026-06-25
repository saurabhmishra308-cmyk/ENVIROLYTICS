import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { isAuthenticated, getCurrentUser, mockLogout } from '../mockData';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Progress } from '../components/ui/progress';
import { LogOut, ArrowLeft, Waves, MapPin, Activity, Thermometer, Inbox, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import api, { formatApiError } from '../lib/api';

const fmt = (n, d = 2) => (typeof n === 'number' && !Number.isNaN(n) ? n.toFixed(d) : '—');

const statusFor = (mwc) => {
  if (typeof mwc !== 'number') return { label: 'No data', color: 'bg-gray-400', tone: '#94a3b8' };
  if (mwc < 5) return { label: 'Critical Low', color: 'bg-red-500', tone: '#dc2626' };
  if (mwc < 10) return { label: 'Low', color: 'bg-amber-500', tone: '#f59e0b' };
  return { label: 'Normal', color: 'bg-green-500', tone: '#16a34a' };
};

const WaterLevelRecorder = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [borewells, setBorewells] = useState([]); // [{hardware_id, label, level_mwc, temperature_c, last_seen, never_reported}]
  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState([]); // daily aggregated
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const handleLogout = useCallback(() => {
    mockLogout();
    navigate('/');
  }, [navigate]);

  const fetchData = useCallback(async () => {
    setRefreshing(true);
    try {
      // 1) Get user's DWLR registry entries (admin sees all)
      const regRes = await api.get('/api/instrument-registry?instrument_type=dwlr');
      const registered = regRes?.data?.instruments || [];

      // 2) Get latest readings for DWLR
      const latestRes = await api.get('/api/instruments/dwlr/latest').catch(() => ({ data: { instruments: [] } }));
      const latestByHw = {};
      for (const it of latestRes?.data?.instruments || []) {
        latestByHw[it.hardware_id] = it;
      }

      // 3) Merge: every registered DWLR gets a tile (even if never reported)
      const merged = registered.map((reg) => {
        const lt = latestByHw[reg.hardware_id];
        const vals = lt?.values || {};
        const level = typeof vals.LEVEL === 'number' ? vals.LEVEL
                    : typeof vals.level === 'number' ? vals.level
                    : null;
        const temp = typeof vals.TEMPER === 'number' ? vals.TEMPER
                    : typeof vals.temperature === 'number' ? vals.temperature
                    : null;
        return {
          hardware_id: reg.hardware_id,
          label: reg.label || reg.hardware_id,
          location_name: reg.location_name,
          latitude: reg.latitude,
          longitude: reg.longitude,
          level_mwc: level,
          temperature_c: temp,
          received_at: lt?.received_at || lt?.timestamp || null,
          never_reported: !lt,
        };
      });

      setBorewells(merged);
      if (merged.length && !selected) setSelected(merged[0].hardware_id);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Failed to load DWLR data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selected]);

  const fetchHistory = useCallback(async (hw) => {
    if (!hw) { setHistory([]); return; }
    try {
      const { data } = await api.get(`/api/flowmeter-mgmt/dwlr/${encodeURIComponent(hw)}/daily?days=30`);
      setHistory(data?.series || []);
    } catch (e) {
      setHistory([]);
      if (process.env.NODE_ENV === 'development') console.warn('[dwlr daily]', e?.response?.status);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) {
      navigate('/');
      return;
    }
    setUser(getCurrentUser());
    fetchData();
    const i = setInterval(fetchData, 60000);
    return () => clearInterval(i);
  }, [navigate, fetchData]);

  useEffect(() => {
    if (selected) fetchHistory(selected);
  }, [selected, fetchHistory]);

  if (!user) return null;

  const activeWell = borewells.find((b) => b.hardware_id === selected);
  const lvl = activeWell?.level_mwc;
  const lvlStatus = statusFor(lvl);

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f5f5f5' }}>
      {/* Header */}
      <header className="shadow-md" style={{ backgroundColor: '#1a2332' }}>
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Link to="/dashboard">
              <Button variant="ghost" size="sm" className="text-white hover:text-white hover:bg-white/10">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-white font-bold text-xl tracking-wide" style={{ color: '#4a9fd8' }}>ENVIROLYTICS</h1>
              <p className="text-white text-[8px] tracking-wider" style={{ opacity: 0.7 }}>SUSTAINABILITY PRIVATE LIMITED</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-white text-sm">
              <p className="font-medium">{user.fullName}</p>
              <p className="text-gray-300 text-xs">{user.username}</p>
            </div>
            <Button onClick={handleLogout} variant="outline" className="border-white text-white hover:text-white">
              <LogOut className="h-4 w-4 mr-2" /> Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* Page Header */}
        <div className="mb-6 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-lg" style={{ backgroundColor: '#27ae60' }}>
              <Waves className="h-8 w-8 text-white" />
            </div>
            <div>
              <h2 className="text-3xl font-bold" style={{ color: '#1a2332' }}>
                Digital Water Level Recorder (DWLR)
              </h2>
              <p className="text-gray-600">Live groundwater levels in mWC + ground-water temperature for your assigned borewells.</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={fetchData} disabled={refreshing} data-testid="dwlr-refresh">
            <RefreshCw className={`h-4 w-4 mr-1 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>

        {loading ? (
          <p className="text-gray-500">Loading DWLR data…</p>
        ) : borewells.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-10 text-center">
              <Inbox className="h-10 w-10 mx-auto text-gray-300" />
              <p className="text-sm text-gray-600 mt-2">
                No DWLR instruments are assigned to your account yet.
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Ask your administrator to register a DWLR instrument under your account from the User Management → Add User wizard.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Primary Monitoring + Live tile selector */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              <Card className="border-t-4" style={{ borderTopColor: '#27ae60' }} data-testid="dwlr-live-card">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span style={{ color: '#1a2332' }}>{activeWell?.label || 'Borewell'}</span>
                    <Badge className={`${lvlStatus.color} text-white`}>{lvlStatus.label}</Badge>
                  </CardTitle>
                  <CardDescription>
                    {activeWell?.location_name || activeWell?.hardware_id}
                    {activeWell?.received_at && (
                      <span className="ml-2 text-xs text-gray-400">
                        · Last seen {new Date(activeWell.received_at).toLocaleString()}
                      </span>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-center py-4">
                    <div className="inline-flex items-baseline gap-2 mb-2">
                      <span className="text-6xl font-bold tabular-nums" style={{ color: lvlStatus.tone }}>
                        {fmt(lvl)}
                      </span>
                      <span className="text-2xl font-semibold text-gray-600">mWC</span>
                    </div>
                    {activeWell?.never_reported && (
                      <p className="text-xs text-amber-700 mt-1">No telemetry received yet for this borewell.</p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3 mt-4">
                    <div className="p-3 bg-blue-50 rounded-lg">
                      <p className="text-xs text-gray-600 mb-1 flex items-center gap-1">
                        <Thermometer className="h-3 w-3" /> Ground-water Temperature
                      </p>
                      <p className="text-xl font-bold tabular-nums" style={{ color: '#1a2332' }}>
                        {typeof activeWell?.temperature_c === 'number' ? `${fmt(activeWell.temperature_c, 1)} °C` : '—'}
                      </p>
                    </div>
                    <div className="p-3 bg-green-50 rounded-lg">
                      <p className="text-xs text-gray-600 mb-1">Hardware ID</p>
                      <p className="text-sm font-mono break-all" style={{ color: '#27ae60' }}>{activeWell?.hardware_id}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-t-4" style={{ borderTopColor: '#4a9fd8' }}>
                <CardHeader>
                  <CardTitle style={{ color: '#1a2332' }}>System Health</CardTitle>
                  <CardDescription>Operational summary for your assigned borewells</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Total borewells</span>
                      <span className="font-semibold tabular-nums">{borewells.length}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Reporting</span>
                      <span className="font-semibold tabular-nums">{borewells.filter((b) => !b.never_reported).length}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Never reported</span>
                      <span className="font-semibold tabular-nums">{borewells.filter((b) => b.never_reported).length}</span>
                    </div>
                  </div>
                  <div className="mt-6 p-4 rounded-lg flex items-center gap-2" style={{ backgroundColor: '#e8f5e9' }}>
                    <Activity className="h-5 w-5" style={{ color: '#27ae60' }} />
                    <p className="text-sm text-gray-700">
                      Telemetry alerts for these borewells will be sent automatically to <strong>{user.username}</strong>.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* All Borewells */}
            <Card className="mb-8">
              <CardHeader>
                <CardTitle style={{ color: '#1a2332' }}>All Borewell Locations</CardTitle>
                <CardDescription>Click a row to view its 30-day daily trend below.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3" data-testid="dwlr-borewell-list">
                  {borewells.map((well) => {
                    const s = statusFor(well.level_mwc);
                    const isSel = well.hardware_id === selected;
                    return (
                      <button
                        key={well.hardware_id}
                        type="button"
                        onClick={() => setSelected(well.hardware_id)}
                        data-testid={`dwlr-row-${well.hardware_id}`}
                        className={`w-full text-left p-4 rounded-lg border transition-all ${isSel ? 'ring-2 ring-blue-400' : 'hover:shadow-md'}`}
                        style={{
                          backgroundColor: well.never_reported ? '#fff8f0' : '#ffffff',
                          borderColor: well.never_reported ? '#f5a623' : '#e0e0e0',
                          borderWidth: '2px',
                        }}
                      >
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                          <div className="flex items-start gap-3 min-w-0">
                            <MapPin className="h-5 w-5 mt-1 shrink-0" style={{ color: '#27ae60' }} />
                            <div className="min-w-0">
                              <h3 className="font-bold text-lg truncate" style={{ color: '#1a2332' }}>{well.label}</h3>
                              <p className="text-sm text-gray-600 truncate">{well.location_name || well.hardware_id}</p>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 flex-1">
                            <div>
                              <p className="text-xs text-gray-500">Water Level</p>
                              <p className="text-lg font-bold tabular-nums" style={{ color: s.tone }}>{fmt(well.level_mwc)} mWC</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500">Temperature</p>
                              <p className="text-lg font-bold tabular-nums" style={{ color: '#1a2332' }}>
                                {typeof well.temperature_c === 'number' ? `${fmt(well.temperature_c, 1)} °C` : '—'}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500">Last Seen</p>
                              <p className="text-sm font-medium" style={{ color: '#1a2332' }}>
                                {well.received_at ? new Date(well.received_at).toLocaleString() : 'Never'}
                              </p>
                            </div>
                            <div className="flex items-center">
                              <Badge className={`${s.color} text-white`}>{s.label}</Badge>
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Historical Daily Trend */}
            <Card>
              <CardHeader>
                <CardTitle style={{ color: '#1a2332' }}>Daily Trend — {activeWell?.label || selected}</CardTitle>
                <CardDescription>UTC-day average for the last {history.length || 0} day{history.length === 1 ? '' : 's'}.</CardDescription>
              </CardHeader>
              <CardContent>
                {history.length === 0 ? (
                  <p className="text-sm text-gray-500 italic">No daily readings yet for this borewell.</p>
                ) : (
                  <div className="space-y-2" data-testid="dwlr-daily-list">
                    {history.map((d) => {
                      const s = statusFor(d.level_mwc);
                      const pct = typeof d.level_mwc === 'number' ? Math.min(100, Math.max(2, d.level_mwc * 4)) : 0;
                      return (
                        <div key={d.date} className="flex items-center gap-4">
                          <div className="w-28 text-sm font-medium" style={{ color: '#1a2332' }}>{d.date}</div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <div
                                className="h-7 rounded transition-all"
                                style={{ width: `${pct}%`, backgroundColor: s.tone }}
                              />
                              <span className="text-sm font-semibold tabular-nums" style={{ color: '#1a2332' }}>
                                {fmt(d.level_mwc)} mWC
                                {typeof d.temperature_c === 'number' && (
                                  <span className="text-xs text-gray-500 ml-2">· {fmt(d.temperature_c, 1)} °C</span>
                                )}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>

      <footer className="mt-12 py-4" style={{ backgroundColor: '#1a2332' }}>
        <div className="container mx-auto px-4 text-center text-white text-sm">
          <p>© 2026 Envirolytics Sustainability Private Limited. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default WaterLevelRecorder;
