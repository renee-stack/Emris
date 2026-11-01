import { io } from "next/cache";
import type { NextRequest } from "next/server";
import { getDb } from "@/lib/billing/db";
import { gateTract } from "@/lib/billing/gate";
import { accessFor, identityFrom, jsonResponse, withCookies } from "@/lib/billing/identity";
import { getOwners } from "@/lib/billing/owners";
import { getPermits } from "@/lib/data";
import { errorResponse, tractDetail } from "@/lib/lookup";

// GET /api/tract/[geoid] — contract §2.2, trimmed to the caller's plan.
// Preview plans receive the real counts and the first row of each record list.
export async function GET(req: NextRequest, { params }: { params: Promise<{ geoid: string }> }) {
  await io();
  const db = getDb();
  const identity = identityFrom(db, req);
  try {
    const { geoid } = await params;
    const detail = await tractDetail(geoid);
    const [permits, owners] = await Promise.all([getPermits(), getOwners()]);
    const body = gateTract({
      tract: detail.tract,
      permits: permits.filter((permit) => permit.geoid === geoid),
      projects: detail.nearby_projects,
      owners: owners.filter((owner) => owner.geoid === geoid),
      access: accessFor(db, identity, geoid),
    });
    return jsonResponse(body, 200, identity.cookies);
  } catch (err) {
    return withCookies(errorResponse(err), identity.cookies);
  }
}
