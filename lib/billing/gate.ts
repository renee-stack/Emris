import type { GatedTractResponse, OwnerRecord, Permit, ProjectWithDistance, TractProps } from "@/lib/data";
import { isMultifamilyPermit, isRehabCandidate, previewRecords, type AccessLevel } from "./pure";

export function gateTract(input: {
  tract: TractProps;
  permits: Permit[];
  projects: ProjectWithDistance[];
  owners: OwnerRecord[];
  access: AccessLevel;
}): GatedTractResponse {
  const history = previewRecords(input.permits, input.access);
  const multifamily = previewRecords(input.permits.filter(isMultifamilyPermit), input.access);
  const rehab = previewRecords(input.permits.filter(isRehabCandidate), input.access);
  const owners = previewRecords(
    [...input.owners]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((owner) => ({ id: owner.id, name: owner.name, address: owner.address })),
    input.access,
  );
  return {
    tract: input.tract,
    top_permits: history.rows.slice(0, 10),
    nearby_projects: input.projects,
    access: input.access,
    multifamily_permits: multifamily,
    rehab_candidates: rehab,
    owners,
    permit_history: history,
  };
}
