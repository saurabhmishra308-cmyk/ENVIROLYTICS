import React, { useEffect, useRef } from 'react';

/**
 * Leaflet map showing client locations as pins.
 * Leaflet (L) is loaded via CDN in /public/index.html.
 *
 * Props:
 *   - locations: [{id, full_name, company_name, location_name, latitude, longitude, role, is_active}]
 *   - center: [lat, lng] (default Lucknow)
 *   - zoom: number (default 5 for India-wide view)
 *   - height: CSS height string (default '420px')
 */
const LocationMap = ({ locations = [], center = [22.9734, 78.6569], zoom = 5, height = '420px' }) => {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersLayerRef = useRef(null);

  // Initialise the map once
  useEffect(() => {
    if (!containerRef.current) return;
    if (!window.L) {
      // Leaflet hasn't loaded yet; retry shortly
      const retry = setTimeout(() => {
        if (window.L && containerRef.current && !mapRef.current) {
          mapRef.current = window.L.map(containerRef.current).setView(center, zoom);
          window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap',
          }).addTo(mapRef.current);
          markersLayerRef.current = window.L.layerGroup().addTo(mapRef.current);
        }
      }, 300);
      return () => clearTimeout(retry);
    }
    if (!mapRef.current) {
      mapRef.current = window.L.map(containerRef.current).setView(center, zoom);
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      }).addTo(mapRef.current);
      markersLayerRef.current = window.L.layerGroup().addTo(mapRef.current);
    }
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraw markers when locations change
  useEffect(() => {
    if (!markersLayerRef.current || !window.L) return;
    markersLayerRef.current.clearLayers();
    const pts = [];
    locations.forEach((loc) => {
      if (loc.latitude == null || loc.longitude == null) return;
      const lat = Number(loc.latitude);
      const lng = Number(loc.longitude);
      if (Number.isNaN(lat) || Number.isNaN(lng)) return;
      const color = loc.role === 'admin' ? '#a855f7' : loc.is_active ? '#22c55e' : '#9ca3af';
      const icon = window.L.divIcon({
        className: 'envirolytics-marker',
        html: `<div style="background:${color};width:18px;height:18px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.35);"></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });
      const marker = window.L.marker([lat, lng], { icon });
      const title = loc.full_name || loc.company_name || 'Unnamed';
      const subtitle = [loc.location_name, loc.company_name].filter(Boolean).join(' · ');
      marker.bindPopup(
        `<div style="min-width:180px"><strong>${title}</strong><br/>` +
          (subtitle ? `<span style="color:#666">${subtitle}</span><br/>` : '') +
          `<small>${lat.toFixed(4)}, ${lng.toFixed(4)}</small><br/>` +
          `<small>Role: ${loc.role || '—'}</small></div>`
      );
      marker.addTo(markersLayerRef.current);
      pts.push([lat, lng]);
    });
    if (pts.length > 1 && mapRef.current) {
      mapRef.current.fitBounds(window.L.latLngBounds(pts).pad(0.3));
    } else if (pts.length === 1 && mapRef.current) {
      mapRef.current.setView(pts[0], 9);
    }
  }, [locations]);

  return <div ref={containerRef} data-testid="location-map" style={{ width: '100%', height, borderRadius: '0.75rem', overflow: 'hidden', zIndex: 0 }} />;
};

export default LocationMap;
