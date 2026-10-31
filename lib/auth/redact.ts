import type { TractDetailResponse } from "@/lib/data";

/** Permit rows and project rows are account data. Scores stay on the tract. */
export function redactTract(detail: TractDetailResponse, signedIn: boolean): TractDetailResponse {
  if (signedIn) return detail;
  return { tract: detail.tract, top_permits: [], nearby_projects: [] };
}
