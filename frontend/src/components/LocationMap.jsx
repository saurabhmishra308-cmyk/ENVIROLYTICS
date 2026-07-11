import React, { useEffect, useRef } from 'react';

/**
 * Leaflet map with two base layers (Satellite + Streets) and pin markers.
 * Leaflet (L) is loaded via CDN in /public/index.html.
 *
 * Two operating modes based on the shape of each location:
 *   - **Instrument mode** (preferred): `{hardware_id, instrument_type, label, latitude, longitude, ...}`
 *     Marker is colored per instrument type (DWLR / Flowmeter / pH / TDS / Conductivity).
 *   - **User mode** (legacy): `{id, full_name, role, is_active, latitude, longitude, ...}`
 *     Marker colored by role/active (kept for backward compat with the admin locations view).
 *
 * A color legend is rendered below the map automatically for instrument mode.
 *
 * Props:
 *   - locations: array (see above)
 *   - center: [lat, lng] (default center of India)
 *   - zoom: number (default 6)
 *   - height: CSS height string (default '460px')
 *   - showLegend: boolean (default true) — set false to hide the legend strip
 */
const TYPE_STYLES = {
  dwlr:         { color: '#2563eb', ring: '#1e3a8a', label: 'DWLR (Water Level Recorder)' },
  flowmeter:    { color: '#f97316', ring: '#9a3412', label: 'Flowmeter' },
  ph:           { color: '#8b5cf6', ring: '#5b21b6', label: 'pH Sensor' },
  tds:          { color: '#0ea5e9', ring: '#075985', label: 'TDS Sensor' },
  conductivity: { color: '#14b8a6', ring: '#115e59', label: 'Conductivity Sensor' },
  wq_stp:       { color: '#c2410c', ring: '#7c2d12', label: 'STP Effluent Analyser' },
  do_meter:     { color: '#0284c7', ring: '#075985', label: 'DO Meter (Aeration Tank)' },
  other:        { color: '#6b7280', ring: '#374151', label: 'Other Device' },
};

const typeStyle = (t) => TYPE_STYLES[(t || '').toLowerCase()] || TYPE_STYLES.other;

