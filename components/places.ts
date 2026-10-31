/** Place list, coverage badge, and search-limit copy shared by the map UI. */

export interface CityPlace {
  id: string;
  name: string;
  /** Southwest / northeast corners as `[lng, lat]`. */
  bounds: [[number, number], [number, number]];
  coverage: unknown;
}

const SIGNAL_KEYS = ["mf_permits", "permit_momentum", "infra_proximity"] as const;
const RESET_KEYS = [
  "resets",
  "reset",
  "reset_at",
  "resets_at",
  "reset_on",
  "resets_on",
  "retry_at",
  "reset_date",
] as const;

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function pair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lng = num(value[0]);
  const lat = num(value[1]);
  if (lng == null || lat == null) return null;
  return [lng, lat];
}

function corners(
  west: number,
  south: number,
  east: number,
  north: number,
): [[number, number], [number, number]] | null {
  if (![west, south, east, north].every((n) => Number.isFinite(n))) return null;
  if (west === east || south === north) return null;
  return [
    [Math.min(west, east), Math.min(south, north)],
    [Math.max(west, east), Math.max(south, north)],
  ];
}

export function parseBounds(value: unknown): [[number, number], [number, number]] | null {
  if (Array.isArray(value) && value.length === 4 && value.every((item) => !Array.isArray(item))) {
    const west = num(value[0]);
    const south = num(value[1]);
    const east = num(value[2]);
    const north = num(value[3]);
    if (west == null || south == null || east == null || north == null) return null;
    return corners(west, south, east, north);
  }

  const first = pair(Array.isArray(value) ? value[0] : null);
  const second = pair(Array.isArray(value) ? value[1] : null);
  if (first && second) return corners(first[0], first[1], second[0], second[1]);

  const rec = record(value);
  if (!rec) return null;
  const west = num(rec.west ?? rec.minLng ?? rec.min_lng ?? rec.west_lng);
  const south = num(rec.south ?? rec.minLat ?? rec.min_lat ?? rec.south_lat);
  const east = num(rec.east ?? rec.maxLng ?? rec.max_lng ?? rec.east_lng);
  const north = num(rec.north ?? rec.maxLat ?? rec.max_lat ?? rec.north_lat);
  if (west != null && south != null && east != null && north != null) {
    return corners(west, south, east, north);
  }

  const sw = record(rec.sw ?? rec.southwest) ?? pairObject(rec.sw);
  const ne = record(rec.ne ?? rec.northeast) ?? pairObject(rec.ne);
  if (sw && ne) {
    const swLng = num(sw.lng ?? sw.lon ?? sw.longitude);
    const swLat = num(sw.lat ?? sw.latitude);
    const neLng = num(ne.lng ?? ne.lon ?? ne.longitude);
    const neLat = num(ne.lat ?? ne.latitude);
    if (swLng != null && swLat != null && neLng != null && neLat != null) {
      return corners(swLng, swLat, neLng, neLat);
    }
  }
  return null;
}

function pairObject(value: unknown): Record<string, unknown> | null {
  const point = pair(value);
  if (!point) return null;
  return { lng: point[0], lat: point[1] };
}

function coverageValue(rec: Record<string, unknown>): unknown {
  if ("coverage" in rec) return rec.coverage;
  if (
    rec.baseline != null ||
    rec.baseline_only != null ||
    rec.baselineOnly != null ||
    rec.signals_available != null ||
    rec.signalsAvailable != null ||
    rec.signal_count != null
  ) {
    return rec;
  }
  return null;
}

export function parsePlaces(body: unknown): CityPlace[] {
  const rec = record(body);
  const list = Array.isArray(body) ? body : rec?.places ?? rec?.data;
  if (!Array.isArray(list)) return [];
  const places: CityPlace[] = [];
  for (const item of list) {
    const row = record(item);
    if (!row) continue;
    const id = text(row.id ?? row.place_id ?? row.slug);
    const name = text(row.name ?? row.label ?? row.title);
    const bounds = parseBounds(row.bounds ?? row.bbox ?? row.bound ?? row.box);
    if (!id || !name || !bounds) continue;
    places.push({ id, name, bounds, coverage: coverageValue(row) });
  }
  return places;
}

