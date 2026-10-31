import type { MemoResponse, NearResponse, TractCollection, TractDetailResponse } from "@/lib/data";
import { collectionCoverage, parsePlaces, resetRaw, type CityPlace } from "@/components/places";

export class ApiError extends Error {
  status: number;
  resets: string | null;
  constructor(status: number, message: string, resets: string | null = null) {
    super(message);
    this.status = status;
    this.resets = resets;
  }
}

export async function fetchPlaces(): Promise<CityPlace[]> {
  const res = await fetch("/api/places", { cache: "no-store" });
  if (!res.ok) throw new ApiError(res.status, "Couldn't load places.");
  return parsePlaces(await res.json());
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
  const res = await fetch(`/api/tract/${encodeURIComponent(geoid)}`, { cache: "no-store" });
  const body = (await res.json().catch(() => null)) as { error?: string } | TractDetailResponse | null;
  if (res.ok && body) return body as TractDetailResponse;
  throw new ApiError(res.status, (body as { error?: string } | null)?.error ?? "Could not load tract.");
}

export async function fetchNear(query: string): Promise<NearResponse> {
  const res = await fetch(`/api/near?q=${encodeURIComponent(query)}&radius_mi=0.25`, {
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as { error?: string } | NearResponse | null;
  if (res.status === 429) {
    throw new ApiError(429, "Search limit reached.", resetRaw(body, res.headers));
  }
  if (res.ok && body) return body as NearResponse;
  throw new ApiError(
    res.status,
    res.status === 404 ? "Couldn't find that place." : ((body as { error?: string } | null)?.error ?? "Could not search."),
  );
}

export async function fetchMemo(geoid: string): Promise<MemoResponse> {
  const res = await fetch("/api/memo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ geoid }),
    cache: "no-store",
  });
  if (res.ok) return (await res.json()) as MemoResponse;
  throw new ApiError(res.status, "Couldn't generate the memo.");
}
