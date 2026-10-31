"use client";

import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MlMap, MapLayerMouseEvent, Marker } from "maplibre-gl";
import { circle } from "@turf/circle";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import type { Momentum, ProjectWithDistance, TractCollection } from "@/lib/data";
import { featureBounds } from "@/lib/spatial";
import "maplibre-gl/dist/maplibre-gl.css";

const STYLE = "https://tiles.openfreemap.org/styles/positron";
/** Contiguous US overview until a place is selected. Not a city default. */
const OVERVIEW = { lng: -98.35, lat: 39.5, zoom: 3.5 };
const PLACE_PAD = { top: 96, bottom: 180, left: 24, right: 24 };
const FRAME = { top: 96, bottom: 180, left: 24, right: 440 };
const SCORE_FALLBACK = ["#e7f4f1", "#b7dfd6", "#6fbfb2", "#2a8f82", "#0e4f48"];

export interface MapPlace {
  lat: number;
  lng: number;
  zoom: number;
}

interface Props {
  panelOpen: boolean;
  projects: ProjectWithDistance[];
  searchPin: MapPlace | null;
  fit: { geoid: string; token: number } | null;
  bounds: [[number, number], [number, number]] | null;
  placeId: string | null;
  placeName: string | null;
  tracts: TractCollection | null;
  loadError: string | null;
  onTractClick: (geoid: string) => void;
}

interface Tip {
  left: number;
  top: number;
  name: string;
  score: string;
  momentum: Momentum;
}

function cssColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

function momentumOf(value: unknown): Momentum {
  return value === "up" || value === "down" || value === "flat" ? value : "flat";
}

