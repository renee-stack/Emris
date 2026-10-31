import type { NextRequest } from "next/server";
import { assertFreeSearch, assertIp, requireUser } from "@/lib/auth/guard";
import type { NearResponse } from "@/lib/data";
import { HttpError, clampRadius, errorResponse, near, privateJson } from "@/lib/lookup";

const HOUR = 60 * 60 * 1000;

// GET /api/near?q=<text>&radius_mi=0.25 — signed-in only. Free plan: 3 searches a week.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  try {
    assertIp("near:ip", 60, HOUR, req);
    const user = await requireUser();
    assertFreeSearch(user);
    const q = params.get("q")?.trim() ?? "";
    if (!q) throw new HttpError(400, "q is required");
    const radius = clampRadius(params.get("radius_mi"));
    const { place, tract, permits, projects } = await near(q, radius);
    const body: NearResponse = { place, tract, permits, projects };
    return privateJson(body);
  } catch (err) {
    return errorResponse(err);
  }
}
