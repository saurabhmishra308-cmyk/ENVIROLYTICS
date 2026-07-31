import React, { useEffect, useRef, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { MapPin, Crosshair, Check } from 'lucide-react';

/**
 * Click-to-pick location picker built on the Leaflet global (loaded via CDN in
 * public/index.html — same as the dashboard's LocationMap component).
 *
 * Props:
 *   - open: boolean
 *   - onClose(): void
 *   - onPick(lat, lng): void       (called when admin confirms)
 *   - initialLat, initialLng: optional current values
 *   - title: dialog title (default "Pick instrument location")
 *
 * Behaviour:
 *   - Renders a full-width Leaflet map with two tile layers (Satellite + Streets).
 *   - Clicking anywhere drops / moves a marker and updates the numeric inputs.
 *   - "Use my current location" button uses navigator.geolocation.
 *   - Confirm applies the selected coordinates to the parent.
 */
export default function MapLocationPicker({
  open, onClose, onPick,
  initialLat, initialLng,
  title = 'Pick instrument location',
}) {
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const markerRef = useRef(null);
  const [lat, setLat] = useState(initialLat ?? '');
  const [lng, setLng] = useState(initialLng ?? '');

  useEffect(() => {
    if (!open) return;
    setLat(initialLat ?? '');
    setLng(initialLng ?? '');
  }, [open, initialLat, initialLng]);

  useEffect(() => {
    if (!open) return;
    // Wait one tick so the dialog container has laid out.
    const t = setTimeout(() => {
      const L = window.L;
      if (!L || !containerRef.current) return;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      const centerLat = Number.isFinite(parseFloat(initialLat)) ? parseFloat(initialLat) : 22.5;
      const centerLng = Number.isFinite(parseFloat(initialLng)) ? parseFloat(initialLng) : 79.0;
      const map = L.map(containerRef.current).setView([centerLat, centerLng], initialLat ? 15 : 5);
      mapRef.current = map;

      const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; OpenStreetMap',
      });
      const satellite = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 19, attribution: 'Tiles &copy; Esri' },
      );
      satellite.addTo(map);
      L.control.layers({ Satellite: satellite, Streets: streets }, null, { position: 'topright' }).addTo(map);

      // Drop initial marker if we have coords.
      if (Number.isFinite(parseFloat(initialLat)) && Number.isFinite(parseFloat(initialLng))) {
        markerRef.current = L.marker([parseFloat(initialLat), parseFloat(initialLng)], { draggable: true }).addTo(map);
        markerRef.current.on('dragend', (ev) => {
          const { lat: la, lng: lo } = ev.target.getLatLng();
          setLat(la.toFixed(6));
          setLng(lo.toFixed(6));
        });
      }

      map.on('click', (ev) => {
        const { lat: la, lng: lo } = ev.latlng;
        if (markerRef.current) {
          markerRef.current.setLatLng(ev.latlng);
        } else {
          markerRef.current = L.marker(ev.latlng, { draggable: true }).addTo(map);
          markerRef.current.on('dragend', (e2) => {
            const { lat: la2, lng: lo2 } = e2.target.getLatLng();
            setLat(la2.toFixed(6));
            setLng(lo2.toFixed(6));
          });
        }
        setLat(la.toFixed(6));
        setLng(lo.toFixed(6));
      });
    }, 200);

    return () => {
      clearTimeout(t);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      markerRef.current = null;
    };
  }, [open, initialLat, initialLng]);

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      const la = pos.coords.latitude;
      const lo = pos.coords.longitude;
      setLat(la.toFixed(6));
      setLng(lo.toFixed(6));
      if (mapRef.current) {
        mapRef.current.setView([la, lo], 16);
        const L = window.L;
        if (markerRef.current) markerRef.current.setLatLng([la, lo]);
        else if (L) markerRef.current = L.marker([la, lo], { draggable: true }).addTo(mapRef.current);
      }
    });
  };

  const confirm = () => {
    const la = parseFloat(lat);
    const lo = parseFloat(lng);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return;
    onPick(la, lo);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl" data-testid="map-picker-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" /> {title}
          </DialogTitle>
          <DialogDescription>
            Click anywhere on the map to drop a pin. Drag the pin to fine-tune. Coordinates are captured with 6-decimal precision.
          </DialogDescription>
        </DialogHeader>

        <div
          ref={containerRef}
          style={{ height: '420px', width: '100%', border: '1px solid #e5e7eb', borderRadius: 8 }}
          data-testid="map-picker-canvas"
        />

        <div className="grid grid-cols-3 gap-3 items-end">
          <div>
            <Label className="text-xs">Latitude</Label>
            <Input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="22.500000" data-testid="map-picker-lat" />
          </div>
          <div>
            <Label className="text-xs">Longitude</Label>
            <Input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="79.000000" data-testid="map-picker-lng" />
          </div>
          <Button variant="outline" onClick={useMyLocation} className="h-10" data-testid="map-picker-locate">
            <Crosshair className="h-4 w-4 mr-1" /> My location
          </Button>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={confirm} disabled={!Number.isFinite(parseFloat(lat)) || !Number.isFinite(parseFloat(lng))} data-testid="map-picker-confirm">
            <Check className="h-4 w-4 mr-1" /> Use these coordinates
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
