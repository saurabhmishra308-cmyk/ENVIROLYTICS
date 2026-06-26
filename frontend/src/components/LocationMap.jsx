import React, { useEffect, useRef } from 'react';

/**
 * Leaflet map with two base layers (Satellite + Streets) and pin markers.
 * Leaflet (L) is loaded via CDN in /public/index.html.
 *
 * Props:
 *   - locations: [{id, full_name, company_name, location_name, latitude, longitude, role, is_active}]
 *   - center: [lat, lng] (default Lucknow)
 *   - zoom: number (default 6)
 *   - height: CSS height string (default '460px')
 */
const LocationMap = ({ locations = [], center = [22.9734, 78.6569], zoom = 6, height = '460px' }) => {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersLayerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    const init = () => {
      if (cancelled || !containerRef.current || mapRef.current || !window.L) return false;
      const L = window.L;

      // Satellite (Esri World Imagery) and Streets (OSM) base layers
      const satellite = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 19,
          attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics',
        }
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
      // Leaflet may not have loaded yet; retry a few times
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
    // map is initialised once with the first center/zoom on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const color = loc.role === 'admin' ? '#a855f7' : loc.is_active ? '#22c55e' : '#9ca3af';
      const ring = loc.role === 'admin' ? '#581c87' : loc.is_active ? '#15803d' : '#4b5563';
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
      const title = loc.full_name || loc.company_name || 'Unnamed';
      const subtitle = [loc.location_name, loc.company_name].filter(Boolean).join(' · ');
      marker.bindPopup(
        `<div style="min-width:200px;font-family:Inter,sans-serif">
          <div style="font-weight:600;font-size:14px;margin-bottom:4px">${title}</div>
          ${subtitle ? `<div style="color:#555;font-size:12px;margin-bottom:6px">${subtitle}</div>` : ''}
          <div style="font-size:11px;color:#666"><strong>${lat.toFixed(6)}</strong>, <strong>${lng.toFixed(6)}</strong></div>
          <div style="font-size:11px;color:#666">Role: ${loc.role || '—'}${loc.is_active === false ? ' (inactive)' : ''}</div>
        </div>`
      );
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
    <div
      ref={containerRef}
      data-testid="location-map"
      style={{ width: '100%', height, borderRadius: '0.75rem', overflow: 'hidden', zIndex: 0 }}
    />
  );
};

export default LocationMap;
