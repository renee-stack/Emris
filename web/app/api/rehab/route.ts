import { connection, type NextRequest } from "next/server";
import { shapePaidList } from "@/lib/access";
import { errorResponse } from "@/lib/lookup";
import { rehabCandidates } from "@/lib/rehab";
import { getViewer } from "@/lib/viewer";

// GET /api/rehab?geoid= — named rehab candidates, trimmed by plan.
export async function GET(req: NextRequest) {
  await connection();
  try {
    const geoid = req.nextUrl.searchParams.get("geoid")?.trim() ?? "";
    const user = await getViewer(req);
    const rows = await rehabCandidates(geoid);
    const list = shapePaidList(user, rows, { report_type: "area", target_id: geoid });
    if (!list.visible) return Response.json({ locked: true, rows: [] });
    return Response.json(list);
  } catch (err) {
    return errorResponse(err);
  }
}
