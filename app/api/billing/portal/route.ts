import { io } from "next/cache";
import type { NextRequest } from "next/server";
import { getDb } from "@/lib/billing/db";
import { BillingError } from "@/lib/billing/errors";
import { identityFrom, jsonResponse, withCookies } from "@/lib/billing/identity";
import { getStripe } from "@/lib/billing/stripe";
import { errorResponse } from "@/lib/lookup";

export async function POST(req: NextRequest) {
  await io();
  const db = getDb();
  const identity = identityFrom(db, req);
  try {
    if (!identity.user) throw new BillingError(401, "unauthorized", "Sign in to manage billing.");
    if (!identity.user.stripeCustomerId) {
      throw new BillingError(409, "no_billing", "Billing is available after checkout.");
    }
    let url: string | null;
    try {
      const portal = await getStripe().billingPortal.sessions.create({
        customer: identity.user.stripeCustomerId,
        return_url: `${req.nextUrl.origin}/account`,
      });
      url = portal.url;
    } catch (error) {
      if (error instanceof BillingError) throw error;
      console.error(error);
      throw new BillingError(502, "portal_failed", "The billing portal is not available right now.");
    }
    if (!url) throw new BillingError(502, "portal_failed", "The billing portal is not available right now.");
    return jsonResponse({ url }, 200, identity.cookies);
  } catch (err) {
    if (err instanceof BillingError) {
      return withCookies(jsonResponse({ error: err.message, code: err.code }, err.status), identity.cookies);
    }
    return withCookies(errorResponse(err), identity.cookies);
  }
}
