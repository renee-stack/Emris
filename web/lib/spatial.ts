// Pure spatial helpers shared by the API routes and the client fallback.
// Shapes match contract.md. No filesystem access, so client components can import this.

import type {
  MemoResponse,
  NearResponse,
  Permit,
  Project,
  ProjectStatus,
  ProjectWithDistance,
  TractCollection,
  TractDetailResponse,
  TractFeature,
  TractGeometry,
  TractProps,
} from "@/lib/data";

export const EARTH_MI = 3958.8;

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  planned: "Planned",
  funded: "Funded",
  under_construction: "Under construction",
  complete: "Complete",
};

export interface Bundle {
  tracts: TractCollection;
  permits: Permit[];
  projects: Project[];
}

export type DeepLink =
  | { kind: "tract"; geoid: string }
  | { kind: "point"; lat: number; lng: number; zoom: number };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatMonth(iso: string): string {
  const [year, month] = iso.split("-");
  const index = Number(month) - 1;
  if (!year || index < 0 || index > 11) return iso;
  return `${MONTHS[index]} ${year}`;
}

export function formatCoord(n: number): string {
  return String(Math.round(n * 1e5) / 1e5);
}

export function formatMomentumPct(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  const body = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${rounded > 0 ? "+" : ""}${body}%`;
}

export function formatMiles(n: number): string {
  return `${n.toFixed(1)} mi`;
}

export function tractHref(geoid: string): string {
  return `/?tract=${geoid}`;
}

export function pointHref(lat: number, lng: number, zoom: number): string {
  const z = Number.isFinite(zoom) ? String(Math.round(zoom)) : "15";
  return `/?lat=${formatCoord(lat)}&lng=${formatCoord(lng)}&z=${z}`;
}

/** `tract` wins when both a tract and a point are present. */
export function readDeepLink(search: string): DeepLink | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const tract = params.get("tract");
  if (tract && /^\d{11}$/.test(tract)) return { kind: "tract", geoid: tract };
  const latRaw = params.get("lat");
  const lngRaw = params.get("lng");
  if (latRaw == null || lngRaw == null || latRaw.trim() === "" || lngRaw.trim() === "") return null;
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const z = Number(params.get("z"));
  return { kind: "point", lat, lng, zoom: Number.isFinite(z) ? z : 15 };
}

export function haversine(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const lat1 = rad(a.lat);
  const lat2 = rad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function ringVertices(ring: [number, number][]): [number, number][] {
  if (ring.length > 1) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) return ring.slice(0, -1);
  }
  return ring;
}

function polygons(geometry: TractGeometry): [number, number][][][] {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

/** Mean of outer-ring vertices, excluding each ring's closing point. */
export function centroid(geometry: TractGeometry): { lat: number; lng: number } {
  let n = 0;
  let lat = 0;
  let lng = 0;
  for (const poly of polygons(geometry)) {
    for (const [x, y] of ringVertices(poly[0])) {
      lng += x;
      lat += y;
      n += 1;
    }
  }
  if (n === 0) return { lat: 0, lng: 0 };
  return { lat: lat / n, lng: lng / n };
}

export function featureBounds(
  geometry: TractGeometry,
): [[number, number], [number, number]] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of polygons(geometry)) {
    for (const ring of poly) {
      for (const [x, y] of ring) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return [
    [minX, minY],
    [maxX, maxY],
  ];
}

function inRing(ring: [number, number][], lng: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const crosses = yi > lat !== yj > lat;
    if (crosses && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function contains(geometry: TractGeometry, lng: number, lat: number): boolean {
  for (const poly of polygons(geometry)) {
    if (!inRing(poly[0], lng, lat)) continue;
    let hole = false;
    for (let h = 1; h < poly.length; h += 1) {
      if (inRing(poly[h], lng, lat)) {
        hole = true;
        break;
      }
    }
    if (!hole) return true;
  }
  return false;
}

export function tractAt(tracts: TractCollection, lng: number, lat: number): TractProps | null {
  for (const feature of tracts.features) {
    if (contains(feature.geometry, lng, lat)) return feature.properties;
  }
  return null;
}

function inChicago(lat: number, lng: number): boolean {
  return lat >= 41.64 && lat <= 42.03 && lng >= -87.94 && lng <= -87.52;
}

function norm(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function community(name: string): string {
  return name.split(" · ")[0] ?? name;
}

interface PlaceHit {
  label: string;
  lat: number;
  lng: number;
}

function neighborhoodHit(tracts: TractCollection, query: string, exact: boolean): PlaceHit | null {
  const groups = new Map<string, { label: string; features: TractFeature[] }>();
  for (const feature of tracts.features) {
    const label = community(feature.properties.name);
    const key = norm(label);
    const group = groups.get(key);
    if (group) group.features.push(feature);
    else groups.set(key, { label, features: [feature] });
  }
  let best: { label: string; features: TractFeature[] } | null = null;
  for (const [key, group] of groups) {
    const match = exact ? key === query : query.length >= 4 && key.includes(query);
    if (!match) continue;
    if (!best || group.label.length < best.label.length) best = group;
  }
  if (!best) return null;
  let lat = 0;
  let lng = 0;
  for (const feature of best.features) {
    const c = centroid(feature.geometry);
    lat += c.lat;
    lng += c.lng;
  }
  return {
    label: `${best.label}, Chicago`,
    lat: lat / best.features.length,
    lng: lng / best.features.length,
  };
}

export function locate(query: string, bundle: Bundle): PlaceHit | null {
  const q = norm(query);
  if (!q) return null;

  const coord = q.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (coord) {
    const lat = Number(coord[1]);
    const lng = Number(coord[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inChicago(lat, lng)) return null;
    return { label: `${formatCoord(lat)}, ${formatCoord(lng)}`, lat, lng };
  }

  const exactAddress = bundle.permits.find((permit) => norm(permit.address) === q);
  if (exactAddress) {
    return {
      label: `${exactAddress.address}, Chicago`,
      lat: exactAddress.lat,
      lng: exactAddress.lng,
    };
  }

  const exactArea = neighborhoodHit(bundle.tracts, q, true);
  if (exactArea) return exactArea;

  const address = bundle.permits.find(
    (permit) => q.length >= 5 && norm(permit.address).includes(q),
  );
  if (address) {
    return { label: `${address.address}, Chicago`, lat: address.lat, lng: address.lng };
  }

  const area = neighborhoodHit(bundle.tracts, q, false);
  if (area) return area;

  const project = bundle.projects.find(
    (item) => q.length >= 5 && norm(item.name).includes(q),
  );
  if (project) return { label: `${project.name}, Chicago`, lat: project.lat, lng: project.lng };

  return null;
}

function nearbyProjects(
  origin: { lat: number; lng: number },
  projects: Project[],
  maxMi: number,
): ProjectWithDistance[] {
  return projects
    .map((project) => ({ project, distance: haversine(origin, project) }))
    .filter((item) => item.distance <= maxMi)
    .sort((a, b) => a.distance - b.distance)
    .map((item) => ({ ...item.project, distance_mi: round2(item.distance) }));
}

export function buildTractDetail(
  tracts: TractCollection,
  permits: Permit[],
  projects: Project[],
  geoid: string,
): TractDetailResponse | null {
  const feature = tracts.features.find((item) => item.properties.geoid === geoid);
  if (!feature) return null;
  const origin = centroid(feature.geometry);
  const top_permits = permits
    .filter((permit) => permit.geoid === geoid)
    .sort((a, b) => b.issue_date.localeCompare(a.issue_date))
    .slice(0, 10);
  return {
    tract: feature.properties,
    top_permits,
    nearby_projects: nearbyProjects(origin, projects, 1),
  };
}

export function buildNear(query: string, radiusMi: number, bundle: Bundle): NearResponse | null {
  const place = locate(query, bundle);
  if (!place) return null;
  const permits = bundle.permits
    .map((permit) => ({ permit, distance: haversine(place, permit) }))
    .filter((item) => item.distance <= radiusMi)
    .sort((a, b) => b.permit.issue_date.localeCompare(a.permit.issue_date))
    .slice(0, 25)
    .map((item) => item.permit);
  return {
    place,
    tract: tractAt(bundle.tracts, place.lng, place.lat),
    permits,
    projects: nearbyProjects(place, bundle.projects, radiusMi),
  };
}

export function buildMemo(detail: TractDetailResponse): MemoResponse {
  const tract = detail.tract;
  const top = Math.max(0, 100 - tract.percentile);
  const direction =
    tract.momentum === "up" ? "up" : tract.momentum === "down" ? "down" : "flat";
  const summary = `${tract.name} has a path-of-progress score of ${tract.score} out of 100, placing it in the top ${top}% of Chicago tracts. Momentum is ${direction} at ${formatMomentumPct(tract.momentum_pct)} versus the prior 12 months. Over the last 24 months the tract recorded ${tract.permit_count_24mo} permits and ${tract.units_24mo} housing units.`;
  const signals = [
    `Multifamily permits: ${tract.signals.mf_permits} out of 100.`,
    `Permit momentum: ${tract.signals.permit_momentum} out of 100.`,
    `Infrastructure catalysts: ${tract.signals.infra_proximity} out of 100.`,
  ].join("\n\n");
  const permits = detail.top_permits.length
    ? detail.top_permits
        .map((permit) => {
          const units =
            permit.units == null ? "unit count not reported" : `${permit.units} units`;
          return `- ${permit.address} — ${units} — ${formatMonth(permit.issue_date)}. ${permit.description}`;
        })
        .join("\n")
    : "No permits are on file for this tract.";
  const projects = detail.nearby_projects.length
    ? detail.nearby_projects
        .map((project) => {
          const budget =
            project.budget_usd == null
              ? "budget not reported"
              : `budget $${project.budget_usd.toLocaleString("en-US")}`;
          const done = project.expected_completion
            ? `, expected ${project.expected_completion}`
            : "";
          return `- ${project.name} — ${STATUS_LABEL[project.status]} — ${formatMiles(project.distance_mi)}. ${project.description} (${budget}${done}).`;
        })
        .join("\n")
    : "No public infrastructure projects within 1 mile of the tract centroid.";
  const risks = [
    "Scores rank this tract against the tracts in the current file. They are not a price forecast.",
    "Permits with an unreported unit count are excluded from the multifamily signal and counted as zero units in the 24-month unit total.",
    "Infrastructure projects are represented by a single point, so distance is to that point rather than to the full project extent.",
  ].join("\n\n");
  return {
    geoid: tract.geoid,
    title: `${tract.name} — Path of Progress Memo`,
    memo_markdown: `## Summary\n\n${summary}\n\n## Signals\n\n${signals}\n\n## Recent Permits\n\n${permits}\n\n## Infrastructure Nearby\n\n${projects}\n\n## Risks & Unknowns\n\n${risks}\n`,
  };
}
