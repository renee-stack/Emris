import { io } from "next/cache";
import type { NextRequest } from "next/server";
import { getDb } from "@/lib/billing/db";
import { BillingError } from "@/lib/billing/errors";
import { identityFrom, jsonResponse, withCookies } from "@/lib/billing/identity";
import { GEOID_RE, PAYWALL_SURFACES, type PaywallSurface } from "@/lib/billing/pure";
import { markOnboarding, recordEvent } from "@/lib/billing/store";
import { errorResponse } from "@/lib/lookup";

function isSurface(value: unknown): value is PaywallSurface {
  return typeof value === "string" && (PAYWALL_SURFACES as readonly string[]).includes(value);
}

export async function POST(req: NextRequest) {
  await io();
  const db = getDb();
  const identity = identityFrom(db, req);
  try {
    let body: { name?: unknown; surface?: unknown; geoid?: unknown };
    try {
      body = (await req.json()) as { name?: unknown; surface?: unknown; geoid?: unknown };
    } catch {
      throw new BillingError(400, "bad_request", "Body must be JSON.");
    }
    if (body.name === "paywall_view") {
      if (!isSurface(body.surface)) throw new BillingError(400, "bad_request", "Unknown paywall.");
      const geoid = typeof body.geoid === "string" && GEOID_RE.test(body.geoid) ? body.geoid : undefined;
      recordEvent(db, {
        name: "paywall_view",
        userId: identity.user?.id,
        anonymousId: identity.anonymousId,
        properties: geoid ? { surface: body.surface, geoid } : { surface: body.surface },
      });
      return jsonResponse({ ok: true }, 200, identity.cookies);
    }
    if (body.name === "onboarding_complete") {
      if (!identity.user) throw new BillingError(401, "unauthorized", "Sign in to finish setup.");
      markOnboarding(db, identity.user.id);
      return jsonResponse({ ok: true }, 200, identity.cookies);
    }
    throw new BillingError(400, "bad_request", "Unknown event.");
  } catch (err) {
    if (err instanceof BillingError) return withCookies(jsonResponse({ error: err.message, code: err.code }, err.status), identity.cookies);
    return withCookies(errorResponse(err), identity.cookies);
  }
}
