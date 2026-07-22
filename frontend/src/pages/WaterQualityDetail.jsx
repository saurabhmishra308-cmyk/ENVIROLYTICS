import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, ComposedChart, ScatterChart, Scatter,
} from 'recharts';
import { isAuthenticated, getCurrentUser, mockLogout } from '../mockData';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { ArrowLeft, LogOut, Beaker, Droplets, TrendingUp, AlertOctagon, CheckCircle2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import api, { formatApiError } from '../lib/api';

const fmt = (v, d = 2) => (typeof v === 'number' && !Number.isNaN(v) ? v.toFixed(d) : '—');

const paramLabels = {
  PH: 'pH', DO: 'DO (mg/L)', BOD: 'BOD (mg/L)', COD: 'COD (mg/L)',
  TSS: 'TSS (mg/L)', CHLORINE: 'Chlorine (mg/L)', TURBIDITY: 'Turbidity (NTU)',
  TDS: 'TDS (mg/L)', COND: 'Conductivity (µS/cm)', TEMPER: 'Temp (°C)', ORP: 'ORP (mV)',
};

const paramColors = {
  PH: '#8e44ad', DO: '#3498db', BOD: '#e74c3c', COD: '#c0392b',
  TSS: '#f39c12', CHLORINE: '#2ecc71', TURBIDITY: '#95a5a6',
  TDS: '#16a085', COND: '#2980b9', TEMPER: '#e67e22', ORP: '#7f8c8d',
};

const chlorineStyle = {
  ok:       { bg: 'bg-green-50 border-green-200',  text: 'text-green-800',  Icon: CheckCircle2 },
  increase: { bg: 'bg-red-50 border-red-200',      text: 'text-red-800',    Icon: AlertOctagon },
  decrease: { bg: 'bg-amber-50 border-amber-200',  text: 'text-amber-800',  Icon: AlertOctagon },
  unknown:  { bg: 'bg-gray-50 border-gray-200',    text: 'text-gray-600',   Icon: AlertOctagon },
};

const WaterQualityDetail = () => {
  const { hardwareId } = useParams();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hours, setHours] = useState(24);

  const handleLogout = useCallback(() => { mockLogout(); navigate('/'); }, [navigate]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res } = await api.get(`/api/flowmeter-mgmt/water-quality/${encodeURIComponent(hardwareId)}/history?hours=${hours}`);
      setData(res);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Failed to load history');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [hardwareId, hours]);

  useEffect(() => {
    if (!isAuthenticated()) { navigate('/'); return; }
    setUser(getCurrentUser());
    fetchData();
    const t = setInterval(fetchData, 60000);
    return () => clearInterval(t);
  }, [navigate, fetchData]);

  const series = useMemo(() => data?.series || [], [data]);
  const latest = series[series.length - 1];
  const chartData = useMemo(() => series.map((p) => ({ ...p, t: new Date(p.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })), [series]);
  const chlorine = data?.chlorine || {};
  const clStyle = chlorineStyle[chlorine.status] || chlorineStyle.unknown;

  if (!user) return null;

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#f5f5f5' }}>
      <header className="shadow-md" style={{ backgroundColor: '#1a2332' }}>
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Link to="/dashboard">
              <Button variant="ghost" size="sm" className="text-white hover:bg-white/10">
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
        <div className="mb-6 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-lg" style={{ backgroundColor: '#8e44ad' }}>
              <Beaker className="h-8 w-8 text-white" />
            </div>
            <div>
              <h2 className="text-3xl font-bold" style={{ color: '#1a2332' }}>
                Water Quality — {data?.label || hardwareId}
              </h2>
              <p className="text-gray-600">
                Live pH, DO, BOD, COD, TSS, Chlorine trends. Data updates every 5 min from{' '}
                <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{hardwareId}</code>.
              </p>
            </div>
          </div>
          <div className="flex gap-2 items-center">
            <select
              className="border rounded px-2 py-1.5 text-sm"
              value={hours}
              onChange={(e) => setHours(parseInt(e.target.value, 10))}
              data-testid="wq-range"
            >
              <option value={1}>Last 1 hour</option>
              <option value={6}>Last 6 hours</option>
              <option value={24}>Last 24 hours</option>
              <option value={168}>Last 7 days</option>
              <option value={720}>Last 30 days</option>
            </select>
            <Button variant="outline" size="sm" onClick={fetchData} disabled={loading} data-testid="wq-refresh">
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </Button>
          </div>
        </div>

        {/* Chlorine dosing status banner */}
        <Card className={`mb-6 border-2 ${clStyle.bg}`}>
          <CardContent className="py-4 flex items-center gap-4">
            <clStyle.Icon className={`h-8 w-8 ${clStyle.text}`} />
            <div className="flex-1">
              <p className={`text-xs uppercase tracking-widest font-semibold ${clStyle.text}`}>
                Chlorine dosing recommendation
              </p>
              <p className={`text-lg font-semibold ${clStyle.text}`} data-testid="wq-chlorine-status">
                {chlorine.message || '—'}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Target band: {chlorine.increase_below_mg_l ?? '—'} – {chlorine.decrease_above_mg_l ?? '—'} mg/L free chlorine (goal {chlorine.target_mg_l ?? '—'} mg/L)
              </p>
            </div>
            {typeof chlorine.latest_mg_l === 'number' && (
              <div className="text-right">
                <p className="text-[10px] uppercase text-gray-500 tracking-wider">Latest reading</p>
                <p className="text-3xl font-bold tabular-nums" style={{ color: paramColors.CHLORINE }}>
                  {fmt(chlorine.latest_mg_l)} <span className="text-sm text-gray-500">mg/L</span>
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Latest tiles */}
        {latest && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6" data-testid="wq-latest-tiles">
            {['PH', 'DO', 'BOD', 'COD', 'TSS', 'CHLORINE'].map((k) => (
              typeof latest[k] === 'number' ? (
                <Card key={k}>
                  <CardContent className="py-4 text-center">
                    <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: paramColors[k] }}>{paramLabels[k]}</p>
                    <p className="text-2xl font-bold tabular-nums mt-1" style={{ color: '#1a2332' }}>{fmt(latest[k])}</p>
                  </CardContent>
                </Card>
              ) : (
                <Card key={k} className="opacity-40">
                  <CardContent className="py-4 text-center">
                    <p className="text-[10px] uppercase tracking-widest font-semibold text-gray-500">{paramLabels[k]}</p>
                    <p className="text-2xl font-bold tabular-nums mt-1 text-gray-400">—</p>
                  </CardContent>
                </Card>
              )
            ))}
          </div>
        )}

        {series.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center">
              <Beaker className="h-10 w-10 mx-auto text-gray-300" />
              <p className="text-sm text-gray-600 mt-2">
                No water-quality readings in the selected window.
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Once the ESPL device starts publishing readings for pH / BOD / COD / TSS / Chlorine they will appear here.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* BOD vs COD */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">BOD vs COD trend</CardTitle>
                <CardDescription>Organic load — both mg/L, over selected window</CardDescription>
              </CardHeader>
              <CardContent style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="t" fontSize={11} />
                    <YAxis fontSize={11} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="BOD" stroke={paramColors.BOD} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="COD" stroke={paramColors.COD} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* TSS vs Turbidity correlation */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">TSS vs Turbidity correlation</CardTitle>
                <CardDescription>Solids scattered against turbidity readings</CardDescription>
              </CardHeader>
              <CardContent style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis type="number" dataKey="TSS" name="TSS mg/L" fontSize={11} />
                    <YAxis type="number" dataKey="TURBIDITY" name="Turbidity NTU" fontSize={11} />
                    <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                    <Scatter data={chartData.filter((p) => p.TSS != null && p.TURBIDITY != null)} fill={paramColors.TSS} />
                  </ScatterChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Combined pH, Chlorine, TSS */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">pH, Chlorine & TSS combined view</CardTitle>
                <CardDescription>pH on left axis, TSS bars & Chlorine line on right axis</CardDescription>
              </CardHeader>
              <CardContent style={{ height: 320 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="t" fontSize={11} />
                    <YAxis yAxisId="ph" orientation="left" domain={[0, 14]} fontSize={11} />
                    <YAxis yAxisId="right" orientation="right" fontSize={11} />
                    <Tooltip />
                    <Legend />
                    <Bar yAxisId="right" dataKey="TSS" fill={paramColors.TSS} name="TSS (mg/L)" opacity={0.65} />
                    <Line yAxisId="right" type="monotone" dataKey="CHLORINE" stroke={paramColors.CHLORINE} strokeWidth={2} name="Cl (mg/L)" dot={false} />
                    <Line yAxisId="ph" type="monotone" dataKey="PH" stroke={paramColors.PH} strokeWidth={2} name="pH" dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* DO trend */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Droplets className="h-4 w-4" style={{ color: paramColors.DO }} /> Dissolved Oxygen trend
                </CardTitle>
                <CardDescription>DO in mg/L (higher = healthier effluent)</CardDescription>
              </CardHeader>
              <CardContent style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="t" fontSize={11} />
                    <YAxis fontSize={11} />
                    <Tooltip />
                    <Line type="monotone" dataKey="DO" stroke={paramColors.DO} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Chlorine trend */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" style={{ color: paramColors.CHLORINE }} /> Free Chlorine trend
                </CardTitle>
                <CardDescription>Shaded band = safe operating window</CardDescription>
              </CardHeader>
              <CardContent style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="t" fontSize={11} />
                    <YAxis fontSize={11} />
                    <Tooltip />
                    <Line type="monotone" dataKey="CHLORINE" stroke={paramColors.CHLORINE} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        )}

        <div className="text-xs text-gray-400 mt-6">
          Data source: <Badge variant="outline" className="ml-1 font-mono text-[10px]">{data?.instrument_type || '—'}</Badge>{' '}
          · {series.length} readings shown · Auto-refresh every 60 s
        </div>
      </main>

      <footer className="mt-12 py-4" style={{ backgroundColor: '#1a2332' }}>
        <div className="container mx-auto px-4 text-center text-white text-sm">
          <p>© 2026 Envirolytics Sustainability Private Limited. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default WaterQualityDetail;
