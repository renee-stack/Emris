// Resolve the signed-in viewer. API routes pass that viewer into web/lib/access.ts.
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import {
  effectOfStripeEvent,
  isReportTarget,
  type AccessUser,
  type BillingEffect,
  type Entitlement,
  type StripeEvent,
  type Subscription,
  type SubscriptionPlan,
  type SubscriptionStatus,
} from "@/lib/access";
import { HttpError } from "@/lib/lookup";
import { supabaseEnv } from "@/lib/supabase/env";

const TEST_HEADER = "x-emris-user";
const FOUNDING_HEADER = "x-emris-founding-count";

const PLANS = new Set<SubscriptionPlan>(["pro", "founding", "team"]);
const STATUSES = new Set<SubscriptionStatus>([
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "incomplete",
]);

function service(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function cookieOptions(options: CookieOptions) {
  const sameSite =
    options.sameSite === true ? "strict" : options.sameSite === false ? "lax" : options.sameSite;
  return {
    domain: options.domain,
    expires: options.expires,
    httpOnly: options.httpOnly,
    maxAge: options.maxAge,
    path: options.path,
    sameSite,
    secure: options.secure,
    partitioned: options.partitioned,
  };
}

async function sessionUser(): Promise<{ id: string; email: string | null } | null> {
  const env = supabaseEnv();
  if (!env) return null;
  const cookieStore = await cookies();
  const client = createServerClient(env.url, env.key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, cookieOptions(options));
          });
        } catch {
          // Server Components cannot set cookies. The proxy refreshes the session.
        }
      },
    },
  });
  const { data } = await client.auth.getUser();
  if (!data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

function cleanSubscription(value: unknown): Subscription | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<Subscription>;
  if (!raw.plan || !PLANS.has(raw.plan) || !raw.status || !STATUSES.has(raw.status)) return null;
  const role = raw.role === "owner" || raw.role === "member" ? raw.role : null;
  return {
    plan: raw.plan,
    status: raw.status,
    role,
    payment_failed_at: raw.payment_failed_at ?? null,
    current_period_end: raw.current_period_end ?? null,
    seat_limit: typeof raw.seat_limit === "number" ? raw.seat_limit : null,
    stripe_customer_id: raw.stripe_customer_id ?? null,
    stripe_subscription_id: raw.stripe_subscription_id ?? null,
  };
}

function cleanEntitlements(value: unknown): Entitlement[] {
  if (!Array.isArray(value)) return [];
  const rows: Entitlement[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const report_type = (item as { report_type?: unknown }).report_type;
    const target_id = (item as { target_id?: unknown }).target_id;
    if (typeof report_type !== "string" || typeof target_id !== "string") continue;
    if (!isReportTarget(report_type, target_id)) continue;
    rows.push({ report_type, target_id });
  }
  return rows;
}

function cleanUser(value: unknown): AccessUser {
  if (!value || typeof value !== "object") throw new HttpError(400, "Invalid test user.");
  const raw = value as Partial<AccessUser>;
  if (typeof raw.id !== "string" || raw.id.trim().length === 0) throw new HttpError(400, "Invalid test user.");
  return {
    id: raw.id.trim(),
    email: typeof raw.email === "string" ? raw.email : null,
    entitlements: cleanEntitlements(raw.entitlements),
    subscription: cleanSubscription(raw.subscription),
    searches_used: Math.max(0, Number(raw.searches_used) || 0),
    alerts_used: Math.max(0, Number(raw.alerts_used) || 0),
    search_window_started_at: typeof raw.search_window_started_at === "string" ? raw.search_window_started_at : null,
    seats_used: raw.seats_used == null ? undefined : Math.max(0, Number(raw.seats_used) || 0),
  };
}

async function searchWindow(db: SupabaseClient, userId: string): Promise<{ count: number; oldest: string | null }> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { count, data, error } = await db
    .from("search_usage")
    .select("searched_at", { count: "exact" })
    .eq("user_id", userId)
    .gte("searched_at", since)
    .order("searched_at", { ascending: true })
    .limit(1);
  if (error) throw error;
  const row = data?.[0] as { searched_at?: string } | undefined;
  return { count: count ?? 0, oldest: row?.searched_at ?? null };
}

async function loadBilling(id: string, email: string | null): Promise<AccessUser> {
  const base: AccessUser = {
    id,
    email,
    entitlements: [],
    subscription: null,
    searches_used: 0,
    alerts_used: 0,
    search_window_started_at: null,
  };
  const db = service();
  if (!db) return base;
  try {
    const [{ data: sub }, { data: grants }, searches, alerts, { count: seats }] = await Promise.all([
      db.from("subscriptions").select("*").eq("user_id", id).maybeSingle(),
      db.from("entitlements").select("report_type, target_id").eq("user_id", id),
      searchWindow(db, id),
      db.from("watchlists").select("id", { count: "exact", head: true }).eq("user_id", id),
      db.from("team_members").select("member_user_id", { count: "exact", head: true }).eq("owner_user_id", id),
    ]);
    let subscription = cleanSubscription(sub);
    if (!subscription) {
      const { data: membership } = await db
        .from("team_members")
        .select("owner_user_id")
        .eq("member_user_id", id)
        .limit(1)
        .maybeSingle();
      const ownerId = membership && typeof membership.owner_user_id === "string" ? membership.owner_user_id : null;
      if (ownerId) {
        const { data: ownerSub } = await db.from("subscriptions").select("*").eq("user_id", ownerId).maybeSingle();
        const inherited = cleanSubscription(ownerSub);
        if (inherited?.plan === "team") subscription = { ...inherited, role: "member" };
      }
    }
    return {
      ...base,
      entitlements: cleanEntitlements(grants),
      subscription,
      searches_used: searches.count,
      search_window_started_at: searches.oldest,
      alerts_used: alerts.count ?? 0,
      seats_used: subscription?.plan === "team" && subscription.role !== "member" ? (seats ?? 0) + 1 : undefined,
    };
  } catch (err) {
    console.error("billing lookup failed", err);
    return base;
  }
}

