/**
 * Create or update Emris Stripe test prices. Amounts come only from lib/pricing.ts.
 * Products are matched by metadata emris_key. Prices are matched by lookup_key.
 * Run from the repo root: npm run stripe:setup
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pricing, stripeCatalog } from "../lib/pricing.ts";

const START = "// stripe-price-ids:start\n";
const END = "// stripe-price-ids:end";
const PRICE_ID = /^price_[A-Za-z0-9]+$/;

type Fields = Record<string, string | number>;

type StripeProduct = {
  id: string;
  name: string;
  active: boolean;
  metadata: Record<string, string>;
};

type StripePrice = {
  id: string;
  active: boolean;
  currency: string;
  unit_amount: number | null;
  nickname: string | null;
  product: string | { id: string };
  recurring: { interval: string; interval_count?: number } | null;
  metadata: Record<string, string>;
};

type StripeList<T> = { data: T[]; has_more: boolean };

function redact(message: string, secret: string): string {
  const hidden = secret ? message.split(secret).join("[redacted]") : message;
  return hidden.replace(/\b(?:sk|rk)_(?:test|live)_[A-Za-z0-9]+/g, "[redacted]");
}

function readStripeKey(): string {
  let value = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (!value) {
    const file = path.join(process.cwd(), ".env");
    if (existsSync(file)) {
      for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq < 0) continue;
        if (trimmed.slice(0, eq).trim() !== "STRIPE_SECRET_KEY") continue;
        value = trimmed.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
      }
    }
  }
  if (!value) {
    console.error("STRIPE_SECRET_KEY is not set. Add it to .env or the environment, then run npm run stripe:setup.");
    process.exit(1);
  }
  if (!value.startsWith("sk_test_") && !value.startsWith("rk_test_")) {
    console.error("STRIPE_SECRET_KEY must be a Stripe test key.");
    process.exit(1);
  }
  return value;
}

async function stripeRequest<T>(secret: string, method: "GET" | "POST", apiPath: string, fields?: Fields, idempotencyKey?: string): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${secret}` };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  let body: string | undefined;
  if (fields) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    const params = new URLSearchParams();
    for (const [key, field] of Object.entries(fields)) params.append(key, String(field));
    body = params.toString();
  }
  let response: Response;
  try {
    response = await fetch(`https://api.stripe.com${apiPath}`, {
      method,
      headers,
      body,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Stripe request failed.";
    throw new Error(redact(message, secret));
  }
  const text = await response.text();
  if (!response.ok) {
    let message = `Stripe request failed (${response.status}).`;
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } };
      if (parsed.error?.message) message = parsed.error.message;
    } catch {
      // Keep the status message. The raw body can echo request details.
    }
    throw new Error(redact(message, secret));
  }
  return JSON.parse(text) as T;
}

async function listProducts(secret: string, active: "true" | "false"): Promise<StripeProduct[]> {
  const products: StripeProduct[] = [];
  let startingAfter = "";
  for (let page = 0; page < 50; page += 1) {
    const query = new URLSearchParams({ limit: "100", active });
    if (startingAfter) query.set("starting_after", startingAfter);
    const listed = await stripeRequest<StripeList<StripeProduct>>(secret, "GET", `/v1/products?${query}`);
    products.push(...listed.data);
    if (!listed.has_more || listed.data.length === 0) return products;
    startingAfter = listed.data[listed.data.length - 1]?.id ?? "";
    if (!startingAfter) return products;
  }
  throw new Error("Stripe returned too many products to scan.");
}

function rememberProduct(products: Map<string, StripeProduct>, product: StripeProduct) {
  const marker = product.metadata?.emris_key;
  if (!marker) return;
  const current = products.get(marker);
  if (!current || (!current.active && product.active)) products.set(marker, product);
}

async function ensureProduct(
  secret: string,
  productKey: string,
  name: string,
  products: Map<string, StripeProduct>,
): Promise<{ id: string; action: "created" | "updated" | "unchanged" }> {
  let product = products.get(productKey);
  let action: "created" | "updated" | "unchanged" = "unchanged";
  if (!product) {
    product = await stripeRequest<StripeProduct>(
      secret,
      "POST",
      "/v1/products",
      { name, "metadata[emris_key]": productKey },
      `emris-product-${productKey}`,
    );
    action = "created";
  } else if (product.name !== name || !product.active) {
    product = await stripeRequest<StripeProduct>(secret, "POST", `/v1/products/${product.id}`, {
      name,
      active: "true",
    });
    action = "updated";
  }
  products.set(productKey, product);
  return { id: product.id, action };
}

function productIdOf(price: StripePrice): string {
  return typeof price.product === "string" ? price.product : price.product.id;
}

function sameCharge(price: StripePrice, unitAmount: number, interval: "month" | "year" | null): boolean {
  if (price.currency.toLowerCase() !== pricing.currency) return false;
  if (price.unit_amount !== unitAmount) return false;
  const current = price.recurring?.interval ?? null;
  if (current !== interval) return false;
  if (price.recurring && price.recurring.interval_count && price.recurring.interval_count !== 1) return false;
  return true;
}

function metadataFields(metadata: Readonly<Record<string, string>>, current: Record<string, string>): Fields {
  const fields: Fields = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (current[key] !== value) fields[`metadata[${key}]`] = value;
  }
  return fields;
}

async function ensurePrice(
  secret: string,
  item: (typeof stripeCatalog)[number],
  productId: string,
): Promise<{ id: string; action: "created" | "replaced" | "updated" | "unchanged" }> {
  const listed = await stripeRequest<StripeList<StripePrice>>(
    secret,
    "GET",
    `/v1/prices?${new URLSearchParams({ "lookup_keys[]": item.lookupKey, limit: "1" })}`,
  );
  const existing = listed.data[0];
  if (
    existing &&
    productIdOf(existing) === productId &&
    sameCharge(existing, item.unitAmount, item.interval)
  ) {
    const fields: Fields = {
      ...metadataFields(item.metadata, existing.metadata ?? {}),
    };
    if (existing.nickname !== item.nickname) fields.nickname = item.nickname;
    if (!existing.active) fields.active = "true";
    if (Object.keys(fields).length === 0) return { id: existing.id, action: "unchanged" };
    const updated = await stripeRequest<StripePrice>(secret, "POST", `/v1/prices/${existing.id}`, fields);
    return { id: updated.id, action: "updated" };
  }

  const fields: Fields = {
    product: productId,
    currency: pricing.currency,
    unit_amount: item.unitAmount,
    lookup_key: item.lookupKey,
    nickname: item.nickname,
    ...metadataFields(item.metadata, {}),
  };
  if (item.interval) fields["recurring[interval]"] = item.interval;
  if (existing) fields.transfer_lookup_key = "true";
  const created = await stripeRequest<StripePrice>(
    secret,
    "POST",
    "/v1/prices",
    fields,
    `emris-price-${item.lookupKey}-${item.unitAmount}-${item.interval ?? "once"}`,
  );
  if (!PRICE_ID.test(created.id)) throw new Error(`Stripe returned an unexpected price id for ${item.lookupKey}.`);
  return { id: created.id, action: existing ? "replaced" : "created" };
}

function writePriceIds(ids: Record<string, string>) {
  const file = path.join(process.cwd(), "lib/pricing.ts");
  const source = readFileSync(file, "utf8");
  const startAt = source.indexOf(START);
  const endAt = source.indexOf(END);
  if (startAt < 0 || endAt < startAt) {
    throw new Error("lib/pricing.ts is missing the stripe-price-ids markers.");
  }
  const lines = stripeCatalog.map((item) => {
    const id = ids[item.lookupKey];
    if (!id || !PRICE_ID.test(id)) throw new Error(`Refusing to record an unexpected price id for ${item.lookupKey}.`);
    return `  ${item.lookupKey}: "${id}",`;
  });
  const block = `${START}export const stripePriceIds: Record<StripeLookupKey, string> = {\n${lines.join("\n")}\n};\n`;
  const updated = source.slice(0, startAt) + block + source.slice(endAt);
  if (/(?:sk|rk)_(?:test|live)_/.test(updated)) {
    throw new Error("Refusing to write lib/pricing.ts because a Stripe secret would be included.");
  }
  if (updated === source) {
    console.log("Price ids in lib/pricing.ts already match.");
    return;
  }
  writeFileSync(file, updated);
  console.log("Updated price ids in lib/pricing.ts.");
}

async function main() {
  if (!existsSync(path.join(process.cwd(), "lib/pricing.ts"))) {
    console.error("Run npm run stripe:setup from the Emris repository root.");
    process.exit(1);
  }
  if (pricing.plans.free.monthlyCents !== 0) {
    throw new Error("Free must stay at $0 with no Stripe price.");
  }
  const enterprise = pricing.plans.enterprise;
  if (enterprise.monthlyCents !== null || enterprise.annualCents !== null || enterprise.oneTimeCents !== null) {
    throw new Error("Enterprise must not have a Stripe price.");
  }
  for (const item of stripeCatalog) {
    if (item.unitAmount <= 0) throw new Error(`${item.lookupKey} is not a chargeable Stripe price.`);
  }

  console.log("Free: no Stripe price");
  console.log("Enterprise: no Stripe price");

  const secret = readStripeKey();
  const products = new Map<string, StripeProduct>();
  for (const active of ["true", "false"] as const) {
    for (const product of await listProducts(secret, active)) rememberProduct(products, product);
  }

  const ids: Record<string, string> = {};
  const seenProducts = new Set<string>();
  for (const item of stripeCatalog) {
    const product = await ensureProduct(secret, item.productKey, item.productName, products);
    if (!seenProducts.has(item.productKey)) {
      console.log(`${item.productName}: product ${product.action}`);
      seenProducts.add(item.productKey);
    }
    const price = await ensurePrice(secret, item, product.id);
    ids[item.lookupKey] = price.id;
    console.log(`${item.lookupKey}: price ${price.action}`);
  }
  writePriceIds(ids);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : "Stripe setup failed.";
  console.error(redact(message, ""));
  process.exit(1);
});
