import { io } from "next/cache";
import type { NextRequest } from "next/server";
import { getDb } from "@/lib/billing/db";
import { identityFrom, jsonResponse, withCookies } from "@/lib/billing/identity";
import { hasProAccess, searchLimitPayload } from "@/lib/billing/pure";
import { consumeSearch, recordEvent, subjectId } from "@/lib/billing/store";
import type { NearResponse } from "@/lib/data";
import { HttpError, clampRadius, errorResponse, near } from "@/lib/lookup";

// GET /api/near?q=<text>&radius_mi=0.25 — contract §2.3.
// Free plans get 3 successful searches a week. A blocked search returns no place, permits, or projects.
export async function GET(req: NextRequest) {
  await io();
  const params = req.nextUrl.searchParams;
  const db = getDb();
  const identity = identityFrom(db, req);
  try {
    const q = params.get("q")?.trim() ?? "";
    if (!q) throw new HttpError(400, "q is required");
    const radius = clampRadius(params.get("radius_mi"));
    const result = await near(q, radius);
    if (!hasProAccess(identity.user)) {
      const decision = consumeSearch(db, subjectId(identity.user, identity.anonymousId), q);
      if (!decision.ok) {
        recordEvent(db, {
          name: "search_limit_hit",
          userId: identity.user?.id,
          anonymousId: identity.anonymousId,
          properties: { source: "near" },
        });
        return jsonResponse(searchLimitPayload(q, decision.used, new Date(decision.resetsAt)), 402, identity.cookies);
      }
    }
    const body: NearResponse = {
      place: result.place,
      tract: result.tract,
      permits: result.permits,
      projects: result.projects,
    };
    return jsonResponse(body, 200, identity.cookies);
  } catch (err) {
    return withCookies(errorResponse(err), identity.cookies);
  }
}
