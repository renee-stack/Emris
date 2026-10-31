import {
  canSeePermitDetails,
  canUseWayback,
  shapePaidList,
} from "@/lib/access";
import { errorResponse, tractDetail } from "@/lib/lookup";
import { rehabCandidates } from "@/lib/rehab";
import { getViewer } from "@/lib/viewer";

// GET /api/tract/[geoid] — fields the viewer cannot have are left out.
export async function GET(req: Request, { params }: { params: Promise<{ geoid: string }> }) {
  try {
    const { geoid } = await params;
    const user = await getViewer(req);
    const detail = await tractDetail(geoid);
    const candidates = await rehabCandidates(geoid);
    const rehab = shapePaidList(user, candidates, { report_type: "area", target_id: geoid });
    const locked: string[] = [];
    const body: Record<string, unknown> = {
      tract: detail.tract,
      nearby_projects: detail.nearby_projects,
    };
    if (canSeePermitDetails(user)) body.top_permits = detail.top_permits;
    else locked.push("top_permits");
    if (canUseWayback(user)) body.wayback = { available: true };
    else locked.push("wayback");
    if (rehab.visible) {
      body.rehab = rehab;
      if (rehab.locked) locked.push("rehab");
    } else {
      locked.push("rehab");
    }
    if (locked.length > 0) body.locked = locked;
    return Response.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
