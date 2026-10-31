import type { User } from "@supabase/supabase-js";
import type { AdminClient } from "@/lib/supabase/admin";
import { BillingError } from "@/lib/billing/errors";
import {
  hasPaidAccess,
  inviteIsOpen,
  nextBillingState,
  seatRoom,
  type BillingSnapshot,
  type SubscriptionStatus,
} from "@/lib/billing/rules";
import type { AccountPlan, Interval } from "@/lib/pricing";

const USER_COLUMNS =
  "id, email, stripe_customer_id, stripe_subscription_id, plan, subscription_status, billing_interval, founding_member, seats, current_period_end, grace_until, trial_used, cancel_at_period_end";

export type UserRow = {
  id: string;
  email: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: AccountPlan;
  subscription_status: SubscriptionStatus;
  billing_interval: Interval | null;
  founding_member: boolean;
  seats: number;
  current_period_end: string | null;
  grace_until: string | null;
  trial_used: boolean;
  cancel_at_period_end: boolean;
};

const PLANS = new Set<AccountPlan>(["free", "pro", "team", "founding"]);
const STATUSES = new Set<SubscriptionStatus>([
  "none",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "incomplete",
  "unpaid",
]);

function asUserRow(value: unknown): UserRow {
  const row = value as UserRow;
  return {
    ...row,
    plan: PLANS.has(row.plan) ? row.plan : "free",
    subscription_status: STATUSES.has(row.subscription_status) ? row.subscription_status : "none",
    billing_interval: row.billing_interval === "year" || row.billing_interval === "month" ? row.billing_interval : null,
    founding_member: Boolean(row.founding_member),
    seats: Number.isInteger(row.seats) && row.seats >= 1 ? row.seats : 1,
    trial_used: Boolean(row.trial_used),
    cancel_at_period_end: Boolean(row.cancel_at_period_end),
  };
}

export function snapshotFromRow(row: UserRow): BillingSnapshot {
  return {
    plan: row.plan,
    subscriptionStatus: row.subscription_status,
    foundingMember: row.founding_member,
    seats: row.seats,
    graceUntil: row.grace_until,
    interval: row.billing_interval,
    cancelAtPeriodEnd: row.cancel_at_period_end,
  };
}

