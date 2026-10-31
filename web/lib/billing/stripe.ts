import Stripe from "stripe";
import { BillingError } from "@/lib/billing/http";
import {
  chargeCents,
  isSubscriptionPlan,
  lookupKey,
  planFromLookup,
  priceEnvName,
  productName,
  type Interval,
  type PurchasablePlan,
  type SubscriptionPlan,
} from "@/lib/pricing";

let client: Stripe | null = null;
const productIds = new Map<string, string>();

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  if (!client) client = new Stripe(key);
  return client;
}

export function requireStripe(): Stripe {
  const stripe = getStripe();
  if (!stripe) throw new BillingError("Billing isn't configured.", 500, "internal");
  return stripe;
}

export function stripeId(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "resource_missing"
  );
}

export async function ensureCustomer(
  stripe: Stripe,
  user: { id: string; email: string; stripe_customer_id: string | null },
): Promise<string> {
  if (user.stripe_customer_id) {
    try {
      const existing = await stripe.customers.retrieve(user.stripe_customer_id);
      if (!("deleted" in existing && existing.deleted)) return existing.id;
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  const created = await stripe.customers.create({
    email: user.email,
    metadata: { user_id: user.id },
  });
  return created.id;
}

async function ensureProduct(stripe: Stripe, plan: PurchasablePlan): Promise<string> {
  const cached = productIds.get(plan);
  if (cached) return cached;
  const listed = await stripe.products.list({ active: true, limit: 100 });
  const found = listed.data.find((product) => product.metadata.emris_plan === plan);
  if (found) {
    productIds.set(plan, found.id);
    return found.id;
  }
  const created = await stripe.products.create({
    name: productName(plan),
    metadata: { emris_plan: plan },
  });
  productIds.set(plan, created.id);
  return created.id;
}

export async function ensurePrice(
  stripe: Stripe,
  plan: PurchasablePlan,
  interval: Interval | null,
): Promise<{ priceId: string; productId: string }> {
  const key = lookupKey(plan, interval);
  const envName = priceEnvName(key);
  const fromEnv = envName ? process.env[envName]?.trim() : "";
  if (fromEnv) {
    const price = await stripe.prices.retrieve(fromEnv);
    const productId = stripeId(price.product);
    if (!productId) throw new BillingError("Billing isn't configured.", 500, "internal");
    return { priceId: price.id, productId };
  }

  const amount = chargeCents(plan, interval);
  const listed = await stripe.prices.list({ lookup_keys: [key], limit: 1 });
  const current = listed.data[0];
  if (
    current &&
    current.unit_amount === amount &&
    current.currency === "usd" &&
    current.active &&
    (interval ? current.recurring?.interval === interval : !current.recurring)
  ) {
    const productId = stripeId(current.product);
    if (!productId) throw new BillingError("Billing isn't configured.", 500, "internal");
    return { priceId: current.id, productId };
  }

  const productId = await ensureProduct(stripe, plan);
  const created = await stripe.prices.create({
    product: productId,
    unit_amount: amount,
    currency: "usd",
    lookup_key: key,
    transfer_lookup_key: true,
    ...(interval ? { recurring: { interval } } : {}),
    metadata: { emris_plan: plan, interval: interval ?? "once" },
  });
  if (current && current.id !== created.id) {
    await stripe.prices.update(current.id, { active: false });
  }
  return { priceId: created.id, productId };
}

const PORTAL_MARK = "emris-portal";

export async function ensurePortalConfiguration(stripe: Stripe): Promise<string> {
  const prices = await Promise.all([
    ensurePrice(stripe, "pro", "month"),
    ensurePrice(stripe, "pro", "year"),
    ensurePrice(stripe, "team", "month"),
    ensurePrice(stripe, "team", "year"),
  ]);
  const priceIds = prices.map((price) => price.priceId).join(",");
  const products = new Map<string, string[]>();
  for (const price of prices) {
    const list = products.get(price.productId) ?? [];
    list.push(price.priceId);
    products.set(price.productId, list);
  }

  const listed = await stripe.billingPortal.configurations.list({ active: true, limit: 20 });
  const match = listed.data.find(
    (config) => config.metadata?.emris === PORTAL_MARK && config.metadata.prices === priceIds,
  );
  if (match) return match.id;

  const created = await stripe.billingPortal.configurations.create({
    metadata: { emris: PORTAL_MARK, prices: priceIds },
    business_profile: { headline: "Manage your Emris plan, seats, and invoices." },
    features: {
      customer_update: { enabled: true, allowed_updates: ["email", "name", "address"] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: "at_period_end",
        cancellation_reason: {
          enabled: true,
          options: ["too_expensive", "missing_features", "switched_service", "unused", "other"],
        },
      },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["price", "quantity"],
        proration_behavior: "create_prorations",
        products: [...products.entries()].map(([product, ids]) => ({ product, prices: ids })),
      },
    },
  });
  return created.id;
}

export function subscriptionPlanFromPrice(
  price: Stripe.Price | null | undefined,
  metadataPlan: string | null | undefined,
): { plan: SubscriptionPlan; interval: Interval | null } | null {
  const parsed = price?.lookup_key ? planFromLookup(price.lookup_key) : null;
  if (parsed && isSubscriptionPlan(parsed.plan)) {
    return { plan: parsed.plan, interval: parsed.interval };
  }
  if (metadataPlan === "pro" || metadataPlan === "team" || metadataPlan === "founding") {
    const interval = price?.recurring?.interval === "year" ? "year" : "month";
    return { plan: metadataPlan, interval: metadataPlan === "founding" ? "month" : interval };
  }
  return null;
}
