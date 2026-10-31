// Named rehab candidates built from permits already on file. Nothing is invented.
import type { Permit } from "@/lib/data";
import { getPermits } from "@/lib/data";
import { GEOID_RE, getTractFeature, HttpError } from "@/lib/lookup";

export interface RehabCandidate {
  permit_id: string;
  address: string;
  units: number | null;
  issue_date: string;
  description: string;
}

function toCandidate(permit: Permit): RehabCandidate {
  return {
    permit_id: permit.id,
    address: permit.address,
    units: permit.units,
    issue_date: permit.issue_date,
    description: permit.description,
  };
}

/** Newest permit first. The first row is the only row a free account receives. */
export async function rehabCandidates(geoid: string): Promise<RehabCandidate[]> {
  if (!GEOID_RE.test(geoid)) throw new HttpError(400, "geoid must be 11 digits");
  const feature = await getTractFeature(geoid);
  if (!feature) throw new HttpError(404, `Unknown tract ${geoid}`);
  const permits = await getPermits();
  return permits
    .filter((permit) => permit.geoid === geoid)
    .sort((a, b) => b.issue_date.localeCompare(a.issue_date) || a.address.localeCompare(b.address) || a.id.localeCompare(b.id))
    .map(toCandidate);
}