function emptyCollection(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function diamondImage(fill: string): ImageData {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.beginPath();
  ctx.moveTo(size / 2, 2);
  ctx.lineTo(size - 3, size / 2);
  ctx.lineTo(size / 2, size - 2);
  ctx.lineTo(3, size / 2);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

function fitOptions(padding: { top: number; bottom: number; left: number; right: number }) {
  return {
    padding,
    duration: 300,
    maxDuration: 300,
    curve: 1,
    easing: easeOut,
    essential: true,
  };
}

function fitGeoid(map: MlMap, collection: TractCollection, geoid: string) {
  const feature = collection.features.find((item) => item.properties.geoid === geoid);
  if (!feature) return;
  map.fitBounds(featureBounds(feature.geometry), {
    ...fitOptions(FRAME),
    maxZoom: 15,
    absolutePadding: true,
  });
}

function MomentumIcon({ momentum }: { momentum: Momentum }) {
  if (momentum === "up") return <ArrowUp className="h-3.5 w-3.5 text-teal" aria-label="Up" />;
  if (momentum === "down") {
    return <ArrowDown className="h-3.5 w-3.5 text-safety" aria-label="Down" />;
  }
  return <Minus className="h-3.5 w-3.5 text-muted" aria-label="Flat" />;
}

export default function MapView({
  panelOpen,
  projects,
  searchPin,
  fit,
  bounds,
  placeId,
  placeName,
  tracts,
  loadError,
  onTractClick,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const tractsRef = useRef<TractCollection | null>(null);
  const boundsRef = useRef(bounds);
  const markerRef = useRef<Marker | null>(null);
  const markerClass = useRef<typeof Marker | null>(null);
  const onTractRef = useRef(onTractClick);
  const panelRef = useRef(panelOpen);

  const [ready, setReady] = useState(false);
  const [tip, setTip] = useState<Tip | null>(null);
  const fittedPlace = useRef<string | null>(null);

  boundsRef.current = bounds;
  tractsRef.current = tracts;

  useEffect(() => {
    onTractRef.current = onTractClick;
    panelRef.current = panelOpen;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let map: MlMap | null = null;
    let observer: ResizeObserver | null = null;
    let cancelled = false;

    void (async () => {
      const maplibregl = await import("maplibre-gl");
      if (cancelled || !containerRef.current) return;
      const initialBounds = boundsRef.current;
      maplibregl.setWorkerUrl(`${window.location.origin}/maplibre-gl-worker.mjs`);
      markerClass.current = maplibregl.Marker;
      map = new maplibregl.Map({
        container: containerRef.current,
        style: STYLE,
        ...(initialBounds
          ? { bounds: initialBounds, fitBoundsOptions: { padding: PLACE_PAD } }
          : { center: [OVERVIEW.lng, OVERVIEW.lat], zoom: OVERVIEW.zoom }),
        logoPosition: "bottom-right",
        attributionControl: { compact: false },
        dragRotate: false,
        pitchWithRotate: false,
        fadeDuration: 0,
      });
      mapRef.current = map;
      map.touchZoomRotate.disableRotation();
      const resize = () => map?.resize();
      observer = new ResizeObserver(resize);
      observer.observe(containerRef.current);
      requestAnimationFrame(resize);

      map.on("load", () => {
        if (!map || cancelled) return;
        const colors = [1, 2, 3, 4, 5].map((step, index) =>
          cssColor(`--score-${step}`, SCORE_FALLBACK[index] ?? SCORE_FALLBACK[0]),
        );
        const safety = cssColor("--safety", "#e85d04");
        map.addSource("tracts", {
          type: "geojson",
          data: (tractsRef.current ?? emptyCollection()) as GeoJSON.FeatureCollection,
          promoteId: "geoid",
        });
        map.addSource("search-circle", { type: "geojson", data: emptyCollection() });
        map.addSource("projects", { type: "geojson", data: emptyCollection() });
        map.addLayer({
          id: "tracts-fill",
          type: "fill",
          source: "tracts",
          paint: {
            "fill-color": [
              "step",
              ["to-number", ["get", "score"]],
              colors[0],
              20,
              colors[1],
              40,
              colors[2],
              60,
              colors[3],
              80,
              colors[4],
            ],
            "fill-opacity": 0.65,
          },
        });
        map.addLayer({
          id: "tracts-line",
          type: "line",
          source: "tracts",
          paint: { "line-color": "#ffffff", "line-width": 0.5 },
        });
        map.addLayer({
          id: "tracts-top",
          type: "line",
          source: "tracts",
          filter: [">=", ["to-number", ["get", "percentile"]], 90],
          paint: { "line-color": safety, "line-width": 2 },
        });
        map.addLayer({
          id: "search-circle-fill",
          type: "fill",
          source: "search-circle",
          paint: { "fill-color": safety, "fill-opacity": 0.08 },
        });
        map.addLayer({
          id: "search-circle-line",
          type: "line",
          source: "search-circle",
          paint: { "line-color": safety, "line-width": 2 },
        });
        if (!map.hasImage("infra-diamond")) {
          map.addImage("infra-diamond", diamondImage(safety), { pixelRatio: 2 });
        }
        map.addLayer({
          id: "projects",
          type: "symbol",
          source: "projects",
          layout: {
            "icon-image": "infra-diamond",
            "icon-size": 0.85,
            "icon-allow-overlap": true,
          },
        });

        const showTip = (event: MapLayerMouseEvent) => {
          const props = event.features?.[0]?.properties;
          if (!props || !map) return;
          const width = map.getContainer().clientWidth;
          const height = map.getContainer().clientHeight;
          let left = event.point.x + 14;
          let top = event.point.y + 14;
          const limit = width - (panelRef.current ? 400 : 0);
          if (left + 220 > limit - 8) left = event.point.x - 230;
          if (top + 68 > height - 8) top = event.point.y - 76;
          setTip({
            left: Math.max(8, left),
            top: Math.max(8, top),
            name: String(props.name ?? "Tract"),
            score: String(props.score ?? ""),
            momentum: momentumOf(props.momentum),
          });
        };
        map.on("mousemove", "tracts-fill", showTip);
        map.on("mouseenter", "tracts-fill", () => {
          map?.getCanvas().style.setProperty("cursor", "pointer");
        });
        map.on("mouseleave", "tracts-fill", () => {
          map?.getCanvas().style.removeProperty("cursor");
          setTip(null);
        });
        map.on("click", "tracts-fill", (event) => {
          const geoid = event.features?.[0]?.properties?.geoid;
          if (typeof geoid === "string" && geoid) onTractRef.current(geoid);
        });
        setReady(true);
      });
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
      markerRef.current?.remove();
      markerRef.current = null;
      map?.remove();
      if (mapRef.current === map) mapRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource("tracts");
    if (source?.type !== "geojson") return;
    (source as GeoJSONSource).setData((tracts ?? emptyCollection()) as GeoJSON.FeatureCollection);
  }, [tracts, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !bounds || !placeId) return;
    if (fittedPlace.current === placeId) return;
    const container = map.getContainer();
    if (container.clientWidth < 10 || container.clientHeight < 10) return;
    fittedPlace.current = placeId;
    map.stop();
    map.fitBounds(bounds, fitOptions(PLACE_PAD));
  }, [bounds, placeId, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource("projects");
    if (source?.type !== "geojson") return;
    const data: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: projects.map((project) => ({
        type: "Feature",
        properties: { name: project.name },
        geometry: { type: "Point", coordinates: [project.lng, project.lat] },
      })),
    };
    (source as GeoJSONSource).setData(data);
  }, [projects, ready]);

  useEffect(() => {
    const map = mapRef.current;
    const MarkerClass = markerClass.current;
    if (!map || !ready || !MarkerClass) return;
    const source = map.getSource("search-circle");
    markerRef.current?.remove();
    markerRef.current = null;
    if (source?.type === "geojson") {
      if (!searchPin) {
        (source as GeoJSONSource).setData(emptyCollection());
      } else {
        (source as GeoJSONSource).setData(
          circle([searchPin.lng, searchPin.lat], 0.25, { steps: 64, units: "miles" }),
        );
      }
    }
    if (!searchPin) return;
    map.flyTo({
      center: [searchPin.lng, searchPin.lat],
      zoom: searchPin.zoom,
      duration: 300,
      maxDuration: 300,
      curve: 1,
      easing: easeOut,
      essential: true,
      padding: FRAME,
    });
    const el = document.createElement("div");
    el.className = "place-marker";
    markerRef.current = new MarkerClass({ element: el })
      .setLngLat([searchPin.lng, searchPin.lat])
      .addTo(map);
  }, [searchPin, ready]);

  useEffect(() => {
    const map = mapRef.current;
    const collection = tractsRef.current;
    if (!map || !ready || !fit || !collection) return;
    fitGeoid(map, collection, fit.geoid);
  }, [fit, ready]);

  const rankLabel = placeName ? `Top 10% in ${placeName}` : "Top 10%";
  const sourceLabel = placeName
    ? `${placeName} · Permits and public infrastructure filings · Prototype`
    : "Permits and public infrastructure filings · Prototype";

  return (
    <div className={`absolute inset-0 ${panelOpen ? "panel-open" : ""}`}>
      <div className="absolute inset-0">
        <div ref={containerRef} className="h-full w-full" />
      </div>
      <div className="absolute bottom-16 left-4 z-10 rounded-lg border border-rule bg-paper p-3 shadow-md">
        <div className="font-sans text-xs font-medium text-ink">Path-of-progress score</div>
        <div className="mt-2 flex h-2 w-[200px] overflow-hidden">
          <span className="h-full flex-1 bg-score-1" />
          <span className="h-full flex-1 bg-score-2" />
          <span className="h-full flex-1 bg-score-3" />
          <span className="h-full flex-1 bg-score-4" />
          <span className="h-full flex-1 bg-score-5" />
        </div>
        <div className="mt-1 flex w-[200px] justify-between font-sans text-[11px] text-muted">
          <span>Low</span>
          <span>High</span>
        </div>
        <div className="mt-2 flex items-center gap-2 whitespace-nowrap font-sans text-[11px] text-ink">
          <span className="h-[2px] w-6 shrink-0 bg-safety" />
          {rankLabel}
        </div>
      </div>
      <p
        className={`pointer-events-none absolute bottom-12 z-10 max-w-[420px] font-sans text-[11px] leading-snug text-ink/70 transition-[right] duration-300 ease ${
          panelOpen ? "right-[416px]" : "right-4"
        }`}
      >
        {sourceLabel}
      </p>
      {loadError ? (
        <p className="absolute left-4 top-64 z-10 rounded-md border border-rule bg-paper px-3 py-2 font-sans text-sm text-ink shadow-md">
          {loadError}
        </p>
      ) : null}
      {tip ? (
        <div
          className="pointer-events-none absolute z-20 w-max max-w-[240px] rounded-md border border-rule bg-paper px-3 py-2 shadow-md"
          style={{ left: tip.left, top: tip.top }}
        >
          <div className="font-sans text-sm leading-snug text-ink">{tip.name}</div>
          <div className="mt-1 flex items-center gap-2">
            <span className="font-mono text-sm text-ink">{tip.score}</span>
            <MomentumIcon momentum={tip.momentum} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
