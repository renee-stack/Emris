import { getPermits, getProjects, getTracts } from "@/lib/data";
import { buildMemo, buildNear, buildTractDetail, type Bundle } from "@/lib/spatial";
import type { MemoResponse, NearResponse, TractCollection, TractDetailResponse } from "@/lib/data";

async function bundle(): Promise<Bundle> {
  const [tracts, permits, projects] = await Promise.all([
    getTracts(),
    getPermits(),
    getProjects(),
  ]);
  return { tracts, permits, projects };
}

export function loadTracts(): Promise<TractCollection> {
  return getTracts();
}

export async function loadTractDetail(geoid: string): Promise<TractDetailResponse | null> {
  const data = await bundle();
  return buildTractDetail(data.tracts, data.permits, data.projects, geoid);
}

export async function loadNear(query: string, radiusMi: number): Promise<NearResponse | null> {
  return buildNear(query, radiusMi, await bundle());
}

export async function loadMemo(geoid: string): Promise<MemoResponse | null> {
  const detail = await loadTractDetail(geoid);
  if (!detail) return null;
  return buildMemo(detail);
}