/** The signed-in user, or null. The test header is ignored unless EMRIS_TEST_ACCESS=1. */
export async function getViewer(req: Request): Promise<AccessUser | null> {
  if (process.env.EMRIS_TEST_ACCESS === "1") {
    const raw = req.headers.get(TEST_HEADER);
    if (!raw || raw === "anonymous") return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new HttpError(400, "Invalid test user.");
    }
    return cleanUser(parsed);
  }
  const session = await sessionUser();
  if (!session) return null;
  return loadBilling(session.id, session.email);
}

/** Active founding subscriptions. The test header overrides the database. */
export async function foundingCount(req: Request): Promise<number> {
  if (process.env.EMRIS_TEST_ACCESS === "1") {
    const raw = req.headers.get(FOUNDING_HEADER);
    const n = raw == null ? 0 : Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
  const db = service();
  if (!db) return 0;
  const { count, error } = await db
    .from("subscriptions")
    .select("user_id", { count: "exact", head: true })
    .eq("plan", "founding")
    .in("status", ["trialing", "active", "past_due", "unpaid"]);
  if (error) throw error;
  return count ?? 0;
}

export async function recordSearch(user: AccessUser, query: string, placeId: string | null): Promise<void> {
  if (process.env.EMRIS_TEST_ACCESS === "1") return;
  const db = service();
  if (!db) return;
  const { error } = await db.from("search_usage").insert({ user_id: user.id, query, place_id: placeId });
  if (error) console.error("search_usage insert failed", error);
}

export async function recordAlert(user: AccessUser, areaId: string): Promise<void> {
  if (process.env.EMRIS_TEST_ACCESS === "1") return;
  const db = service();
  if (!db) return;
  const { error } = await db.from("watchlists").insert({ user_id: user.id, area_id: areaId });
  if (error && error.code !== "23505") throw error;
}

export async function persistBillingEffect(effect: BillingEffect): Promise<void> {
  const db = service();
  if (!db) return;
  if (effect.user_id) {
    const email = effect.email ?? `${effect.user_id}@users.invalid`;
    const { error } = await db.from("users").upsert({ id: effect.user_id, email }, { onConflict: "id" });
    if (error) throw error;
  }
  if (effect.entitlement && effect.user_id) {
    const row = effect.entitlement;
    const { error } = await db.from("entitlements").upsert(
      {
        user_id: effect.user_id,
        report_type: row.report_type,
        target_id: row.target_id,
        stripe_session_id: row.stripe_session_id,
        stripe_payment_intent: row.stripe_payment_intent,
        amount_total: row.amount_total,
        currency: row.currency,
      },
      { onConflict: "stripe_session_id", ignoreDuplicates: true },
    );
    if (error) throw error;
  }
  const patch = effect.subscription;
  if (!patch) return;
  if (effect.user_id && patch.plan && patch.status) {
    const { error } = await db.from("subscriptions").upsert(
      {
        user_id: effect.user_id,
        plan: patch.plan,
        status: patch.status,
        role: patch.role ?? "owner",
        stripe_customer_id: patch.stripe_customer_id ?? null,
        stripe_subscription_id: patch.stripe_subscription_id ?? effect.stripe_subscription_id,
        payment_failed_at: patch.payment_failed_at ?? null,
        current_period_end: patch.current_period_end ?? null,
        seat_limit: patch.seat_limit ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) throw error;
    return;
  }
  const subscriptionId = effect.stripe_subscription_id ?? patch.stripe_subscription_id;
  if (!subscriptionId) return;
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status) update.status = patch.status;
  if (patch.plan) update.plan = patch.plan;
  if (patch.current_period_end !== undefined) update.current_period_end = patch.current_period_end;
  if (patch.stripe_customer_id) update.stripe_customer_id = patch.stripe_customer_id;
  if (patch.payment_failed_at === null) update.payment_failed_at = null;
  const { error } = await db.from("subscriptions").update(update).eq("stripe_subscription_id", subscriptionId);
  if (error) throw error;
  if (patch.payment_failed_at) {
    const { error: stamp } = await db
      .from("subscriptions")
      .update({ payment_failed_at: patch.payment_failed_at, status: "past_due" })
      .eq("stripe_subscription_id", subscriptionId)
      .is("payment_failed_at", null);
    if (stamp) throw stamp;
  }
}

export function billingEffect(event: StripeEvent): BillingEffect | null {
  return effectOfStripeEvent(event);
}
