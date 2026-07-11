import React, { useState, useEffect, useRef } from 'react';
import { Video, VideoOff, Settings, Loader2, Trash2, Save, Upload, Cable, Camera } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from './ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { toast } from 'sonner';
import api, { formatApiError, backendAssetUrl } from '../lib/api';

/**
 * Live Camera Widget — plays a video stream for one instrument with an
 * always-visible real-time date/time stamp and DO telemetry overlay.
 *
 * Sources supported (all indistinguishable to end-clients):
 *   • YouTube live / Shorts URL → iframe embed
 *   • Direct MP4 / HLS URL      → HTML <video>
 *   • Admin-uploaded MP4/WebM   → HTML <video> served from /api/uploads/camera/
 *   • Nothing configured        → looping demo aeration clip (with badge)
 */
export const LiveCameraWidget = ({
  hardwareId,
  deviceLabel,
  telemetry = {},
  canManage = false,
  onChanged,
}) => {
  const [loading, setLoading] = useState(true);
  const [stream, setStream] = useState(null);
  const [showConfig, setShowConfig] = useState(false);
  const [now, setNow] = useState(new Date());
  const videoRef = useRef(null);

  // Refresh the CCTV-style overlay clock every second
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!hardwareId) { setStream(null); setLoading(false); return; }
      setLoading(true);
      try {
        const { data } = await api.get(`/api/camera-streams/by-device/${encodeURIComponent(hardwareId)}`);
        if (cancelled) return;
        setStream(data);
      } catch (e) {
        if (cancelled) return;
        setStream(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [hardwareId]);

  const reloadStream = async () => {
    if (!hardwareId) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/api/camera-streams/by-device/${encodeURIComponent(hardwareId)}`);
      setStream(data);
    } catch (_) { setStream(null); }
    finally { setLoading(false); }
  };

  const isYT = stream?.stream_type === 'youtube';
  const isVideoFile = stream?.stream_type === 'mp4' || stream?.stream_type === 'upload';
  const hasStream = stream && stream.stream_url;

  // Resolve URL for admin-uploaded videos which come back with a relative path
  const videoSrc = hasStream
    ? (stream.stream_type === 'upload' ? backendAssetUrl(stream.stream_url) : stream.stream_url)
    : null;

  return (
    <div className="rounded-2xl border border-slate-800 overflow-hidden shadow-xl bg-slate-950" data-testid={`camera-widget-${hardwareId}`}>
      {/* 16:9 canvas */}
      <div className="relative w-full" style={{ aspectRatio: '16 / 9', background: '#000' }}>
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center text-slate-400">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : !hasStream ? (
          <>
            <video
              key="demo-aeration"
              src="/aeration.mp4"
              className="absolute inset-0 w-full h-full object-cover"
              autoPlay muted loop playsInline
              data-testid="camera-demo-video"
              style={{ filter: 'brightness(0.75) saturate(0.9)', transform: 'scale(1.15)', transformOrigin: 'center' }}
            />
            <div className="absolute inset-0 bg-slate-950/40" />
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white gap-1.5 text-center px-6">
              <VideoOff className="h-10 w-10 opacity-90" />
              <div className="text-base font-semibold">No live camera attached</div>
              <div className="text-xs opacity-80 max-w-sm">
                Showing demo footage of an aeration tank.
                {canManage
                  ? ' Click "Configure" below to attach the live camera feed.'
                  : ' The live camera feed will be attached shortly.'}
              </div>
            </div>
            {canManage && (
              <div className="absolute top-3 left-3 bg-amber-500/95 text-amber-950 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-widest shadow" data-testid="camera-demo-badge">
                Demo Footage
              </div>
            )}
          </>
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
        ) : isVideoFile ? (
          <video
            key={videoSrc}
            ref={videoRef}
            src={videoSrc}
            className="absolute inset-0 w-full h-full object-cover"
            autoPlay muted loop playsInline controls
            data-testid="camera-video"
          />
        ) : null}

        {/* LIVE badge (bottom-left) — always shown when a real source is attached,
            regardless of whether it's a real feed or an admin upload */}
        {hasStream && (
          <div className="absolute bottom-3 left-3 flex items-center gap-1.5 bg-red-600/90 backdrop-blur px-2 py-1 rounded text-white text-[10px] font-bold uppercase tracking-widest">
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
            Live
          </div>
        )}

        {/* CCTV-style timestamp banner (bottom-right, always visible) */}
        <div
          className="absolute bottom-3 right-3 bg-black/75 backdrop-blur-sm rounded px-2.5 py-1 border border-white/10 shadow-lg"
          data-testid="camera-timestamp-banner"
        >
          <div className="font-mono text-white text-[11px] tabular-nums leading-tight">
            {now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
          </div>
          <div className="font-mono text-emerald-300 text-sm font-bold tabular-nums leading-tight" data-testid="camera-live-clock">
            {now.toLocaleTimeString('en-IN', { hour12: false })} <span className="text-[9px] text-white/60 ml-1">IST</span>
          </div>
        </div>

        {/* DO telemetry overlay (top-right) — only when a real feed is attached */}
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
          </div>
        )}

        {/* Location label (top-left) */}
        {hasStream && (stream.label || stream.location) && (
          <div className="absolute top-3 left-3 bg-black/60 backdrop-blur px-2 py-1 rounded text-white text-[10px] font-medium max-w-[45%] truncate">
            {stream.label || deviceLabel}
            {stream.location && <span className="opacity-60 ml-1">· {stream.location}</span>}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-900 border-t border-slate-800">
        <div className="flex items-center gap-2 text-xs text-slate-300">
          <Video className="h-3.5 w-3.5" />
          <span className="font-medium">Live Camera</span>
          {hasStream && canManage && (
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

      {canManage && (
        <CameraConfigDialog
          open={showConfig}
          onOpenChange={setShowConfig}
          hardwareId={hardwareId}
          deviceLabel={deviceLabel}
          existing={stream}
          onSaved={async () => { await reloadStream(); onChanged?.(); }}
          onDeleted={async () => { await reloadStream(); onChanged?.(); }}
        />
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────
// Config dialog (admin only) — three tabs: URL, Upload, Real device wiring
// ─────────────────────────────────────────────────────────────────────────
const emptyIntegration = {
  protocol: '',
  api_endpoint: '',
  port: '',
  device_model: '',
  camera_ip: '',
  username: '',
  password: '',
  notes: '',
};

const CameraConfigDialog = ({ open, onOpenChange, hardwareId, deviceLabel, existing, onSaved, onDeleted }) => {
  const [tab, setTab] = useState('url');
  const [streamUrl, setStreamUrl] = useState('');
  const [label, setLabel] = useState('');
  const [location, setLocation] = useState('');
  const [integration, setIntegration] = useState(emptyIntegration);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setStreamUrl(existing?.stream_url && existing.stream_type !== 'upload' ? existing.stream_url : '');
    setLabel(existing?.label || deviceLabel || '');
    setLocation(existing?.location || '');
    setIntegration({ ...emptyIntegration, ...(existing?.integration_config || {}) });
    setTab(existing?.stream_type === 'upload' ? 'upload' : 'url');
  }, [open, existing, deviceLabel]);

  const setIC = (patch) => setIntegration((s) => ({ ...s, ...patch }));

  const buildIntegrationPayload = () => {
    // Only send fields that have a value (drop empty strings). Port must be
    // a number if provided.
    const out = {};
    Object.entries(integration).forEach(([k, v]) => {
      if (v == null || v === '') return;
      if (k === 'port') { const n = Number(v); if (!Number.isNaN(n)) out.port = n; return; }
      out[k] = v;
    });
    return Object.keys(out).length ? out : null;
  };

  const saveUrl = async () => {
    if (!streamUrl.trim()) { toast.error('Stream URL is required'); return; }
    setSaving(true);
    try {
      await api.post('/api/camera-streams', {
        hardware_id: hardwareId,
        stream_url: streamUrl.trim(),
        label: label.trim() || null,
        location: location.trim() || null,
        integration_config: buildIntegrationPayload(),
      });
      toast.success(existing ? 'Camera updated' : 'Camera added');
      await onSaved?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Save failed');
    } finally { setSaving(false); }
  };

  const uploadFile = async () => {
    const f = fileRef.current?.files?.[0];
    if (!f) { toast.error('Choose an MP4/WebM file first'); return; }
    if (f.size > 120 * 1024 * 1024) { toast.error('File too large — max 120 MB'); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const { data } = await api.post(
        `/api/camera-streams/${encodeURIComponent(hardwareId)}/upload`,
        fd,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      toast.success(`Uploaded ${(data.bytes / (1024 * 1024)).toFixed(1)} MB`);
      // Now save label/location/integration in a follow-up PUT (upload only sets url)
      if (label.trim() || location.trim() || buildIntegrationPayload()) {
        await api.put(`/api/camera-streams/${encodeURIComponent(hardwareId)}`, {
          label: label.trim() || null,
          location: location.trim() || null,
          integration_config: buildIntegrationPayload(),
        });
      }
      await onSaved?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail) || 'Upload failed');
    } finally { setUploading(false); }
  };

  const saveIntegrationOnly = async () => {
    // Persist integration fields even if no source is set — allows admin to
    // pre-provision device credentials before the camera goes live.
    setSaving(true);
    try {
      if (existing) {
        await api.put(`/api/camera-streams/${encodeURIComponent(hardwareId)}`, {
          label: label.trim() || null,
          location: location.trim() || null,
          integration_config: buildIntegrationPayload(),
        });
      } else {
        // Nothing streamed yet — create a placeholder record with empty URL
        await api.post('/api/camera-streams', {
          hardware_id: hardwareId,
          stream_url: '',
          stream_type: 'mp4',
          label: label.trim() || null,
          location: location.trim() || null,
          integration_config: buildIntegrationPayload(),
        });
      }
      toast.success('Device integration details saved');
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
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto" data-testid="camera-config-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Video className="h-5 w-5 text-sky-600" />
            {existing ? 'Edit Camera Stream' : 'Attach Camera Stream'}
          </DialogTitle>
          <DialogDescription className="text-xs text-gray-500">
            Device: <code className="bg-gray-100 px-1 rounded">{hardwareId}</code>
          </DialogDescription>
        </DialogHeader>

        {/* Common label + location */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Camera label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Aeration Basin PTZ #1" data-testid="camera-config-label" />
          </div>
          <div>
            <Label className="text-xs">Location</Label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="STP · Block B" data-testid="camera-config-location" />
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab} className="mt-2">
          <TabsList className="grid grid-cols-3">
            <TabsTrigger value="url" data-testid="camera-tab-url"><Video className="h-3.5 w-3.5 mr-1" /> Stream URL</TabsTrigger>
            <TabsTrigger value="upload" data-testid="camera-tab-upload"><Upload className="h-3.5 w-3.5 mr-1" /> Upload video</TabsTrigger>
            <TabsTrigger value="integration" data-testid="camera-tab-integration"><Cable className="h-3.5 w-3.5 mr-1" /> Real device</TabsTrigger>
          </TabsList>

          <TabsContent value="url" className="pt-3 space-y-2">
            <Label className="text-xs">Stream URL</Label>
            <Input
              value={streamUrl}
              onChange={(e) => setStreamUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=... or https://.../stream.mp4"
              data-testid="camera-config-url"
            />
            <p className="text-[10px] text-gray-500">
              YouTube Live / Shorts / Video URLs are auto-embedded. Direct MP4 or HLS URLs are played inline.
            </p>
            <div className="flex justify-end pt-2">
              <Button size="sm" onClick={saveUrl} disabled={saving} data-testid="camera-config-save">
                {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                Save URL
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="upload" className="pt-3 space-y-2">
            <div className="rounded border border-dashed border-gray-300 p-4 bg-gray-50/50 text-center">
              <Camera className="h-6 w-6 mx-auto text-gray-500 mb-2" />
              <input
                ref={fileRef}
                type="file"
                accept="video/mp4,video/webm,video/quicktime,video/x-m4v"
                className="text-xs block mx-auto"
                data-testid="camera-config-file"
              />
              <p className="text-[10px] text-gray-500 mt-2">
                MP4 / WebM / MOV up to 120 MB. Plays as the live camera feed with real-time timestamp overlay until a physical camera is wired in.
              </p>
            </div>
            <div className="flex justify-end pt-2">
              <Button size="sm" onClick={uploadFile} disabled={uploading} data-testid="camera-config-upload-btn">
                {uploading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
                Upload &amp; use as feed
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="integration" className="pt-3">
            <p className="text-[11px] text-gray-500 mb-2">
              Real device wiring — stored for later integration. Clients do not see these fields.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Protocol</Label>
                <select
                  className="w-full border rounded px-2 py-2 text-sm bg-white"
                  value={integration.protocol || ''}
                  onChange={(e) => setIC({ protocol: e.target.value })}
                  data-testid="camera-int-protocol"
                >
                  <option value="">— Select —</option>
                  <option value="rtsp">RTSP</option>
                  <option value="hls">HLS</option>
                  <option value="http">HTTP / MJPEG</option>
                  <option value="onvif">ONVIF</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <Label className="text-xs">Port</Label>
                <Input type="number" min="1" max="65535" value={integration.port}
                       onChange={(e) => setIC({ port: e.target.value })}
                       placeholder="e.g. 554" data-testid="camera-int-port" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">API / Stream endpoint</Label>
                <Input value={integration.api_endpoint}
                       onChange={(e) => setIC({ api_endpoint: e.target.value })}
                       placeholder="rtsp://camera.local:554/stream1"
                       data-testid="camera-int-endpoint" />
              </div>
              <div>
                <Label className="text-xs">Camera IP</Label>
                <Input value={integration.camera_ip}
                       onChange={(e) => setIC({ camera_ip: e.target.value })}
                       placeholder="192.168.1.100" data-testid="camera-int-ip" />
              </div>
              <div>
                <Label className="text-xs">Device model</Label>
                <Input value={integration.device_model}
                       onChange={(e) => setIC({ device_model: e.target.value })}
                       placeholder="Hikvision DS-2CD..." data-testid="camera-int-model" />
              </div>
              <div>
                <Label className="text-xs">Username</Label>
                <Input value={integration.username}
                       onChange={(e) => setIC({ username: e.target.value })}
                       autoComplete="off" data-testid="camera-int-username" />
              </div>
              <div>
                <Label className="text-xs">Password</Label>
                <Input type="password" value={integration.password}
                       onChange={(e) => setIC({ password: e.target.value })}
                       autoComplete="new-password" data-testid="camera-int-password" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Notes</Label>
                <Input value={integration.notes}
                       onChange={(e) => setIC({ notes: e.target.value })}
                       placeholder="Contact person, PTZ preset, VLAN, etc."
                       data-testid="camera-int-notes" />
              </div>
            </div>
            <div className="flex justify-end pt-3">
              <Button size="sm" onClick={saveIntegrationOnly} disabled={saving} data-testid="camera-int-save">
                {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                Save device details
              </Button>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="justify-between sm:justify-between border-t pt-3 mt-2">
          {existing ? (
            <Button variant="destructive" size="sm" onClick={del} disabled={deleting || saving || uploading}
                    data-testid="camera-config-delete">
              {deleting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
              Remove camera
            </Button>
          ) : <span />}
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default LiveCameraWidget;
