// Geo helpers: haversine distance, radius filters, tract centroid (§3.4) and point-in-tract lookup.
import { booleanPointInPolygon } from "@turf/turf";
import type { Permit, Position, Project, ProjectWithDistance, TractFeature, TractGeometry } from "@/lib/data";

const EARTH_RADIUS_MI = 3958.8; // contract §2

export interface LatLng {
  lat: number;
  lng: number;
}

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in miles. */
export function haversineMi(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Points within `radiusMi` of `center`, in the input order. */
export function withinRadius<T extends LatLng>(points: T[], center: LatLng, radiusMi: number): T[] {
  return points.filter((p) => haversineMi(center, p) <= radiusMi);
}

/** Projects within `radiusMi`, with distance_mi (2 decimals), nearest first. */
export function projectsNear(projects: Project[], center: LatLng, radiusMi: number): ProjectWithDistance[] {
  return projects
    .map((p) => ({ ...p, distance_mi: haversineMi(center, p) }))
    .filter((p) => p.distance_mi <= radiusMi)
    .sort((a, b) => a.distance_mi - b.distance_mi)
    .map((p) => ({ ...p, distance_mi: round2(p.distance_mi) }));
}

/** Permits within `radiusMi`, newest first (input is already newest first, but sort to be safe). */
export function permitsNear(permits: Permit[], center: LatLng, radiusMi: number, max = 25): Permit[] {
  return withinRadius(permits, center, radiusMi)
    .sort((a, b) => b.issue_date.localeCompare(a.issue_date))
    .slice(0, max);
}

/** Contract §3.4: mean of outer-ring vertices, excluding each ring's closing point. */
export function tractCentroid(geometry: TractGeometry): LatLng {
  const rings: Position[][] =
    geometry.type === "Polygon" ? [geometry.coordinates[0]] : geometry.coordinates.map((poly) => poly[0]);
  let sumLng = 0;
  let sumLat = 0;
  let n = 0;
  for (const ring of rings) {
    const last = ring.length - 1;
    const closed = last > 0 && ring[0][0] === ring[last][0] && ring[0][1] === ring[last][1];
    const verts = closed ? ring.slice(0, last) : ring;
    for (const [lng, lat] of verts) {
      sumLng += lng;
      sumLat += lat;
      n++;
    }
  }
  return { lat: sumLat / n, lng: sumLng / n };
}

/** The tract containing the point, or null. */
export function findTract(features: TractFeature[], pt: LatLng): TractFeature | null {
  const point: [number, number] = [pt.lng, pt.lat];
  return features.find((f) => booleanPointInPolygon(point, f.geometry)) ?? null;
}

/** Tracts sorted by centroid distance from the point. */
export function nearestTracts(features: TractFeature[], pt: LatLng, n = 3): (TractFeature & { distance_mi: number })[] {
  return features
    .map((f) => ({ ...f, distance_mi: round2(haversineMi(pt, tractCentroid(f.geometry))) }))
    .sort((a, b) => a.distance_mi - b.distance_mi)
    .slice(0, n);
}

/** Chicago's rough bounding box, used to reject geocoder hits outside the city. */
export function inChicagoBounds(pt: LatLng): boolean {
  return pt.lat >= 41.64 && pt.lat <= 42.03 && pt.lng >= -87.95 && pt.lng <= -87.52;
}
