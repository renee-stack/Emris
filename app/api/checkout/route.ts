import { io } from "next/cache";
import type { NextRequest } from "next/server";
import { applyCompletedCheckout } from "@/lib/billing/apply";
import { buildProCheckoutParams, buildReportCheckoutParams } from "@/lib/billing/checkout";
import { getDb } from "@/lib/billing/db";
import { BillingError, isUniqueConstraint } from "@/lib/billing/errors";
import { identityFrom, jsonResponse, sessionCookie, withCookies } from "@/lib/billing/identity";
import { GEOID_RE, formatChicagoDate, hasProAccess, normalizeEmail, trialAvailable } from "@/lib/billing/pure";
import { checkoutFromSession, getStripe, loadSubscription } from "@/lib/billing/stripe";
import { createSession, createUser, getUserByEmail, getUserById, hasReport, recordEvent } from "@/lib/billing/store";
import { allow, clientIp } from "@/lib/ratelimit";
import { errorResponse } from "@/lib/lookup";

function cleanSurface(value: unknown): string {
  const surface = typeof value === "string" ? value : "upgrade";
  return surface.replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || "upgrade";
}

function fail(err: unknown, cookies: Parameters<typeof withCookies>[1]) {
  if (err instanceof BillingError) {
    return withCookies(jsonResponse({ error: err.message, code: err.code }, err.status), cookies);
  }
  return withCookies(errorResponse(err), cookies);
}

export async function POST(req: NextRequest) {
  await io();
  const db = getDb();
  const identity = identityFrom(db, req);
  let issuedSession: string | null = null;
  try {
    if (!allow(`checkout:${clientIp(req)}`, 10, 60 * 60 * 1000)) {
      throw new BillingError(429, "rate_limit", "Too many checkout attempts. Try again in an hour.");
    }
    let body: { email?: unknown; intent?: unknown; geoid?: unknown; surface?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      throw new BillingError(400, "bad_request", "Body must be JSON.");
    }
    const email = typeof body.email === "string" ? normalizeEmail(body.email) : null;
    if (!email) throw new BillingError(400, "bad_request", "Enter a work email.");
    if (body.intent !== "pro" && body.intent !== "report") {
      throw new BillingError(400, "bad_request", "Choose Pro or a single report.");
    }
    const surface = cleanSurface(body.surface);
    const geoid = typeof body.geoid === "string" ? body.geoid : "";
    if (body.intent === "report" && !GEOID_RE.test(geoid)) {
      throw new BillingError(400, "bad_request", "Choose a tract to buy a single report.");
    }
    if (identity.user && identity.user.email !== email) {
      throw new BillingError(400, "bad_request", "Use the email on this account.");
    }

    let user = identity.user;
    if (!user) {
      const existing = getUserByEmail(db, email);
      if (existing) {
        throw new BillingError(
          409,
          "account_exists",
          "That email already has an account. Open Emris in the browser you used to sign up.",
        );
      }
      try {
        const created = createUser(db, email, identity.anonymousId);
        user = created.user;
        issuedSession = created.sessionId;
      } catch (error) {
        if (!isUniqueConstraint(error)) throw error;
        throw new BillingError(
          409,
          "account_exists",
          "That email already has an account. Open Emris in the browser you used to sign up.",
        );
      }
    }

    if (body.intent === "pro" && hasProAccess(user)) {
      throw new BillingError(409, "already_pro", "This account already has Pro.");
    }
    if (body.intent === "report" && hasReport(db, user.id, geoid)) {
      throw new BillingError(409, "already_unlocked", "This report is already on the account.");
    }

    const origin = req.nextUrl.origin;
    const trial = body.intent === "pro" && trialAvailable(user);
    const params =
      body.intent === "pro"
        ? buildProCheckoutParams({
            email: user.email,
            userId: user.id,
            customerId: user.stripeCustomerId,
            trial,
            origin,
            surface,
            priceId: process.env.STRIPE_PRO_PRICE_ID || undefined,
          })
        : buildReportCheckoutParams({
            email: user.email,
            userId: user.id,
            customerId: user.stripeCustomerId,
            geoid,
            origin,
            surface,
            priceId: process.env.STRIPE_REPORT_PRICE_ID || undefined,
          });

    let url: string | null;
    try {
      const session = await getStripe().checkout.sessions.create(params);
      url = session.url;
    } catch (error) {
      if (error instanceof BillingError) throw error;
      console.error(error);
      throw new BillingError(502, "checkout_failed", "Checkout is not available right now.");
    }
    if (!url) throw new BillingError(502, "checkout_failed", "Checkout is not available right now.");

    recordEvent(db, {
      name: "checkout_started",
      userId: user.id,
      anonymousId: identity.anonymousId,
      properties: { intent: body.intent, surface, geoid: body.intent === "report" ? geoid : undefined, trial },
    });

    const cookies = issuedSession ? [...identity.cookies, sessionCookie(issuedSession)] : identity.cookies;
    return jsonResponse({ url }, 200, cookies);
  } catch (err) {
    const cookies = issuedSession ? [...identity.cookies, sessionCookie(issuedSession)] : identity.cookies;
    return fail(err, cookies);
  }
}

export async function GET(req: NextRequest) {
  await io();
  const db = getDb();
  const identity = identityFrom(db, req);
  const sessionId = req.nextUrl.searchParams.get("session_id") ?? "";
  if (!sessionId.startsWith("cs_")) {
    return jsonResponse({ error: "Missing checkout session." }, 400, identity.cookies);
  }
  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });
    const subscription = await loadSubscription(session);
    const completed = checkoutFromSession(session, subscription);
    const result = applyCompletedCheckout(db, completed);
    const user = completed.userId ? getUserById(db, completed.userId) : null;
    const cookies = [...identity.cookies];
    if (result.applied && user && (!identity.user || identity.user.id !== user.id)) {
      cookies.push(sessionCookie(createSession(db, user.id)));
    }
    const trialEnds = user?.trialEndsAt ?? null;
    return jsonResponse(
      {
        ok: result.applied,
        intent: completed.intent,
        geoid: completed.geoid,
        trial_ends_at: trialEnds,
        trial_ends_label: trialEnds ? formatChicagoDate(new Date(trialEnds)) : null,
      },
      200,
      cookies,
    );
  } catch (err) {
    return fail(err, identity.cookies);
  }
}
