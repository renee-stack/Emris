import type { NextRequest } from "next/server";
import type { NearResponse } from "@/lib/data";
import { HttpError, clampRadius, errorResponse, near } from "@/lib/lookup";

// GET /api/near?q=<text>&radius_mi=0.25 — contract §2.3.
export async function GET(req: NextRequest) {
  // Read params outside try so Next's dynamic-rendering signal isn't caught and logged as an error.
  const params = req.nextUrl.searchParams;
  try {
    const q = params.get("q")?.trim() ?? "";
    if (!q) throw new HttpError(400, "q is required");
    const radius = clampRadius(params.get("radius_mi"));
    const { place, tract, permits, projects } = await near(q, radius);
    const body: NearResponse = { place, tract, permits, projects };
    return Response.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