export async function findUser(
  admin: AdminClient,
  ids: { userId?: string | null; customerId?: string | null },
): Promise<UserRow | null> {
  if (ids.userId) {
    const { data, error } = await admin.from("users").select(USER_COLUMNS).eq("id", ids.userId).maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return asUserRow(data);
  }
  if (ids.customerId) {
    const { data, error } = await admin
      .from("users")
      .select(USER_COLUMNS)
      .eq("stripe_customer_id", ids.customerId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return asUserRow(data);
  }
  return null;
}

export async function ensureUser(admin: AdminClient, authUser: User): Promise<UserRow> {
  const email = authUser.email?.trim();
  if (!email) throw new BillingError("Your account needs an email before you can buy.", 400, "bad_request");
  const existing = await findUser(admin, { userId: authUser.id });
  if (!existing) {
    const { error } = await admin.from("users").insert({ id: authUser.id, email });
    if (error && error.code !== "23505") {
      throw new BillingError("Couldn't open a billing profile for this account.", 500, "internal");
    }
  }
  const row = await findUser(admin, { userId: authUser.id });
  if (!row) throw new BillingError("Couldn't load the billing profile.", 500, "internal");
  return enforceGrace(admin, row, new Date());
}

async function saveSnapshot(
  admin: AdminClient,
  userId: string,
  snapshot: BillingSnapshot,
  extra: {
    stripe_customer_id?: string | null;
    stripe_subscription_id?: string | null;
    current_period_end?: string | null;
    trial_used?: boolean;
  },
): Promise<void> {
  const { error } = await admin
    .from("users")
    .update({
      plan: snapshot.plan,
      subscription_status: snapshot.subscriptionStatus,
      billing_interval: snapshot.interval,
      founding_member: snapshot.foundingMember,
      seats: snapshot.seats,
      grace_until: snapshot.graceUntil,
      cancel_at_period_end: snapshot.cancelAtPeriodEnd,
      ...extra,
    })
    .eq("id", userId);
  if (error) throw new Error(error.message);
}

export async function enforceGrace(admin: AdminClient, row: UserRow, now: Date): Promise<UserRow> {
  const previous = snapshotFromRow(row);
  if (previous.plan === "free") return row;
  if (previous.subscriptionStatus !== "past_due" && previous.subscriptionStatus !== "unpaid") return row;
  if (hasPaidAccess(previous, now)) return row;
  const next = nextBillingState({
    previous,
    event: "payment_failed",
    stripePlan: previous.plan,
    now,
  });
  await saveSnapshot(admin, row.id, next, {});
  return {
    ...row,
    plan: next.plan,
    subscription_status: next.subscriptionStatus,
    billing_interval: next.interval,
    founding_member: next.foundingMember,
    seats: next.seats,
    grace_until: next.graceUntil,
    cancel_at_period_end: next.cancelAtPeriodEnd,
  };
}

export async function countActiveFounding(admin: AdminClient): Promise<number> {
  const now = new Date().toISOString();
  const active = await admin
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("founding_member", true)
    .eq("plan", "founding")
    .in("subscription_status", ["active", "trialing"]);
  if (active.error) throw new Error(active.error.message);
  const grace = await admin
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("founding_member", true)
    .eq("plan", "founding")
    .eq("subscription_status", "past_due")
    .gt("grace_until", now);
  if (grace.error) throw new Error(grace.error.message);
  return (active.count ?? 0) + (grace.count ?? 0);
}

export async function saveCustomerId(admin: AdminClient, userId: string, customerId: string): Promise<void> {
  const { error } = await admin.from("users").update({ stripe_customer_id: customerId }).eq("id", userId);
  if (error) throw new Error(error.message);
}

export async function applySnapshot(
  admin: AdminClient,
  row: UserRow,
  snapshot: BillingSnapshot,
  extra: {
    stripe_customer_id?: string | null;
    stripe_subscription_id?: string | null;
    current_period_end?: string | null;
    trial_used?: boolean;
  },
): Promise<void> {
  await saveSnapshot(admin, row.id, snapshot, extra);
  const access = hasPaidAccess(snapshot, new Date());
  if (snapshot.plan === "team" && access) await ensureTeam(admin, row.id);
}

export async function ensureTeam(admin: AdminClient, ownerId: string): Promise<string> {
  const existing = await admin.from("teams").select("id").eq("owner_id", ownerId).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  let teamId = existing.data?.id as string | undefined;
  if (!teamId) {
    const created = await admin.from("teams").insert({ owner_id: ownerId }).select("id").single();
    if (created.error) throw new Error(created.error.message);
    teamId = created.data.id as string;
  }
  await admin
    .from("team_members")
    .delete()
    .eq("user_id", ownerId)
    .neq("team_id", teamId);
  const member = await admin.from("team_members").upsert(
    { team_id: teamId, user_id: ownerId, role: "owner" },
    { onConflict: "team_id,user_id" },
  );
  if (member.error) throw new Error(member.error.message);
  return teamId;
}

export async function hasEntitlement(
  admin: AdminClient,
  userId: string,
  reportType: "area" | "property",
  targetId: string,
): Promise<boolean> {
  const { count, error } = await admin
    .from("entitlements")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("report_type", reportType)
    .eq("target_id", targetId);
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}

export async function insertEntitlement(
  admin: AdminClient,
  row: {
    user_id: string;
    report_type: "area" | "property";
    target_id: string;
    stripe_session_id: string;
    stripe_payment_intent: string | null;
    amount_total: number | null;
    currency: string | null;
  },
): Promise<void> {
  const { error } = await admin.from("entitlements").insert(row);
  if (error && error.code !== "23505") throw new Error(error.message);
}

export async function claimStripeEvent(admin: AdminClient, id: string, type: string): Promise<"new" | "duplicate"> {
  const { error } = await admin.from("stripe_events").insert({ id, type });
  if (!error) return "new";
  if (error.code === "23505") return "duplicate";
  throw new Error(error.message);
}

export async function releaseStripeEvent(admin: AdminClient, id: string): Promise<void> {
  await admin.from("stripe_events").delete().eq("id", id);
}

export type TeamInviteRow = {
  id: string;
  email: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
};

export type TeamMemberRow = {
  user_id: string;
  role: "owner" | "member";
  email: string;
};

export type TeamView = {
  role: "owner" | "member" | "none";
  team_id: string | null;
  active: boolean;
  seats_paid: number;
  seats_used: number;
  seats_pending: number;
  members: TeamMemberRow[];
  invites: { id: string; email: string; expires_at: string }[];
  can_invite: boolean;
  can_manage: boolean;
};

export async function loadTeam(admin: AdminClient, user: UserRow, now = new Date()): Promise<TeamView> {
  const owner = await admin.from("teams").select("id").eq("owner_id", user.id).maybeSingle();
  if (owner.error) throw new Error(owner.error.message);
  let teamId = (owner.data?.id as string | undefined) ?? null;
  let role: TeamView["role"] = teamId ? "owner" : "none";

  if (!teamId) {
    const membership = await admin
      .from("team_members")
      .select("team_id, role")
      .eq("user_id", user.id)
      .maybeSingle();
    if (membership.error) throw new Error(membership.error.message);
    if (membership.data) {
      teamId = membership.data.team_id as string;
      role = membership.data.role === "owner" ? "owner" : "member";
    }
  }

  if (!teamId) {
    return {
      role: "none",
      team_id: null,
      active: false,
      seats_paid: 0,
      seats_used: 0,
      seats_pending: 0,
      members: [],
      invites: [],
      can_invite: false,
      can_manage: false,
    };
  }

  const team = await admin.from("teams").select("owner_id").eq("id", teamId).single();
  if (team.error) throw new Error(team.error.message);
  const ownerId = team.data.owner_id as string;
  const ownerRow = ownerId === user.id ? user : await findUser(admin, { userId: ownerId });
  const active = ownerRow ? hasPaidAccess(snapshotFromRow(ownerRow), now) && ownerRow.plan === "team" : false;
  const seatsPaid = active && ownerRow ? ownerRow.seats : 0;

  const memberQuery = await admin.from("team_members").select("user_id, role").eq("team_id", teamId);
  if (memberQuery.error) throw new Error(memberQuery.error.message);
  const memberIds = (memberQuery.data ?? []).map((member) => member.user_id as string);
  const people = memberIds.length
    ? await admin.from("users").select("id, email").in("id", memberIds)
    : { data: [], error: null };
  if (people.error) throw new Error(people.error.message);
  const emails = new Map((people.data ?? []).map((person) => [person.id as string, person.email as string]));
  const members: TeamMemberRow[] = (memberQuery.data ?? []).map((member) => ({
    user_id: member.user_id as string,
    role: member.role === "owner" ? "owner" : "member",
    email: emails.get(member.user_id as string) ?? "",
  }));

  const inviteQuery = await admin
    .from("team_invites")
    .select("id, email, expires_at, accepted_at, revoked_at")
    .eq("team_id", teamId);
  if (inviteQuery.error) throw new Error(inviteQuery.error.message);
  const openInvites = ((inviteQuery.data ?? []) as TeamInviteRow[]).filter((invite) =>
    inviteIsOpen(
      { expiresAt: invite.expires_at, acceptedAt: invite.accepted_at, revokedAt: invite.revoked_at },
      now,
    ),
  );
  const canManage = role === "owner" && active;
  return {
    role,
    team_id: teamId,
    active,
    seats_paid: seatsPaid,
    seats_used: members.length,
    seats_pending: openInvites.length,
    members,
    invites: openInvites.map((invite) => ({
      id: invite.id,
      email: invite.email,
      expires_at: invite.expires_at,
    })),
    can_invite: canManage && seatRoom(seatsPaid, members.length, openInvites.length) > 0,
    can_manage: canManage,
  };
}
