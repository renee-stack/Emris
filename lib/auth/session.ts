import { cookies } from "next/headers";
import { adminClient } from "@/lib/supabase/admin";
import { serverClient } from "@/lib/supabase/server";
import { hasPaidAccess, isGraceOpen, type BillingSnapshot, type SubscriptionStatus } from "@/lib/billing/rules";
import { pricing, type AccountPlan, type Interval } from "@/lib/pricing";

export interface SessionUser {
  id: string;
  email: string | null;
}

/** The signed-in user from the session cookie. Ignores any id sent by the browser. */
export async function requestUser(): Promise<SessionUser | null> {
  await cookies();
  const supabase = await serverClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

function asPlan(value: unknown): AccountPlan {
  return value === "pro" || value === "team" || value === "founding" ? value : "free";
}

function asStatus(value: unknown): SubscriptionStatus {
  if (
    value === "trialing" ||
    value === "active" ||
    value === "past_due" ||
    value === "canceled" ||
    value === "incomplete" ||
    value === "unpaid"
  ) {
    return value;
  }
  return "none";
}

function snapshotFromFields(data: {
  plan?: unknown;
  subscription_status?: unknown;
  founding_member?: unknown;
  seats?: unknown;
  grace_until?: unknown;
  billing_interval?: unknown;
  cancel_at_period_end?: unknown;
}): BillingSnapshot {
  const plan = asPlan(data.plan);
  return {
    plan,
    subscriptionStatus: asStatus(data.subscription_status),
    foundingMember: Boolean(data.founding_member),
    seats: typeof data.seats === "number" && data.seats >= 1 ? data.seats : 1,
    graceUntil: typeof data.grace_until === "string" ? data.grace_until : null,
    interval: data.billing_interval === "month" || data.billing_interval === "year" ? (data.billing_interval as Interval) : null,
    cancelAtPeriodEnd: Boolean(data.cancel_at_period_end),
  };
}

export async function accountPlan(userId: string): Promise<string> {
  const admin = adminClient();
  if (!admin) return pricing.plans.free.name;
  const { data, error } = await admin
    .from("users")
    .select("plan, founding_member, subscription_status, grace_until, seats, billing_interval, cancel_at_period_end")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return pricing.plans.free.name;
  const snapshot = snapshotFromFields(data);
  const now = new Date();
  if (!hasPaidAccess(snapshot, now) && snapshot.plan !== "free") {
    // Past-due after grace still shows Free; founding badge history stays on founding_member.
    if (snapshot.foundingMember && snapshot.plan === "founding") return pricing.plans.free.name;
  }
  if (hasPaidAccess(snapshot, now)) {
    if (snapshot.plan === "team") return pricing.plans.team.name;
    if (snapshot.plan === "founding" || snapshot.foundingMember) return pricing.plans.founding.name;
    if (snapshot.plan === "pro") return pricing.plans.pro.name;
  }
  // Fallback for older rows that only set plan without status columns.
  const plan = asPlan(data.plan);
  if (plan === "team") return pricing.plans.team.name;
  if (plan === "founding" || (plan === "pro" && data.founding_member === true)) return pricing.plans.founding.name;
  if (plan === "pro") return pricing.plans.pro.name;
  return pricing.plans.free.name;
}

async function ownerHasPaidAccess(ownerId: string): Promise<boolean> {
  const admin = adminClient();
  if (!admin) return false;
  const { data, error } = await admin
    .from("users")
    .select("plan, subscription_status, grace_until, founding_member, seats, billing_interval, cancel_at_period_end")
    .eq("id", ownerId)
    .maybeSingle();
  if (error || !data) return false;
  const snapshot = snapshotFromFields(data);
  return hasPaidAccess(snapshot, new Date()) && snapshot.plan === "team";
}

export async function paidPlan(userId: string): Promise<boolean> {
  const admin = adminClient();
  if (!admin) return false;
  const { data, error } = await admin
    .from("users")
    .select("plan, subscription_status, grace_until, founding_member, seats, billing_interval, cancel_at_period_end")
    .eq("id", userId)
    .maybeSingle();
  if (!error && data) {
    const snapshot = snapshotFromFields(data);
    if (hasPaidAccess(snapshot, new Date())) return true;
    // Older installs may only have plan set.
    if (
      (data.plan === "pro" || data.plan === "team" || data.plan === "founding") &&
      (!data.subscription_status || data.subscription_status === "none")
    ) {
      return true;
    }
    if (
      (data.subscription_status === "past_due" || data.subscription_status === "unpaid") &&
      isGraceOpen(typeof data.grace_until === "string" ? data.grace_until : null, new Date())
    ) {
      return true;
    }
  }

  const membership = await admin.from("team_members").select("team_id").eq("user_id", userId).maybeSingle();
  if (membership.error || !membership.data) return false;
  const team = await admin.from("teams").select("owner_id").eq("id", membership.data.team_id).maybeSingle();
  if (team.error || !team.data) return false;
  return ownerHasPaidAccess(team.data.owner_id as string);
}
