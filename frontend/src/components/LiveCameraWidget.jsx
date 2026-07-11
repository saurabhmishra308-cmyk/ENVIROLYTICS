import React, { useState, useEffect, useRef } from 'react';
import { Video, VideoOff, Settings, Loader2, Trash2, Save } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from './ui/dialog';
import { toast } from 'sonner';
import api, { formatApiError } from '../lib/api';

/**
 * Live Camera Widget — plays a video stream (YouTube embed or MP4/HLS)
 * for one instrument, with an absolutely-positioned digital telemetry
 * overlay in the top-right corner.
 *
 * Props:
 *   hardwareId  — required, the device this camera belongs to
 *   deviceLabel — display label
 *   telemetry   — { DO_TANK_1, DO_TANK_2, timestamp } object, refreshed
 *                 by the parent every ~30s
 *   canManage   — bool, controls whether the "Configure" button shows
 *                 (admins only by default)
 *   onChanged   — optional callback invoked after save/delete
 */
export const LiveCameraWidget = ({
  hardwareId,
  deviceLabel,
  telemetry = {},
  canManage = false,
  onChanged,
}) => {
  const [loading, setLoading] = useState(true);
  const [stream, setStream] = useState(null);   // camera doc from backend
  const [showConfig, setShowConfig] = useState(false);
  const [now, setNow] = useState(new Date());
  const videoRef = useRef(null);

  // Tick the clock in the overlay every second so the timestamp feels live
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const load = async () => {
    if (!hardwareId) { setStream(null); setLoading(false); return; }
    setLoading(true);
    try {
      const { data } = await api.get(`/api/camera-streams/by-device/${encodeURIComponent(hardwareId)}`);
      setStream(data);
    } catch (e) {
      setStream(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [hardwareId]); // eslint-disable-line react-hooks/exhaustive-deps

  const isYT = stream?.stream_type === 'youtube';
  const hasStream = stream && stream.stream_url;

  return (
    <div className="rounded-2xl border border-slate-800 overflow-hidden shadow-xl bg-slate-950" data-testid={`camera-widget-${hardwareId}`}>
      {/* Video canvas — fixed aspect ratio 16:9 */}
      <div className="relative w-full" style={{ aspectRatio: '16 / 9', background: '#000' }}>
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center text-slate-400">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : !hasStream ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 gap-2">
            <VideoOff className="h-12 w-12" />
            <div className="text-sm font-medium">No camera configured</div>
            {canManage && (
              <div className="text-xs opacity-70">Click &quot;Configure&quot; below to add a stream URL</div>
            )}
          </div>
        ) : isYT ? (
          <iframe
            key={stream.embed_url}
            src={stream.embed_url}
            title="Live camera"
            className="absolute inset-0 w-full h-full"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            data-testid="camera-iframe"
          />
        ) : (
          <video
            key={stream.stream_url}
            ref={videoRef}
            src={stream.stream_url}
            className="absolute inset-0 w-full h-full object-cover"
            autoPlay
            muted
            loop
            playsInline
            controls
            data-testid="camera-video"
          />
        )}

        {/* Live badge — bottom-left */}
        {hasStream && (
          <div className="absolute bottom-3 left-3 flex items-center gap-1.5 bg-red-600/90 backdrop-blur px-2 py-1 rounded text-white text-[10px] font-bold uppercase tracking-widest">
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
            Live
          </div>
        )}

        {/* Telemetry overlay — top-right */}
        {hasStream && (
          <div
            className="absolute top-3 right-3 bg-black/70 backdrop-blur-md rounded-lg px-3 py-2 border border-white/10 shadow-xl min-w-[160px]"
            data-testid="camera-overlay-telemetry"
          >
            <div className="text-[9px] uppercase tracking-widest text-emerald-400 font-bold mb-1">Live Telemetry</div>
            <div className="flex justify-between items-baseline gap-4 py-0.5">
              <span className="text-[10px] text-white/70 uppercase">Tank 1 DO</span>
              <span className="text-sm font-mono font-bold text-emerald-300 tabular-nums" data-testid="overlay-do-tank-1">
                {telemetry.DO_TANK_1 != null ? Number(telemetry.DO_TANK_1).toFixed(2) : '--.--'}
                <span className="text-[8px] text-white/60 ml-1">mg/L</span>
              </span>
            </div>
            <div className="flex justify-between items-baseline gap-4 py-0.5">
              <span className="text-[10px] text-white/70 uppercase">Tank 2 DO</span>
              <span className="text-sm font-mono font-bold text-emerald-300 tabular-nums" data-testid="overlay-do-tank-2">
                {telemetry.DO_TANK_2 != null ? Number(telemetry.DO_TANK_2).toFixed(2) : '--.--'}
                <span className="text-[8px] text-white/60 ml-1">mg/L</span>
              </span>
            </div>
            <div className="mt-1 pt-1 border-t border-white/10 text-[9px] font-mono text-white/60 tabular-nums" data-testid="overlay-timestamp">
              {now.toLocaleTimeString('en-IN', { hour12: false })} · {now.toLocaleDateString('en-IN')}
            </div>
          </div>
        )}

        {/* Location label — top-left */}
        {hasStream && (stream.label || stream.location) && (
          <div className="absolute top-3 left-3 bg-black/60 backdrop-blur px-2 py-1 rounded text-white text-[10px] font-medium max-w-[45%] truncate">
            {stream.label || deviceLabel}
            {stream.location && <span className="opacity-60 ml-1">· {stream.location}</span>}
          </div>
        )}
      </div>

      {/* Footer — status + manage button */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-900 border-t border-slate-800">
        <div className="flex items-center gap-2 text-xs text-slate-300">
          <Video className="h-3.5 w-3.5" />
          <span className="font-medium">Live Camera</span>
          {hasStream && (
            <Badge variant="outline" className="text-[9px] border-slate-700 text-slate-400 uppercase">
              {stream.stream_type}
            </Badge>
          )}
        </div>
        {canManage && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-slate-300 hover:text-white hover:bg-slate-800"
            onClick={() => setShowConfig(true)}
            data-testid="camera-configure-btn"
          >
            <Settings className="h-3.5 w-3.5 mr-1" />
            Configure
          </Button>
        )}
      </div>

      {/* Config dialog */}
      {canManage && (
        <CameraConfigDialog
          open={showConfig}
          onOpenChange={setShowConfig}
          hardwareId={hardwareId}
          deviceLabel={deviceLabel}
          existing={stream}
          onSaved={async () => { await load(); onChanged?.(); }}
          onDeleted={async () => { await load(); onChanged?.(); }}
        />
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────
// Config dialog (admin only)
// ─────────────────────────────────────────────────────────────────────────
const CameraConfigDialog = ({ open, onOpenChange, hardwareId, deviceLabel, existing, onSaved, onDeleted }) => {
  const [streamUrl, setStreamUrl] = useState('');
  const [label, setLabel] = useState('');
  const [location, setLocation] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (open) {
      setStreamUrl(existing?.stream_url || '');
      setLabel(existing?.label || deviceLabel || '');
      setLocation(existing?.location || '');
    }
  }, [open, existing, deviceLabel]);

  const save = async () => {
    if (!streamUrl.trim()) {
      toast.error('Stream URL is required');
      return;
    }
    setSaving(true);
    try {
      // POST is upsert-on-hardware_id, so this handles both create and update
      await api.post('/api/camera-streams', {
        hardware_id: hardwareId,
        stream_url: streamUrl.trim(),
        label: label.trim() || null,
        location: location.trim() || null,
      });
      toast.success(existing ? 'Camera updated' : 'Camera added');
      await onSaved?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Save failed');
    } finally { setSaving(false); }
  };

  const del = async () => {
    if (!window.confirm('Remove this camera stream?')) return;
    setDeleting(true);
    try {
      await api.delete(`/api/camera-streams/${encodeURIComponent(hardwareId)}`);
      toast.success('Camera removed');
      await onDeleted?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Delete failed');
    } finally { setDeleting(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="camera-config-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Video className="h-5 w-5 text-sky-600" />
            {existing ? 'Edit Camera Stream' : 'Add Camera Stream'}
          </DialogTitle>
          <p className="text-xs text-gray-500">Device: <code className="bg-gray-100 px-1 rounded">{hardwareId}</code></p>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Stream URL</Label>
            <Input
              value={streamUrl}
              onChange={(e) => setStreamUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=... or https://.../stream.mp4"
              data-testid="camera-config-url"
            />
            <p className="text-[10px] text-gray-500 mt-1">
              YouTube Live / Shorts / Video URLs are auto-embedded. Direct MP4 URLs are played inline.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Label</Label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Aeration Tank Camera"
                data-testid="camera-config-label"
              />
            </div>
            <div>
              <Label className="text-xs">Location</Label>
              <Input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. STP Block A"
                data-testid="camera-config-location"
              />
            </div>
          </div>
        </div>
        <DialogFooter className="flex justify-between sm:justify-between">
          {existing ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={del}
              disabled={deleting || saving}
              data-testid="camera-config-delete"
            >
              {deleting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
              Remove
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving} data-testid="camera-config-save">
              {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default LiveCameraWidget;
