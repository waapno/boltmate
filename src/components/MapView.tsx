import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, FeatureCollection } from "geojson";
import { OSTRAVA } from "@/lib/zones";

maplibregl.setWorkerUrl(workerUrl);

export type ZonePt = { id: string; name: string; c: [number, number]; score: number };
export type ParkPt = {
  id: string;
  c: [number, number];
  score: number;
  name: string;
  source: "osm" | "city" | "both";
  capacity?: number;
  available?: number;
  occupancy?: number;
  observedAt?: string;
  officialUrl?: string;
  isAccessibleForFree?: boolean;
  subscribersOnly?: boolean;
  tags?: { fee?: string };
};

const fc = (features: Feature[]): FeatureCollection => ({ type: "FeatureCollection", features });
const pt = (c: [number, number], p: Record<string, unknown>): Feature => ({ type: "Feature", geometry: { type: "Point", coordinates: c }, properties: p });

export default function MapView({ zones, parking, me, target, focus, onPark, onZone }: {
  zones: ZonePt[]; parking: ParkPt[]; me: [number, number] | null; target: [number, number] | null;
  focus: [number, number] | null; onPark: (id: string) => void; onZone: (id: string) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const ready = useRef(false);
  const cb = useRef({ onPark, onZone });
  const data = useRef({ zones, parking, me, target });
  const sync = useRef<() => void>(() => {});
  cb.current = { onPark, onZone };
  data.current = { zones, parking, me, target };

  sync.current = () => {
    const m = map.current;
    if (!m || !ready.current) return;
    const { zones, parking, me, target } = data.current;
    (m.getSource("zones") as maplibregl.GeoJSONSource).setData(fc(zones.map((z) => pt(z.c, { id: z.id, name: z.name, score: z.score }))));
    (m.getSource("park") as maplibregl.GeoJSONSource).setData(fc(parking.map((p) => pt(p.c, {
      id: p.id,
      name: p.name,
      score: p.score,
      source: p.source,
      free: p.isAccessibleForFree ?? p.tags?.fee === "no",
      ...(p.occupancy === undefined ? {} : { occupancy: p.occupancy }),
    }))));
    (m.getSource("me") as maplibregl.GeoJSONSource).setData(fc(me ? [pt(me, {})] : []));
    (m.getSource("route") as maplibregl.GeoJSONSource).setData(fc(me && target ? [{ type: "Feature", geometry: { type: "LineString", coordinates: [me, target] }, properties: {} }] : target ? [pt(target, {})] : []));
  };

  useEffect(() => {
    if (!el.current) return;
    const m = new maplibregl.Map({ container: el.current, style: "https://tiles.openfreemap.org/styles/dark", center: OSTRAVA, zoom: 11.6, attributionControl: { compact: true } });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    m.on("load", () => {
      for (const s of ["zones", "park", "me", "route"]) m.addSource(s, { type: "geojson", data: fc([]) });
      m.addLayer({ id: "zone-halo", type: "circle", source: "zones", paint: {
        "circle-radius": ["interpolate", ["exponential", 2], ["zoom"], 10, ["*", 14, ["get", "score"]], 16, ["*", 60, ["get", "score"]]],
        "circle-color": ["interpolate", ["linear"], ["get", "score"], 0.25, "#3a6df0", 0.6, "#f2b33d", 1, "#ff5a3c"],
        "circle-opacity": 0.22, "circle-blur": 0.6 } });
      m.addLayer({ id: "zone-core", type: "circle", source: "zones", paint: { "circle-radius": 6, "circle-color": "#0b0f14", "circle-stroke-width": 2.5,
        "circle-stroke-color": ["interpolate", ["linear"], ["get", "score"], 0.25, "#3a6df0", 0.6, "#f2b33d", 1, "#ff5a3c"] } });
      m.addLayer({ id: "zone-label", type: "symbol", source: "zones", layout: { "text-field": ["get", "name"], "text-size": 11, "text-offset": [0, 1.4], "text-font": ["Noto Sans Bold"], "text-letter-spacing": 0.05, "text-transform": "uppercase" },
        paint: { "text-color": "#e8ecf1", "text-halo-color": "#0b0f14", "text-halo-width": 1.5 } });
      m.addLayer({ id: "route-line", type: "line", source: "route", paint: { "line-color": "#3ddc97", "line-width": 3, "line-dasharray": [2, 1.5] } });
      m.addLayer({ id: "park", type: "circle", source: "park", paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 4, 17, 11],
        "circle-color": ["case", ["has", "occupancy"],
          ["step", ["get", "occupancy"], "#3ddc97", 50, "#f2b33d", 85, "#ff5a3c"],
          ["step", ["get", "score"], "#ff5a3c", 45, "#f2b33d", 65, "#3ddc97"]],
        "circle-stroke-color": "#0b0f14", "circle-stroke-width": 1.5 } });
      m.addLayer({ id: "park-p", type: "symbol", source: "park", minzoom: 14, layout: { "text-field": ["case", ["get", "free"], "F", ["==", ["get", "source"], "osm"], "P", "M"], "text-size": 10, "text-font": ["Noto Sans Bold"], "text-allow-overlap": true }, paint: { "text-color": "#0b0f14" } });
      m.addLayer({ id: "me", type: "circle", source: "me", paint: { "circle-radius": 8, "circle-color": "#4fc3ff", "circle-stroke-color": "#fff", "circle-stroke-width": 3 } });
      m.on("click", "park", (e) => cb.current.onPark(String(e.features?.[0]?.properties?.["id"])));
      m.on("click", "zone-core", (e) => cb.current.onZone(String(e.features?.[0]?.properties?.["id"])));
      for (const l of ["park", "zone-core"]) { m.on("mouseenter", l, () => (m.getCanvas().style.cursor = "pointer")); m.on("mouseleave", l, () => (m.getCanvas().style.cursor = "")); }
      ready.current = true; sync.current();
    });
    return () => { m.remove(); map.current = null; ready.current = false; };
  }, []);

  useEffect(() => { sync.current(); }, [zones, parking, me, target]);
  useEffect(() => { if (focus && map.current) map.current.flyTo({ center: focus, zoom: 15.2, pitch: 40, duration: 1200 }); }, [focus]);

  return <div ref={el} className="absolute inset-0 h-full w-full" />;
}
