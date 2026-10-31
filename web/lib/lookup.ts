// Data lookups shared by the API routes. Server-only.
import { getPermits, getProjects, getTracts } from "@/lib/data";
import type { NearResponse, TractDetailResponse, TractFeature } from "@/lib/data";
import { findTract, permitsNear, projectsNear, tractCentroid } from "@/lib/geo";
import { geocode, type GeocodeResult } from "@/lib/geocode";

export const GEOID_RE = /^\d{11}$/;

const STATUS_CODE: Record<number, string> = {
  400: "bad_request",
  401: "auth_required",
  402: "payment_required",
  404: "not_found",
  409: "already_entitled",
  429: "limit_reached",
  500: "internal",
};

export class HttpError extends Error {
  readonly code: string;
  readonly extra: Record<string, unknown>;
  constructor(
    public status: number,
    message: string,
    code?: string,
    extra?: Record<string, unknown>,
  ) {
    super(message);
    this.code = code ?? STATUS_CODE[status] ?? "internal";
    this.extra = extra ?? {};
  }
}

/** JSON error response. Unknown errors become 500. */
export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return Response.json({ error: err.message, code: err.code, ...err.extra }, { status: err.status });
  }
  console.error(err);
  const message = err instanceof Error ? err.message : "Internal error";
  return Response.json({ error: message, code: "internal" }, { status: 500 });
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "Body must be JSON.");
  }
}

export async function getTractFeature(geoid: string): Promise<TractFeature | null> {
  const { features } = await getTracts();
  return features.find((f) => f.properties.geoid === geoid) ?? null;
}

/** §2.2. Throws HttpError 400/404. */
export async function tractDetail(geoid: string): Promise<TractDetailResponse> {
  if (!GEOID_RE.test(geoid)) throw new HttpError(400, "geoid must be 11 digits");
  const feature = await getTractFeature(geoid);
  if (!feature) throw new HttpError(404, `Unknown tract ${geoid}`);
  const [permits, projects] = await Promise.all([getPermits(), getProjects()]);
  const top_permits = permits
    .filter((p) => p.geoid === geoid)
    .sort((a, b) => b.issue_date.localeCompare(a.issue_date))
    .slice(0, 10);
  const nearby_projects = projectsNear(projects, tractCentroid(feature.geometry), 1.0);
  return { tract: feature.properties, top_permits, nearby_projects };
}

export function clampRadius(raw: string | null | undefined, fallback = 0.25): number {
  const n = raw == null || raw === "" ? NaN : Number(raw);
  const r = Number.isFinite(n) ? n : fallback;
  return Math.min(2, Math.max(0.05, r));
}

/** §2.3 for an already-geocoded place. */
export async function nearPlace(place: GeocodeResult, radiusMi: number): Promise<NearResponse> {
  const [{ features }, permits, projects] = await Promise.all([getTracts(), getPermits(), getProjects()]);
  const tract = findTract(features, place);
  return {
    place: { label: place.label, lat: place.lat, lng: place.lng },
    tract: tract?.properties ?? null,
    permits: permitsNear(permits, place, radiusMi),
    projects: projectsNear(projects, place, radiusMi),
  };
}

/** §2.3. Throws HttpError 400/404. */
export async function near(q: string, radiusMi: number): Promise<NearResponse & { source: GeocodeResult["source"] }> {
  if (!q.trim()) throw new HttpError(400, "q is required");
  const place = await geocode(q);
  if (!place) throw new HttpError(404, `Couldn't find "${q}" in Chicago`);
  return { ...(await nearPlace(place, radiusMi)), source: place.source };
}

