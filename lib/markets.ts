// Places are the named areas already on the tract records. Nothing here names a city.
import { getTracts, type TractFeature } from "@/lib/data";
import { featureBounds } from "@/lib/spatial";

const PLACE_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,80}$/;
const SIGNAL_KEYS = ["mf_permits", "permit_momentum", "infra_proximity"] as const;

export interface MarketPlace {
  id: string;
  name: string;
  bounds: [[number, number], [number, number]];
  coverage: { signals_available: number; signals_total: number };
}

/** The area label in a tract name, before the tract number. */
export function areaName(tractName: string): string {
  const parts = tractName.split("·");
  const head = (parts.length > 1 ? parts[0] : tractName).trim();
  return head || tractName.trim();
}

function slug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function uniqueId(name: string, used: Set<string>): string | null {
  const base = slug(name);
  if (!base) return null;
  let id = base;
  let n = 2;
  while (used.has(id) || !PLACE_RE.test(id)) {
    const suffix = `-${n++}`;
    id = `${base.slice(0, Math.max(1, 80 - suffix.length))}${suffix}`;
    if (n > 100) return null;
  }
  used.add(id);
  return id;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function signalCount(feature: TractFeature): number {
  const signals = feature.properties.signals;
  if (!signals) return 0;
  return SIGNAL_KEYS.filter((key) => typeof signals[key] === "number").length;
}

/** One place per area named in the tract file, with bounds around that area's tracts. */
export async function listPlaces(): Promise<MarketPlace[]> {
  const { features } = await getTracts();
  const groups = new Map<string, TractFeature[]>();
  for (const feature of features) {
    const name = areaName(feature.properties.name ?? "");
    if (!name) continue;
    const list = groups.get(name);
    if (list) list.push(feature);
    else groups.set(name, [feature]);
  }

  const used = new Set<string>();
  const places: MarketPlace[] = [];
  for (const name of [...groups.keys()].sort((a, b) => a.localeCompare(b))) {
    const id = uniqueId(name, used);
    const members = groups.get(name);
    if (!id || !members?.length) continue;
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    let signals = 0;
    for (const feature of members) {
      const [[minX, minY], [maxX, maxY]] = featureBounds(feature.geometry);
      if (![minX, minY, maxX, maxY].every(Number.isFinite)) continue;
      west = Math.min(west, minX);
      south = Math.min(south, minY);
      east = Math.max(east, maxX);
      north = Math.max(north, maxY);
      signals = Math.max(signals, signalCount(feature));
    }
    if (![west, south, east, north].every(Number.isFinite)) continue;
    if (west === east || south === north) continue;
    places.push({
      id,
      name,
      bounds: [
        [round6(west), round6(south)],
        [round6(east), round6(north)],
      ],
      coverage: { signals_available: signals, signals_total: 3 },
    });
  }
  return places;
}
