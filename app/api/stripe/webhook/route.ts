import { connection } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { jsonError } from "@/lib/billing/http";
import { claimStripeEvent, releaseStripeEvent } from "@/lib/billing/store";
import { getStripe } from "@/lib/billing/stripe";
import { dispatchStripeEvent } from "@/lib/billing/webhook";

export async function POST(request: Request) {
  await connection();
  const signature = request.headers.get("stripe-signature");
  if (!signature) return jsonError(400, "Missing Stripe signature.", "bad_request");

  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!stripe || !secret) return jsonError(500, "Billing isn't configured.", "internal");

  const payload = await request.text();
  let event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, secret);
  } catch {
    return jsonError(400, "Invalid Stripe signature.", "bad_request");
  }

  const admin = adminClient();
  if (!admin) return jsonError(500, "Billing isn't configured.", "internal");

  let claim: "new" | "duplicate";
  try {
    claim = await claimStripeEvent(admin, event.id, event.type);
  } catch (error) {
    console.error(error);
    return jsonError(500, "Couldn't record the Stripe event.", "internal");
  }
  if (claim === "duplicate") return Response.json({ received: true });

  try {
    await dispatchStripeEvent(admin, stripe, event);
  } catch (error) {
    console.error("stripe webhook", event.type, error);
    await releaseStripeEvent(admin, event.id);
    return jsonError(500, "Webhook handler failed.", "internal");
  }
  return Response.json({ received: true });
}