const LocationMap = ({
  locations = [],
  center = [22.9734, 78.6569],
  zoom = 6,
  height = '460px',
  showLegend = true,
}) => {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersLayerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    const init = () => {
      if (cancelled || !containerRef.current || mapRef.current || !window.L) return false;
      const L = window.L;

      const satellite = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 19, attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics' }
      );
      const streets = L.tileLayer(
        'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        { maxZoom: 19, attribution: '© OpenStreetMap contributors' }
      );
      const labels = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 19, attribution: '', pane: 'overlayPane' }
      );

      mapRef.current = L.map(containerRef.current, {
        layers: [satellite, labels],
        zoomControl: true,
        scrollWheelZoom: true,
      }).setView(center, zoom);

      L.control.layers(
        { 'Satellite': satellite, 'Streets': streets },
        { 'Place names': labels },
        { position: 'topright', collapsed: true }
      ).addTo(mapRef.current);

      L.control.scale({ position: 'bottomleft', imperial: false }).addTo(mapRef.current);

      markersLayerRef.current = L.layerGroup().addTo(mapRef.current);
      return true;
    };

    if (!init()) {
      let tries = 0;
      const id = setInterval(() => {
        tries += 1;
        if (init() || tries > 20) clearInterval(id);
      }, 250);
      return () => { cancelled = true; clearInterval(id); };
    }
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // presentTypes = unique instrument types actually shown (for the legend)
  const presentTypes = React.useMemo(() => {
    const set = new Set();
    for (const loc of locations) {
      if (loc.instrument_type) set.add(String(loc.instrument_type).toLowerCase());
    }
    return Array.from(set);
  }, [locations]);

  useEffect(() => {
    if (!markersLayerRef.current || !window.L) return;
    const L = window.L;
    markersLayerRef.current.clearLayers();
    const pts = [];
    locations.forEach((loc) => {
      if (loc.latitude == null || loc.longitude == null) return;
      const lat = Number(loc.latitude);
      const lng = Number(loc.longitude);
      if (Number.isNaN(lat) || Number.isNaN(lng)) return;

      // Choose colour: instrument mode wins if `instrument_type` is present, else legacy user mode.
      let color;
      let ring;
      if (loc.instrument_type) {
        const s = typeStyle(loc.instrument_type);
        color = s.color; ring = s.ring;
      } else if (loc.role === 'admin') {
        color = '#a855f7'; ring = '#581c87';
      } else {
        color = loc.is_active === false ? '#9ca3af' : '#22c55e';
        ring = loc.is_active === false ? '#4b5563' : '#15803d';
      }

      const icon = L.divIcon({
        className: 'envirolytics-marker',
        html: `
          <div style="position:relative;width:26px;height:26px;">
            <div style="position:absolute;top:0;left:0;right:0;bottom:0;border-radius:50%;background:${color};opacity:0.35;animation:envpulse 2s infinite;"></div>
            <div style="position:absolute;top:5px;left:5px;width:16px;height:16px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.45);outline:1px solid ${ring};"></div>
          </div>
          <style>@keyframes envpulse { 0% {transform:scale(0.8);opacity:0.5;} 100% {transform:scale(1.8);opacity:0;} }</style>
        `,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });
      const marker = L.marker([lat, lng], { icon });

      // Build the popup — different content per mode.
      let popup;
      if (loc.instrument_type) {
        const title = loc.label || loc.hardware_id || 'Instrument';
        const subtitle = [loc.location_name, loc.owner_name].filter(Boolean).join(' · ');
        popup = `<div style="min-width:220px;font-family:Inter,sans-serif">
          <div style="font-weight:600;font-size:14px;margin-bottom:2px">${title}</div>
          <div style="font-size:11px;color:${color};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;font-weight:600">${typeStyle(loc.instrument_type).label}</div>
          ${subtitle ? `<div style="color:#555;font-size:12px;margin-bottom:6px">${subtitle}</div>` : ''}
          <div style="font-size:11px;color:#666;font-family:monospace">${lat.toFixed(6)}, ${lng.toFixed(6)}</div>
          ${loc.hardware_id ? `<div style="font-size:10px;color:#888;margin-top:4px">Hardware: ${loc.hardware_id}</div>` : ''}
        </div>`;
      } else {
        const title = loc.full_name || loc.company_name || 'Unnamed';
        const subtitle = [loc.location_name, loc.company_name].filter(Boolean).join(' · ');
        popup = `<div style="min-width:200px;font-family:Inter,sans-serif">
          <div style="font-weight:600;font-size:14px;margin-bottom:4px">${title}</div>
          ${subtitle ? `<div style="color:#555;font-size:12px;margin-bottom:6px">${subtitle}</div>` : ''}
          <div style="font-size:11px;color:#666"><strong>${lat.toFixed(6)}</strong>, <strong>${lng.toFixed(6)}</strong></div>
          <div style="font-size:11px;color:#666">Role: ${loc.role || '—'}${loc.is_active === false ? ' (inactive)' : ''}</div>
        </div>`;
      }
      marker.bindPopup(popup);
      marker.addTo(markersLayerRef.current);
      pts.push([lat, lng]);
    });
    if (pts.length > 1 && mapRef.current) {
      mapRef.current.fitBounds(L.latLngBounds(pts).pad(0.4), { maxZoom: 14 });
    } else if (pts.length === 1 && mapRef.current) {
      mapRef.current.setView(pts[0], 13);
    }
  }, [locations]);

  return (
    <div className="w-full">
      <div
        ref={containerRef}
        data-testid="location-map"
        style={{ width: '100%', height, borderRadius: '0.75rem', overflow: 'hidden', zIndex: 0 }}
      />
      {showLegend && presentTypes.length > 0 && (
        <div
          className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-200"
          data-testid="location-map-legend"
        >
          <span className="text-[11px] uppercase tracking-widest text-gray-500 font-semibold">Legend</span>
          {presentTypes.map((t) => {
            const s = typeStyle(t);
            return (
              <div key={t} className="flex items-center gap-2" data-testid={`legend-${t}`}>
                <span
                  className="inline-block w-3.5 h-3.5 rounded-full border-2 border-white"
                  style={{ backgroundColor: s.color, outline: `1px solid ${s.ring}` }}
                />
                <span className="text-xs text-gray-700 font-medium">{s.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default LocationMap;
