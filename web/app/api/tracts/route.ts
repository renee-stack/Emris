import { getPlan } from "@/lib/access";
import { getTracts } from "@/lib/data";
import { errorResponse } from "@/lib/lookup";
import { getViewer } from "@/lib/viewer";

// GET /api/tracts — scores and the map are public for every plan.
export async function GET(req: Request) {
  try {
    const plan = getPlan(await getViewer(req));
    const tracts = await getTracts();
    return Response.json(tracts, {
      headers: {
        "cache-control": plan.kind === "anonymous" ? "public, max-age=60" : "private, no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
