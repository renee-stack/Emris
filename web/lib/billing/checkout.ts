import type { AdminClient } from "@/lib/supabase/admin";
import { BillingError } from "@/lib/billing/errors";
import {
  canBuyFounding,
  canStartSubscription,
  foundingDeniedMessage,
  parseCheckoutBody,
  trialDaysFor,
} from "@/lib/billing/rules";
import {
  countActiveFounding,
  hasEntitlement,
  saveCustomerId,
  snapshotFromRow,
  type UserRow,
} from "@/lib/billing/store";
import { reportTypeFor, TEAM_MAX_SEATS, TEAM_MIN_SEATS, isReportPlan } from "@/lib/pricing";
import { ensureCustomer, ensurePrice, ensurePortalConfiguration, requireStripe } from "@/lib/billing/stripe";

export async function startCheckout(args: {
  admin: AdminClient;
  user: UserRow;
  origin: string;
  body: unknown;
}): Promise<string> {
  const parsed = parseCheckoutBody(args.body);
  if ("error" in parsed) throw new BillingError(parsed.error, 400, "bad_request");

  const now = new Date();
  const snapshot = snapshotFromRow(args.user);
  if (!isReportPlan(parsed.plan) && !canStartSubscription(snapshot, now)) {
    throw new BillingError("Manage this change in the billing portal.", 409, "already_subscribed");
  }

  if (parsed.plan === "founding") {
    let active = 0;
    try {
      active = await countActiveFounding(args.admin);
    } catch (error) {
      console.error(error);
      throw new BillingError("Couldn't check founding spots.", 500, "internal");
    }
    if (!canBuyFounding(active, args.user.founding_member)) {
      throw new BillingError(foundingDeniedMessage(), 409, "founding_full");
    }
  }

  if (isReportPlan(parsed.plan) && parsed.targetId) {
    const owned = await hasEntitlement(
      args.admin,
      args.user.id,
      reportTypeFor(parsed.plan),
      parsed.targetId,
    );
    if (owned) throw new BillingError("You already own this report.", 409, "already_entitled");
  }

  const stripe = requireStripe();
  const customerId = await ensureCustomer(stripe, args.user);
  if (customerId !== args.user.stripe_customer_id) {
    await saveCustomerId(args.admin, args.user.id, customerId);
  }
  const price = await ensurePrice(stripe, parsed.plan, parsed.interval);
  const metadata: Record<string, string> = {
    user_id: args.user.id,
    plan: parsed.plan,
  };
  if (parsed.interval) metadata.interval = parsed.interval;
  if (parsed.targetId) metadata.target_id = parsed.targetId;
  if (isReportPlan(parsed.plan)) metadata.report_type = reportTypeFor(parsed.plan);

  const success = `${args.origin}/account/billing?checkout=success`;
  const cancel = `${args.origin}/pricing`;

  if (isReportPlan(parsed.plan)) {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      client_reference_id: args.user.id,
      line_items: [{ price: price.priceId, quantity: 1 }],
      metadata,
      success_url: success,
      cancel_url: cancel,
    });
    if (!session.url) throw new BillingError("Checkout didn't return a URL.", 500, "internal");
    return session.url;
  }

  const quantity = parsed.plan === "team" ? (parsed.quantity ?? TEAM_MIN_SEATS) : 1;
  const trial = trialDaysFor(parsed.plan, args.user.trial_used);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: args.user.id,
    line_items: [
      {
        price: price.priceId,
        quantity,
        ...(parsed.plan === "team"
          ? { adjustable_quantity: { enabled: true, minimum: TEAM_MIN_SEATS, maximum: TEAM_MAX_SEATS } }
          : {}),
      },
    ],
    metadata,
    subscription_data: {
      metadata,
      ...(trial ? { trial_period_days: trial } : {}),
    },
    success_url: success,
    cancel_url: cancel,
  });
  if (!session.url) throw new BillingError("Checkout didn't return a URL.", 500, "internal");
  return session.url;
}

export async function startPortal(args: {
  admin: AdminClient;
  user: UserRow;
  origin: string;
  flow: "billing" | "seats";
}): Promise<string> {
  if (!args.user.stripe_customer_id) {
    throw new BillingError("Add a plan before managing billing.", 400, "bad_request");
  }
  const stripe = requireStripe();
  let customerId = args.user.stripe_customer_id;
  try {
    const existing = await stripe.customers.retrieve(customerId);
    if ("deleted" in existing && existing.deleted) customerId = "";
  } catch {
    customerId = "";
  }
  if (!customerId) throw new BillingError("Add a plan before managing billing.", 400, "bad_request");

  const configuration = await ensurePortalConfiguration(stripe);
  const returnUrl = args.flow === "seats" ? `${args.origin}/account/team` : `${args.origin}/account/billing`;
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    configuration,
    return_url: returnUrl,
    ...(args.flow === "seats" && args.user.stripe_subscription_id
      ? {
          flow_data: {
            type: "subscription_update",
            subscription_update: { subscription: args.user.stripe_subscription_id },
          },
        }
      : {}),
  });
  return session.url;
}
