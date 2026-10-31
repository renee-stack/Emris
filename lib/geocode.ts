// Turn free text into a Chicago lat/lng. Neighborhood names resolve locally; everything else goes to the
// US Census Geocoder. Returns null on any failure (never throws).
import neighborhoods from "@/lib/neighborhoods.json";
import { inChicagoBounds } from "@/lib/geo";

export interface GeocodeResult {
  label: string;
  lat: number;
  lng: number;
  source: "neighborhood" | "census";
}

type Entry = { name: string; lat: number; lng: number; aliases: string[] };

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(chicago|il|illinois|usa)\b/g, " ")
    .replace(/\b(the )?(neighborhood|area|community area)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const INDEX = new Map<string, Entry>();
for (const e of [...neighborhoods.nicknames, ...neighborhoods.community_areas] as Entry[]) {
  for (const key of [e.name, ...e.aliases]) {
    const k = norm(key);
    if (!INDEX.has(k)) INDEX.set(k, e); // nicknames first so they win ties
  }
}

export function lookupNeighborhood(query: string): GeocodeResult | null {
  const e = INDEX.get(norm(query)) ?? INDEX.get(norm(query).replace(/^the /, ""));
  return e ? { label: `${e.name}, Chicago`, lat: e.lat, lng: e.lng, source: "neighborhood" } : null;
}

const CENSUS_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";

interface CensusMatch {
  matchedAddress: string;
  coordinates: { x: number; y: number };
}

function withCity(q: string): string {
  return /chicago|,\s*il\b|\billinois\b/i.test(q) ? q : `${q}, Chicago, IL`;
}

function titleCaseLabel(matched: string): string {
  // "1500 N MILWAUKEE AVE, CHICAGO, IL, 60622" -> "1500 N Milwaukee Ave, Chicago"
  const [street, city] = matched.split(",").map((s) => s.trim());
  const tc = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
  return city ? `${tc(street)}, ${tc(city)}` : tc(street);
}

export async function censusGeocode(query: string): Promise<GeocodeResult | null> {
  try {
    const url = new URL(CENSUS_URL);
    url.searchParams.set("address", withCity(query));
    url.searchParams.set("benchmark", "Public_AR_Current");
    url.searchParams.set("format", "json");
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { result?: { addressMatches?: CensusMatch[] } };
    const m = body.result?.addressMatches?.[0];
    if (!m) return null;
    const pt = { lat: m.coordinates.y, lng: m.coordinates.x };
    if (!inChicagoBounds(pt)) return null;
    return { label: titleCaseLabel(m.matchedAddress), ...pt, source: "census" };
  } catch {
    return null;
  }
}

export async function geocode(query: string): Promise<GeocodeResult | null> {
  const q = query.trim();
  if (!q) return null;
  return lookupNeighborhood(q) ?? (await censusGeocode(q));
}
