import { io } from "next/cache";
import type Stripe from "stripe";
import { applyCompletedCheckout, applySubscription } from "@/lib/billing/apply";
import { getDb } from "@/lib/billing/db";
import { BillingError } from "@/lib/billing/errors";
import { jsonResponse } from "@/lib/billing/identity";
import { checkoutFromSession, getStripe, loadSubscription, subscriptionSnapshot, webhookSecret } from "@/lib/billing/stripe";
import { getUserByCustomer, getUserBySubscription } from "@/lib/billing/store";
import { errorResponse } from "@/lib/lookup";

function customerId(customer: string | Stripe.Customer | Stripe.DeletedCustomer | null): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

export async function POST(req: Request) {
  await io();
  const db = getDb();
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!signature) return jsonResponse({ error: "Missing signature." }, 400);
  try {
    const event = getStripe().webhooks.constructEvent(body, signature, webhookSecret());
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const subscription = await loadSubscription(session);
      applyCompletedCheckout(db, checkoutFromSession(session, subscription));
    } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      const customer = customerId(subscription.customer);
      const user = getUserBySubscription(db, subscription.id) ?? (customer ? getUserByCustomer(db, customer) : null);
      if (user) applySubscription(db, user, subscriptionSnapshot(subscription, customer));
    }
    return jsonResponse({ received: true });
  } catch (err) {
    if (err instanceof BillingError) return jsonResponse({ error: err.message, code: err.code }, err.status);
    if (err instanceof Error && /signature/i.test(err.message)) {
      return jsonResponse({ error: "Invalid signature." }, 400);
    }
    return errorResponse(err);
  }
}
