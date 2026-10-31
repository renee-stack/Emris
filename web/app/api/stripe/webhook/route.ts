import type { StripeEvent } from "@/lib/access";
import { verifyStripeSignature } from "@/lib/stripe-signature";
import { billingEffect, persistBillingEffect } from "@/lib/viewer";

// POST /api/stripe/webhook — signature checked, then the access module records the effect.
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
  if (!secret) {
    return Response.json({ error: "Stripe is not configured.", code: "internal" }, { status: 500 });
  }
  const raw = await req.text();
  if (!verifyStripeSignature(raw, req.headers.get("stripe-signature"), secret)) {
    return Response.json({ error: "Invalid signature.", code: "bad_request" }, { status: 400 });
  }
  let event: StripeEvent;
  try {
    event = JSON.parse(raw) as StripeEvent;
  } catch {
    return Response.json({ error: "Invalid payload.", code: "bad_request" }, { status: 400 });
  }
  try {
    const effect = billingEffect(event);
    if (effect) await persistBillingEffect(effect);
  } catch (err) {
    console.error(err);
    return Response.json({ error: "Could not record the event.", code: "internal" }, { status: 500 });
  }
  return Response.json({ received: true });
}
