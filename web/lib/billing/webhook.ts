import type Stripe from "stripe";
import type { AdminClient } from "@/lib/supabase/admin";
import { nextBillingState } from "@/lib/billing/rules";
import {
  applySnapshot,
  findUser,
  insertEntitlement,
  snapshotFromRow,
  type UserRow,
} from "@/lib/billing/store";
import { isReportPlan, isSubscriptionPlan, reportTypeFor, type SubscriptionPlan } from "@/lib/pricing";
import { stripeId, subscriptionPlanFromPrice } from "@/lib/billing/stripe";

function customerIdOf(customer: string | Stripe.Customer | Stripe.DeletedCustomer | null): string | null {
  if (!customer || (typeof customer === "object" && "deleted" in customer && customer.deleted)) {
    return typeof customer === "string" ? customer : null;
  }
  return stripeId(customer);
}

async function loadUser(
  admin: AdminClient,
  stripe: Stripe,
  ids: { userId?: string | null; customerId?: string | null },
): Promise<UserRow | null> {
  const found = await findUser(admin, ids);
  if (found) return found;
  if (!ids.userId || !ids.customerId) return null;
  const customer = await stripe.customers.retrieve(ids.customerId);
  if ("deleted" in customer && customer.deleted) return null;
  const email = customer.email?.trim();
  if (!email) return null;
  const { error } = await admin.from("users").insert({ id: ids.userId, email });
  if (error && error.code !== "23505") throw new Error(error.message);
  return findUser(admin, { userId: ids.userId });
}

function readSubscription(sub: Stripe.Subscription): {
  plan: SubscriptionPlan | null;
  interval: "month" | "year" | null;
  quantity: number;
  periodEnd: string | null;
} {
  const item = sub.items.data[0];
  const price = item?.price;
  const parsed = subscriptionPlanFromPrice(price, sub.metadata.plan);
  const metadataPlan = isSubscriptionPlan(sub.metadata.plan ?? "") ? (sub.metadata.plan as SubscriptionPlan) : null;
  return {
    plan: parsed?.plan ?? metadataPlan,
    interval: parsed?.interval ?? (sub.metadata.interval === "year" ? "year" : sub.metadata.interval === "month" ? "month" : null),
    quantity: item?.quantity ?? 1,
    periodEnd: item?.current_period_end ? new Date(item.current_period_end * 1000).toISOString() : null,
  };
}

async function syncSubscription(
  admin: AdminClient,
  stripe: Stripe,
  sub: Stripe.Subscription,
  event: "subscription" | "payment_failed" | "invoice_paid" | "deleted",
): Promise<void> {
  const customerId = customerIdOf(sub.customer);
  const user = await loadUser(admin, stripe, { userId: sub.metadata.user_id, customerId });
  if (!user) throw new Error(`No Emris user for subscription ${sub.id}`);
  const details = readSubscription(sub);
  const now = new Date();
  const previous = snapshotFromRow(user);
  const next = nextBillingState({
    previous,
    event,
    stripeStatus: sub.status,
    stripePlan: details.plan,
    quantity: details.quantity,
    interval: details.interval,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    now,
  });
  const trialUsed =
    user.trial_used ||
    next.subscriptionStatus === "active" ||
    next.subscriptionStatus === "trialing" ||
    next.subscriptionStatus === "past_due";
  await applySnapshot(admin, user, next, {
    stripe_customer_id: customerId ?? user.stripe_customer_id,
    stripe_subscription_id: event === "deleted" ? user.stripe_subscription_id : sub.id,
    current_period_end: event === "deleted" ? null : details.periodEnd,
    trial_used: trialUsed,
  });
}

async function onCheckout(admin: AdminClient, stripe: Stripe, session: Stripe.Checkout.Session): Promise<void> {
  const userId = session.client_reference_id || session.metadata?.user_id || null;
  const customerId = stripeId(session.customer);
  const user = await loadUser(admin, stripe, { userId, customerId });
  if (!user) throw new Error(`No Emris user for checkout ${session.id}`);
  if (customerId && customerId !== user.stripe_customer_id) {
    const { error } = await admin.from("users").update({ stripe_customer_id: customerId }).eq("id", user.id);
    if (error) throw new Error(error.message);
  }

  if (session.mode === "payment") {
    if (session.payment_status !== "paid") return;
    const plan = session.metadata?.plan ?? "";
    const targetId = session.metadata?.target_id ?? "";
    if (!isReportPlan(plan) || !targetId) return;
    const paymentIntent = stripeId(session.payment_intent);
    await insertEntitlement(admin, {
      user_id: user.id,
      report_type: reportTypeFor(plan),
      target_id: targetId,
      stripe_session_id: session.id,
      stripe_payment_intent: paymentIntent,
      amount_total: session.amount_total,
      currency: session.currency,
    });
    return;
  }

  if (session.mode === "subscription") {
    const subscriptionId = stripeId(session.subscription);
    if (!subscriptionId) throw new Error(`Checkout ${session.id} has no subscription`);
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    if (!subscription.metadata.user_id) subscription.metadata.user_id = user.id;
    if (!subscription.metadata.plan && session.metadata?.plan) {
      subscription.metadata.plan = session.metadata.plan;
    }
    await syncSubscription(admin, stripe, subscription, "subscription");
  }
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const subscription = invoice.parent?.subscription_details?.subscription;
  return stripeId(subscription);
}

async function onInvoice(
  admin: AdminClient,
  stripe: Stripe,
  invoice: Stripe.Invoice,
  event: "invoice_paid" | "payment_failed",
): Promise<void> {
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return;
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  await syncSubscription(admin, stripe, subscription, event);
}

export async function dispatchStripeEvent(admin: AdminClient, stripe: Stripe, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await onCheckout(admin, stripe, event.data.object);
      return;
    case "customer.subscription.created":
    case "customer.subscription.updated":
      await syncSubscription(admin, stripe, event.data.object, "subscription");
      return;
    case "customer.subscription.deleted":
      await syncSubscription(admin, stripe, event.data.object, "deleted");
      return;
    case "invoice.paid":
      await onInvoice(admin, stripe, event.data.object, "invoice_paid");
      return;
    case "invoice.payment_failed":
      await onInvoice(admin, stripe, event.data.object, "payment_failed");
      return;
    default:
      return;
  }
}
