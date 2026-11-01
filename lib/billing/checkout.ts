import type Stripe from "stripe";
import { PRO_MONTHLY_USD, REPORT_USD, TRIAL_DAYS } from "./pure";

export function proLineItem(priceId: string | undefined): Stripe.Checkout.SessionCreateParams.LineItem {
  if (priceId) return { price: priceId, quantity: 1 };
  return {
    quantity: 1,
    price_data: {
      currency: "usd",
      unit_amount: PRO_MONTHLY_USD * 100,
      recurring: { interval: "month" },
      product_data: { name: "Emris Pro" },
    },
  };
}

export function reportLineItem(priceId: string | undefined, geoid: string): Stripe.Checkout.SessionCreateParams.LineItem {
  if (priceId) return { price: priceId, quantity: 1 };
  return {
    quantity: 1,
    price_data: {
      currency: "usd",
      unit_amount: REPORT_USD * 100,
      product_data: {
        name: "Emris tract report",
        description: `Census tract ${geoid}`,
      },
    },
  };
}

export function buildProCheckoutParams(input: {
  email: string;
  userId: string;
  customerId: string | null;
  trial: boolean;
  origin: string;
  surface: string;
  priceId?: string;
}): Stripe.Checkout.SessionCreateParams {
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    client_reference_id: input.userId,
    payment_method_collection: "always",
    line_items: [proLineItem(input.priceId)],
    subscription_data: {
      metadata: { user_id: input.userId },
      trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
      ...(input.trial ? { trial_period_days: TRIAL_DAYS } : {}),
    },
    metadata: { user_id: input.userId, intent: "pro", surface: input.surface },
    success_url: `${input.origin}/welcome?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.origin}/upgrade?intent=pro&surface=${encodeURIComponent(input.surface)}&canceled=1`,
  };
  if (input.customerId) params.customer = input.customerId;
  else params.customer_email = input.email;
  return params;
}

export function buildReportCheckoutParams(input: {
  email: string;
  userId: string;
  customerId: string | null;
  geoid: string;
  origin: string;
  surface: string;
  priceId?: string;
}): Stripe.Checkout.SessionCreateParams {
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    client_reference_id: input.userId,
    line_items: [reportLineItem(input.priceId, input.geoid)],
    metadata: { user_id: input.userId, intent: "report", geoid: input.geoid, surface: input.surface },
    success_url: `${input.origin}/welcome?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.origin}/upgrade?intent=report&geoid=${input.geoid}&surface=${encodeURIComponent(input.surface)}&canceled=1`,
  };
  if (input.customerId) params.customer = input.customerId;
  else params.customer_email = input.email;
  return params;
}
