import type { NextRequest } from "next/server";
import type { NearResponse } from "@/lib/data";
import { paidPlan, requestUser } from "@/lib/auth/session";
import { HttpError, clampRadius, errorResponse, near } from "@/lib/lookup";
import { pricing } from "@/lib/pricing";
import { allow, retryAt } from "@/lib/ratelimit";

const WINDOW_MS = pricing.limits.searchWindowDays * 24 * 60 * 60 * 1000;

// GET /api/near?q=<text>&radius_mi=0.25 — contract §2.3.
export async function GET(req: NextRequest) {
  // Read params outside try so Next's dynamic-rendering signal isn't caught and logged as an error.
  const params = req.nextUrl.searchParams;
  try {
    const user = await requestUser();
    if (!user) throw new HttpError(401, "Sign in to search.");
    if (!(await paidPlan(user.id))) {
      const key = `near:${user.id}`;
      if (!allow(key, pricing.limits.freeSearches, WINDOW_MS)) {
        const resets = new Date(retryAt(key) ?? Date.now() + WINDOW_MS).toISOString().slice(0, 10);
        throw new HttpError(
          429,
          `You've used your ${pricing.limits.freeSearches} free searches. Resets ${resets}.`,
        );
      }
    }
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
