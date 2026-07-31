import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import api, { formatApiError } from '../lib/api';

const RANGES = [
  { key: 'raw',       label: 'Raw' },
  { key: 'weekly',    label: 'Weekly' },
  { key: 'monthly',   label: 'Monthly' },
  { key: 'quarterly', label: 'Quarterly' },
  { key: 'yearly',    label: 'Yearly' },
];

const csvEscape = (v) => {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// A single reusable panel that renders a table of historical readings for
// a WQ device. Uses `/api/water-quality/history/{hardware_id}?range=…` —
// `raw` returns a `rows` array (every reading), the others return a
// `series` array of bucket-averaged values.
export const HistoricalDataPanel = ({ hardwareId, unit, deviceLabel }) => {
  const [range, setRange] = useState('raw');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchHistory = async () => {
    if (!hardwareId) return;
    setLoading(true);
    try {
      const { data: d } = await api.get(
        `/api/water-quality/history/${encodeURIComponent(hardwareId)}?range=${range}&unit=${encodeURIComponent(unit || 'mg/L')}`
      );
      setData(d);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Failed to load historical data');
      setData(null);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchHistory(); }, [hardwareId, range, unit]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    if (!data) return [];
    if (range === 'raw') return data.rows || [];
    return data.series || [];
  }, [data, range]);

  const isRaw = range === 'raw';
  const params = data?.params || [];
  const timestampKey = isRaw ? 'received_at' : 'bucket';
  const timestampLabel = isRaw ? 'Timestamp' : 'Bucket';

  const downloadCsv = () => {
    if (!rows.length) return;
    const header = [timestampLabel, ...params].map(csvEscape).join(',');
    const body = rows.map((r) => [
      isRaw && r[timestampKey] ? new Date(r[timestampKey]).toLocaleString('en-IN', { hour12: false }) : r[timestampKey],
      ...params.map((p) => r[p] ?? ''),
    ].map(csvEscape).join(',')).join('\n');
    const blob = new Blob([`${header}\n${body}`], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `history_${hardwareId}_${range}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="mt-6" data-testid="wq-history-panel">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            📊 Historical Data{deviceLabel ? ` — ${deviceLabel}` : ''}
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={`px-3 py-1 text-xs rounded-full border transition ${
                  range === r.key
                    ? 'bg-sky-600 text-white border-sky-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
                data-testid={`wq-history-range-${r.key}`}
              >
                {r.label}
              </button>
            ))}
            <Button size="sm" variant="outline" onClick={fetchHistory} disabled={loading} data-testid="wq-history-refresh">
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            </Button>
            <Button size="sm" variant="outline" onClick={downloadCsv} disabled={!rows.length} data-testid="wq-history-download">
              <Download className="h-3 w-3 mr-1" /> CSV
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-gray-500 py-6 text-center">Loading…</p>
        ) : !rows.length ? (
          <p className="text-sm italic text-gray-500 py-6 text-center" data-testid="wq-history-empty">
            No historical readings in this range yet.
          </p>
        ) : (
          <div className="overflow-x-auto max-h-[420px] border rounded">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-100 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">{timestampLabel}</th>
                  {params.map((p) => (
                    <th key={p} className="px-3 py-2 text-right font-semibold text-gray-700">
                      {p}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(isRaw ? rows : [...rows].reverse()).map((r, idx) => (
                  <tr key={idx} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-1.5 tabular-nums text-gray-800 whitespace-nowrap">
                      {isRaw && r[timestampKey]
                        ? new Date(r[timestampKey]).toLocaleString('en-IN', { hour12: false })
                        : r[timestampKey]}
                    </td>
                    {params.map((p) => (
                      <td key={p} className="px-3 py-1.5 text-right tabular-nums text-gray-800">
                        {r[p] != null ? Number(r[p]).toFixed(2) : '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default HistoricalDataPanel;
