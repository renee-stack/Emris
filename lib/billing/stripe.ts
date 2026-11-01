import Stripe from "stripe";
import type { CompletedCheckout, SubscriptionSnapshot } from "./apply";
import { BillingError } from "./errors";

let client: Stripe | null = null;

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error("STRIPE_SECRET_KEY is not set");
    throw new BillingError(503, "billing_not_configured", "Checkout is not available right now.");
  }
  return (client ??= new Stripe(key));
}

export function webhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("STRIPE_WEBHOOK_SECRET is not set");
    throw new BillingError(503, "billing_not_configured", "Checkout is not available right now.");
  }
  return secret;
}

function customerId(customer: string | Stripe.Customer | Stripe.DeletedCustomer | null): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

export function subscriptionSnapshot(sub: Stripe.Subscription, fallbackCustomer: string | null): SubscriptionSnapshot {
  return {
    id: sub.id,
    status: sub.status,
    trialEnd: sub.trial_end,
    customerId: customerId(sub.customer) ?? fallbackCustomer,
  };
}

export function checkoutFromSession(session: Stripe.Checkout.Session, subscription: Stripe.Subscription | null): CompletedCheckout {
  const metadata = session.metadata ?? {};
  const customer = customerId(session.customer);
  return {
    id: session.id,
    mode: session.mode ?? "payment",
    status: session.status,
    paymentStatus: session.payment_status,
    customerId: customer,
    userId: metadata.user_id ?? session.client_reference_id ?? null,
    intent: metadata.intent ?? null,
    geoid: metadata.geoid ?? null,
    subscription: subscription ? subscriptionSnapshot(subscription, customer) : null,
  };
}

export async function loadSubscription(session: Stripe.Checkout.Session): Promise<Stripe.Subscription | null> {
  if (!session.subscription) return null;
  if (typeof session.subscription !== "string") return session.subscription;
  return getStripe().subscriptions.retrieve(session.subscription);
}
