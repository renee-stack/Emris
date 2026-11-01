import type { SearchLimitPayload, AccountSnapshot } from "@/lib/billing/pure";
import type {
  GatedTractResponse,
  MemoResponse,
  NearResponse,
  Permit,
  Project,
  TractCollection,
} from "@/lib/data";
import type { Bundle } from "@/lib/spatial";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
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

export async function fetchTracts(): Promise<TractCollection> {
  try {
    const res = await fetch("/api/tracts", { cache: "no-store" });
    if (res.ok) return (await res.json()) as TractCollection;
  } catch {
    // Fall through to the static file.
  }
  return (await publicBundle()).tracts;
}

export class SearchLimitError extends ApiError {
  payload: SearchLimitPayload;
  constructor(payload: SearchLimitPayload) {
    super(402, payload.error);
    this.payload = payload;
  }
}

function isSearchLimit(value: unknown): value is SearchLimitPayload {
  return Boolean(value) && typeof value === "object" && (value as { code?: unknown }).code === "search_limit";
}

export async function fetchAccount(): Promise<AccountSnapshot> {
  const res = await fetch("/api/account", { cache: "no-store" });
  if (!res.ok) throw new ApiError(res.status, "Could not load the account.");
  return (await res.json()) as AccountSnapshot;
}

export async function fetchTract(geoid: string): Promise<GatedTractResponse> {
  const res = await fetch(`/api/tract/${geoid}`, { cache: "no-store" });
  const json = (res.headers.get("content-type") ?? "").includes("json");
  if (res.ok) return (await res.json()) as GatedTractResponse;
  if (json) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? "Could not load tract.");
  }
  throw new ApiError(res.status, "Could not load tract.");
}

export async function fetchNear(query: string): Promise<NearResponse> {
  const res = await fetch(
    `/api/near?q=${encodeURIComponent(query)}&radius_mi=0.25`,
    { cache: "no-store" },
  );
  const json = (res.headers.get("content-type") ?? "").includes("json");
  if (res.ok) return (await res.json()) as NearResponse;
  if (json) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    if (res.status === 402 && isSearchLimit(body)) throw new SearchLimitError(body);
    throw new ApiError(res.status, body?.error ?? "Could not search.");
  }
  throw new ApiError(res.status, "Could not search.");
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
