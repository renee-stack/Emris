import type {
  MemoResponse,
  NearResponse,
  Permit,
  Project,
  TractCollection,
  TractDetailResponse,
} from "@/lib/data";
import { collectionCoverage, parsePlaces, resetRaw, type CityPlace } from "@/components/places";
import { buildMemo, buildNear, buildTractDetail, type Bundle } from "@/lib/spatial";

export class ApiError extends Error {
  status: number;
  resets: string | null;
  constructor(status: number, message: string, resets: string | null = null) {
    super(message);
    this.status = status;
    this.resets = resets;
  }
}

let bundleP: Promise<Bundle> | null = null;

function publicBundle(): Promise<Bundle> {
  if (!bundleP) {
    bundleP = Promise.all([
      fetch("/tracts.geojson").then((res) => {
        if (!res.ok) throw new Error("tracts");
        return res.json() as Promise<TractCollection>;
      }),
      fetch("/permits.json").then((res) => {
        if (!res.ok) throw new Error("permits");
        return res.json() as Promise<Permit[]>;
      }),
      fetch("/infrastructure.json").then((res) => {
        if (!res.ok) throw new Error("projects");
        return res.json() as Promise<Project[]>;
      }),
    ])
      .then(([tracts, permits, projects]) => ({ tracts, permits, projects }))
      .catch((error: unknown) => {
        bundleP = null;
        throw error;
      });
  }
  return bundleP;
}

export async function fetchPlaces(): Promise<CityPlace[]> {
  const res = await fetch("/api/places", { cache: "no-store" });
  if (!res.ok) throw new ApiError(res.status, "Couldn't load places.");
  const places = parsePlaces(await res.json());
  if (places.length === 0) throw new ApiError(404, "Couldn't load places.");
  return places;
}

export async function fetchTracts(
  placeId: string,
): Promise<{ collection: TractCollection; coverage: unknown }> {
  const res = await fetch(`/api/tracts?place_id=${encodeURIComponent(placeId)}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new ApiError(res.status, "Couldn't load tract scores.");
  const body: unknown = await res.json();
  return { collection: body as TractCollection, coverage: collectionCoverage(body) };
}

export async function fetchTract(geoid: string): Promise<TractDetailResponse> {
  const res = await fetch(`/api/tract/${geoid}`, { cache: "no-store" });
  const json = (res.headers.get("content-type") ?? "").includes("json");
  if (res.ok) return (await res.json()) as TractDetailResponse;
  if (json) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? "Could not load tract.");
  }
  const bundle = await publicBundle();
  const detail = buildTractDetail(bundle.tracts, bundle.permits, bundle.projects, geoid);
  if (!detail) throw new ApiError(404, "Tract not found.");
  return detail;
}

export async function fetchNear(query: string): Promise<NearResponse> {
  const res = await fetch(
    `/api/near?q=${encodeURIComponent(query)}&radius_mi=0.25`,
    { cache: "no-store" },
  );
  const json = (res.headers.get("content-type") ?? "").includes("json");
  if (res.status === 429) {
    const body = json ? await res.json().catch(() => null) : null;
    throw new ApiError(429, "Search limit reached.", resetRaw(body, res.headers));
  }
  if (res.ok) return (await res.json()) as NearResponse;
  if (json) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? "Could not search.");
  }
  const near = buildNear(query, 0.25, await publicBundle());
  if (!near) throw new ApiError(404, "Couldn't find that place.");
  return near;
}

export async function fetchMemo(geoid: string): Promise<MemoResponse> {
  const res = await fetch("/api/memo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ geoid }),
    cache: "no-store",
  });
  const json = (res.headers.get("content-type") ?? "").includes("json");
  if (res.ok) return (await res.json()) as MemoResponse;
  if (!json) return buildMemo(await fetchTract(geoid));
  throw new ApiError(res.status, "Couldn't generate the memo.");
}
