import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Video, Shield, Search, Cpu } from 'lucide-react';
import api, { formatApiError } from '../lib/api';
import { isAdmin } from '../mockData';
import { toast } from 'sonner';
import { cleanLabel } from '../utils/labels';
import { LiveCameraWidget } from '../components/LiveCameraWidget';

/**
 * Admin Cameras Manager — single page listing every registered instrument
 * across all clients, each embedded with the LiveCameraWidget so admin can
 * upload / edit videos for any device without hopping between clients.
 *
 * Filters:
 *   * client dropdown (owner)
 *   * instrument-type dropdown
 *   * free-text search on hardware_id / label
 */
export default function Cameras() {
  const admin = isAdmin();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [clientFilter, setClientFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [search, setSearch] = useState('');

  const refresh = useCallback(async () => {
    if (!admin) { setLoading(false); return; }
    setLoading(true);
    try {
      const { data } = await api.get('/api/instrument-registry');
      setItems(data.instruments || []);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Failed to load instruments');
    } finally {
      setLoading(false);
    }
  }, [admin]);

  useEffect(() => { refresh(); }, [refresh]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return items.filter((it) => {
      if (clientFilter && it.owner_user_id !== clientFilter) return false;
      if (typeFilter && it.instrument_type !== typeFilter) return false;
      if (s) {
        const blob = `${it.hardware_id} ${it.label || ''} ${it.owner_name || ''} ${it.owner_email || ''}`.toLowerCase();
        if (!blob.includes(s)) return false;
      }
      return true;
    });
  }, [items, clientFilter, typeFilter, search]);

  const clients = useMemo(() => {
    const seen = new Map();
    for (const it of items) {
      if (it.owner_user_id && !seen.has(it.owner_user_id)) {
        seen.set(it.owner_user_id, {
          id: it.owner_user_id,
          label: it.owner_name || it.owner_email || it.owner_user_id,
        });
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [items]);

  const types = useMemo(() => {
    const seen = new Set();
    for (const it of items) if (it.instrument_type) seen.add(it.instrument_type);
    return Array.from(seen).sort();
  }, [items]);

  if (!admin) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <Shield className="h-12 w-12 mx-auto text-gray-400" />
            <h2 className="text-xl font-semibold">Admin access required</h2>
            <p className="text-gray-600">Only administrators can manage cameras and demo videos.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" data-testid="admin-cameras-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Video className="h-6 w-6" /> Live Camera Feed — Admin Manager</h1>
          <p className="text-sm text-gray-600">Upload or link videos for every registered device across every client. Clients see the video as their live feed.</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search hardware/label/client"
              className="pl-8 w-64"
              data-testid="cameras-search"
            />
          </div>
          <select
            className="border rounded px-3 py-2 h-10"
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            data-testid="cameras-client-filter"
          >
            <option value="">All clients</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <select
            className="border rounded px-3 py-2 h-10"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            data-testid="cameras-type-filter"
          >
            <option value="">All types</option>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <p className="text-center py-16 text-gray-500">Loading instruments…</p>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-2">
            <Cpu className="h-10 w-10 mx-auto text-gray-300" />
            <p className="text-gray-600">No instruments match the current filters.</p>
            <p className="text-xs text-gray-500">
              Register devices via the <a href="/instruments" className="text-blue-600 hover:underline">Instruments</a> page, then come back to attach a camera.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="cameras-grid">
          {filtered.map((it) => (
            <Card key={it.hardware_id} className="border-t-4" style={{ borderTopColor: '#0284c7' }} data-testid={`camera-tile-${it.hardware_id}`}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between gap-2">
                  <span className="truncate">{cleanLabel(it.label || it.hardware_id)}</span>
                  <Badge className="bg-blue-500 capitalize text-[10px]">{it.instrument_type}</Badge>
                </CardTitle>
                <CardDescription className="text-xs">
                  <span className="font-mono text-gray-500">{it.hardware_id}</span>
                  {(it.owner_name || it.owner_email) && (
                    <span className="ml-2 text-gray-600">· {it.owner_name || it.owner_email}</span>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <LiveCameraWidget
                  hardwareId={it.hardware_id}
                  deviceLabel={it.label || it.hardware_id}
                  canManage={true}
                  onChanged={refresh}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