export function collectionCoverage(body: unknown): unknown {
  const rec = record(body);
  if (!rec || !("coverage" in rec)) return null;
  return rec.coverage;
}

interface CoverageRead {
  baseline: boolean;
  available: number;
  total: number;
}

function readExplicit(source: unknown): CoverageRead | null {
  if (source == null) return null;
  if (source === "baseline" || source === "baseline_only") {
    return { baseline: true, available: 0, total: 3 };
  }
  if (source === "full" || source === "signals") {
    return { baseline: false, available: 3, total: 3 };
  }
  if (typeof source === "number" && Number.isFinite(source)) {
    const available = Math.max(0, Math.min(3, Math.round(source)));
    return { baseline: available === 0, available, total: 3 };
  }
  const rec = record(source);
  if (!rec) return null;

  if ("coverage" in rec && rec.coverage !== source) {
    const nested = readExplicit(rec.coverage);
    if (nested) return nested;
  }

  if (rec.baseline === true || rec.baseline_only === true || rec.baselineOnly === true) {
    return { baseline: true, available: 0, total: 3 };
  }

  const availableRaw =
    rec.signals_available ?? rec.signalsAvailable ?? rec.signal_count ?? rec.signals_present ?? rec.available;
  const counted = num(availableRaw) ?? (typeof rec.signals === "number" ? rec.signals : null);
  if (counted != null) {
    const totalRaw = num(rec.signals_total ?? rec.signalsTotal ?? rec.total) ?? 3;
    const total = Math.max(1, Math.round(totalRaw));
    const available = Math.max(0, Math.min(total, Math.round(counted)));
    return { baseline: available === 0, available, total };
  }
  return null;
}

function explicitLabel(source: unknown): string | null {
  const rec = record(source);
  if (!rec) return null;
  const own = text(rec.coverage_label ?? rec.coverageLabel);
  if (own) return own;
  const nested = record(rec.coverage);
  return text(nested?.label);
}

function signalBag(source: unknown): Record<string, unknown> | null {
  const rec = record(source);
  if (!rec) return null;
  const signals = record(rec.signals);
  if (signals && SIGNAL_KEYS.some((key) => key in signals)) return signals;
  if (SIGNAL_KEYS.some((key) => key in rec)) return rec;
  return null;
}

/** "Based on 3 of 3 signals", or "Baseline data only" when no signals are present. */
export function coverageLabel(...sources: unknown[]): string {
  for (const source of sources) {
    const label = explicitLabel(source);
    if (label) return label;
  }
  for (const source of sources) {
    const read = readExplicit(source);
    if (!read) continue;
    if (read.baseline || read.available === 0) return "Baseline data only";
    return `Based on ${read.available} of ${read.total} signals`;
  }
  for (const source of sources) {
    const signals = signalBag(source);
    if (!signals) continue;
    const available = SIGNAL_KEYS.filter((key) => typeof signals[key] === "number").length;
    if (available === 0) return "Baseline data only";
    return `Based on ${available} of 3 signals`;
  }
  return "Baseline data only";
}

function resetToken(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1_000_000_000) return String(value);
    return null;
  }
  const raw = text(value);
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return resetToken(Number(raw));
  return raw;
}

export function resetRaw(body: unknown, headers?: Headers): string | null {
  const rec = record(body);
  if (rec) {
    for (const key of RESET_KEYS) {
      const token = resetToken(rec[key]);
      if (token) return token;
    }
    const message = text(rec.error);
    const match = message ? /Resets\s+([^.]+)/i.exec(message) : null;
    if (match?.[1]?.trim()) return match[1].trim();
  }
  if (!headers) return null;
  return (
    resetToken(headers.get("x-ratelimit-reset")) ??
    resetToken(headers.get("x-rate-limit-reset"))
  );
}

export function formatResetDate(value: string): string {
  const trimmed = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (iso) {
    const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    }
  }
  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber) && asNumber > 1_000_000_000) {
    const ms = asNumber > 10_000_000_000 ? asNumber : asNumber * 1000;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    }
  }
  return trimmed.replace(/\.$/, "");
}

export function searchLimitMessage(raw: string | null): string {
  const date = raw ? formatResetDate(raw) : "";
  if (!date) return "You've used your 3 free searches this week.";
  return `You've used your 3 free searches this week. Resets ${date}.`;
}
