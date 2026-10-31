import type { NextRequest } from "next/server";
import type { NearResponse } from "@/lib/data";
import { HttpError, clampRadius, errorResponse, near } from "@/lib/lookup";

// GET /api/near?q=<text>&radius_mi=0.25 — contract §2.3.
export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
    if (!q) throw new HttpError(400, "q is required");
    const radius = clampRadius(req.nextUrl.searchParams.get("radius_mi"));
    const { place, tract, permits, projects } = await near(q, radius);
    const body: NearResponse = { place, tract, permits, projects };
    return Response.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
