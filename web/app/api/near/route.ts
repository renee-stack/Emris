import { connection, type NextRequest } from "next/server";
import type { NearResponse } from "@/lib/data";
import { searchDecision } from "@/lib/access";
import { HttpError, clampRadius, errorResponse, near } from "@/lib/lookup";
import { getViewer, recordSearch } from "@/lib/viewer";

// GET /api/near?q=<text>&radius_mi=0.25
export async function GET(req: NextRequest) {
  await connection();
  const params = req.nextUrl.searchParams;
  try {
    const q = params.get("q")?.trim() ?? "";
    if (!q) throw new HttpError(400, "q is required");
    const user = await getViewer(req);
    const decision = searchDecision(user);
    if (!decision.allowed) {
      if (decision.reason === "limit_reached") {
        throw new HttpError(429, "Search limit reached.", "limit_reached", { resets_at: decision.resets_at });
      }
      throw new HttpError(401, "Sign in to search.");
    }
    const radius = clampRadius(params.get("radius_mi"));
    const { place, tract, permits, projects } = await near(q, radius);
    if (user) await recordSearch(user, q, null);
    const body: NearResponse & { usage: typeof decision.usage } = {
      place,
      tract,
      permits,
      projects,
      usage: decision.usage,
    };
    return Response.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
