// Server-only access rules. Every API route calls these functions.
// Pro, founding, and team (owner or member) are the paid column in docs/PLAN.md.
// A one-off purchase unlocks only that report. A failed payment keeps paid
// access until PAYMENT_GRACE_DAYS have passed, then the account is free.
import "server-only";

export const FREE_SEARCH_LIMIT = 3;
export const SEARCH_WINDOW_DAYS = 7;
export const FREE_ALERT_LIMIT = 1;
export const PAYMENT_GRACE_DAYS = 7;
export const FOUNDING_CAP = 25;
export const DEFAULT_TEAM_SEATS = 5;
export const PRO_TRIAL_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;
const SEARCH_WINDOW_MS = SEARCH_WINDOW_DAYS * DAY_MS;
const GRACE_MS = PAYMENT_GRACE_DAYS * DAY_MS;

export type ReportType = "area" | "property";
export type SubscriptionPlan = "pro" | "founding" | "team";
export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete";
export type PlanKind = "anonymous" | "free" | "report" | "pro" | "founding" | "team" | "past_due";

export interface Entitlement {
  report_type: ReportType;
  target_id: string;
}

export interface Subscription {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  role?: "owner" | "member" | null;
  payment_failed_at?: string | null;
  current_period_end?: string | null;
  seat_limit?: number | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
}

/** The viewer these functions accept. Null means signed out. */
export interface AccessUser {
  id: string;
  email?: string | null;
  entitlements: Entitlement[];
  subscription: Subscription | null;
  /** Searches already used in the current rolling window. */
  searches_used: number;
  /** Watchlist areas already saved. */
  alerts_used: number;
  /** Oldest search in the window. The free limit resets SEARCH_WINDOW_DAYS after this. */
  search_window_started_at?: string | null;
  /** Seats filled on a team plan, including the owner. */
  seats_used?: number;
}

export interface Plan {
  kind: PlanKind;
  /** True for pro, founding, and team while the subscription still grants access. */
  paid: boolean;
  entitlements: Entitlement[];
}

export interface SearchAccess {
  allowed: boolean;
  /** Null means unlimited. */
  limit: number | null;
  used: number;
  remaining: number | null;
  resets_at: string | null;
}

export interface AlertAccess {
  allowed: boolean;
  /** Null means unlimited. */
  limit: number | null;
  used: number;
  remaining: number | null;
}

export interface PaidList<T> {
  /** False for a signed-out viewer: the list is omitted entirely. */
  visible: boolean;
  /** True when at least one row was withheld. */
  locked: boolean;
  /** Omitted when the list is not visible. */
  count?: number;
  rows: T[];
}

const PLANS = new Set<SubscriptionPlan>(["pro", "founding", "team"]);
const STATUSES = new Set<SubscriptionStatus>([
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "incomplete",
]);

const GEOID = /^\d{11}$/;
const RADIUS = /^radius:-?\d{1,3}(?:\.\d+)?,-?\d{1,3}(?:\.\d+)?,\d+(?:\.\d+)?$/;
const PROPERTY = /^[a-z]{2}-[a-z0-9]+(?:-[a-z0-9]+)*:[A-Za-z0-9._-]+$/;

export function isReportTarget(report_type: string, target_id: string): report_type is ReportType {
  if (target_id.length === 0 || target_id.length > 200) return false;
  if (report_type === "area") return GEOID.test(target_id) || RADIUS.test(target_id);
  if (report_type === "property") return PROPERTY.test(target_id);
  return false;
}

function time(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function failedWithinGrace(sub: Subscription, now: Date): boolean {
  const failed = time(sub.payment_failed_at);
  if (failed == null) return false;
  return now.getTime() < failed + GRACE_MS;
}

/** Paid access: trialing, active, canceled but still inside the period, or a failed payment inside grace. */
export function subscriptionGrantsPaid(sub: Subscription | null, now = new Date()): boolean {
  if (!sub || !PLANS.has(sub.plan) || !STATUSES.has(sub.status)) return false;
  if (sub.status === "trialing" || sub.status === "active") return true;
  if (sub.status === "past_due" || sub.status === "unpaid" || sub.status === "incomplete") {
    return failedWithinGrace(sub, now);
  }
  if (sub.status === "canceled") {
    const end = time(sub.current_period_end);
    return end != null && now.getTime() < end;
  }
  return false;
}

export function getPlan(user: AccessUser | null, now = new Date()): Plan {
  if (!user) return { kind: "anonymous", paid: false, entitlements: [] };
  const entitlements = user.entitlements ?? [];
  const sub = user.subscription;
  if (sub && subscriptionGrantsPaid(sub, now)) {
    return { kind: sub.plan, paid: true, entitlements };
  }
  if (
    sub &&
    (sub.status === "past_due" ||
      sub.status === "unpaid" ||
      (sub.status === "incomplete" && sub.payment_failed_at))
  ) {
    return { kind: "past_due", paid: false, entitlements };
  }
  if (entitlements.length > 0) return { kind: "report", paid: false, entitlements };
  return { kind: "free", paid: false, entitlements };
}

function resetsAt(user: AccessUser, now: Date): string {
  const start = time(user.search_window_started_at) ?? now.getTime();
  return new Date(start + SEARCH_WINDOW_MS).toISOString();
}

export function canSearch(user: AccessUser | null, now = new Date()): SearchAccess {
  const plan = getPlan(user, now);
  if (!user || plan.kind === "anonymous") {
    return { allowed: false, limit: 0, used: 0, remaining: 0, resets_at: null };
  }
  const used = Math.max(0, user.searches_used || 0);
  // A purchased report includes search. A live subscription does too.
  if (plan.paid || plan.kind === "report" || plan.entitlements.length > 0) {
    return { allowed: true, limit: null, used, remaining: null, resets_at: null };
  }
  const allowed = used < FREE_SEARCH_LIMIT;
  return {
    allowed,
    limit: FREE_SEARCH_LIMIT,
    used,
    remaining: Math.max(0, FREE_SEARCH_LIMIT - used),
    resets_at: resetsAt(user, now),
  };
}

export interface SearchDecision {
  allowed: boolean;
  reason?: "auth_required" | "limit_reached";
  resets_at: string | null;
  usage: { used: number; limit: number | null; resets_at: string | null };
}

/** What /api/near should do. A successful search counts one use against a finite limit. */
export function searchDecision(user: AccessUser | null, now = new Date()): SearchDecision {
  const access = canSearch(user, now);
  if (!access.allowed) {
    const signedOut = !user || getPlan(user, now).kind === "anonymous";
    return {
      allowed: false,
      reason: signedOut ? "auth_required" : "limit_reached",
      resets_at: access.resets_at,
      usage: { used: access.used, limit: access.limit, resets_at: access.resets_at },
    };
  }
  return {
    allowed: true,
    resets_at: access.resets_at,
    usage: {
      used: access.limit == null ? access.used : access.used + 1,
      limit: access.limit,
      resets_at: access.resets_at,
    },
  };
}

export function canViewReport(
  user: AccessUser | null,
  report_type: ReportType,
  target_id: string,
  now = new Date(),
): boolean {
  if (!user || !isReportTarget(report_type, target_id)) return false;
  if (getPlan(user, now).paid) return true;
  return user.entitlements.some((row) => row.report_type === report_type && row.target_id === target_id);
}

/** Named rehab candidates in every place. A one-off report does not set this. */
export function canSeeRehabNames(user: AccessUser | null, now = new Date()): boolean {
  return getPlan(user, now).paid;
}

/** Data export and unlimited IC memos. A one-off report is exported through canViewReport. */
export function canExport(user: AccessUser | null, now = new Date()): boolean {
  return getPlan(user, now).paid;
}

export function canReadFullMemo(user: AccessUser | null, geoid: string, now = new Date()): boolean {
  return canExport(user, now) || canViewReport(user, "area", geoid, now);
}

/** Permit addresses. Signed out: no. Every signed-in column in the plan: yes. */
export function canSeePermitDetails(user: AccessUser | null, now = new Date()): boolean {
  return getPlan(user, now).kind !== "anonymous";
}

/** Wayback slider and tract age shading. Signed out: no. */
export function canUseWayback(user: AccessUser | null, now = new Date()): boolean {
  return getPlan(user, now).kind !== "anonymous";
}

export function canUseAlerts(user: AccessUser | null, now = new Date()): AlertAccess {
  const plan = getPlan(user, now);
  if (!user || plan.kind === "anonymous") {
    return { allowed: false, limit: 0, used: 0, remaining: 0 };
  }
  const used = Math.max(0, user.alerts_used || 0);
  if (plan.paid) return { allowed: true, limit: null, used, remaining: null };
  // A one-off report does not include watchlists. A lapsed subscription is a free account.
  if (plan.kind === "report") return { allowed: false, limit: 0, used, remaining: 0 };
  const remaining = Math.max(0, FREE_ALERT_LIMIT - used);
  return { allowed: true, limit: FREE_ALERT_LIMIT, used, remaining };
}

export interface AlertDecision {
  allowed: boolean;
  reason?: "auth_required" | "payment_required" | "limit_reached";
}

export function alertCreate(user: AccessUser | null, now = new Date()): AlertDecision {
  if (!user) return { allowed: false, reason: "auth_required" };
  const access = canUseAlerts(user, now);
  if (!access.allowed) return { allowed: false, reason: "payment_required" };
  if (access.remaining === 0) return { allowed: false, reason: "limit_reached" };
  return { allowed: true };
}

/**
 * Paid lists (named rehab candidates) are trimmed here.
 * Signed out: nothing. Free (and a lapsed subscription): the count and the first row.
 * A report buyer gets every row for the purchased target only.
 */
export function shapePaidList<T>(
  user: AccessUser | null,
  rows: readonly T[],
  scope?: { report_type: ReportType; target_id: string },
  now = new Date(),
): PaidList<T> {
  const open =
    canSeeRehabNames(user, now) ||
    (scope != null && canViewReport(user, scope.report_type, scope.target_id, now));
  if (open) {
    return { visible: true, locked: false, count: rows.length, rows: [...rows] };
  }
  if (getPlan(user, now).kind === "anonymous") {
    return { visible: false, locked: true, rows: [] };
  }
  const preview = rows.slice(0, 1);
  return {
    visible: true,
    locked: rows.length > preview.length,
    count: rows.length,
    rows: preview,
  };
}

export function canStartFounding(activeFoundingCount: number): boolean {
  return activeFoundingCount < FOUNDING_CAP;
}

export interface TeamInviteDecision {
  allowed: boolean;
  reason?: "auth_required" | "payment_required" | "seat_cap";
  seat_limit: number | null;
  seats_used: number;
}

export function teamInvite(user: AccessUser | null, now = new Date()): TeamInviteDecision {
  if (!user) return { allowed: false, reason: "auth_required", seat_limit: null, seats_used: 0 };
  const plan = getPlan(user, now);
  const seats_used = Math.max(0, user.seats_used ?? 1);
  const seat_limit = user.subscription?.seat_limit ?? DEFAULT_TEAM_SEATS;
  if (plan.kind !== "team" || !plan.paid || user.subscription?.role !== "owner") {
    return { allowed: false, reason: "payment_required", seat_limit: plan.kind === "team" ? seat_limit : null, seats_used };
  }
  if (seats_used >= seat_limit) {
    return { allowed: false, reason: "seat_cap", seat_limit, seats_used };
  }
  return { allowed: true, seat_limit, seats_used };
}

export interface ReportRequest {
  report_type: ReportType;
  target_id: string;
}

export function parseReportRequest(body: unknown): ReportRequest | null {
  if (!body || typeof body !== "object") return null;
  const report_type = (body as { report_type?: unknown }).report_type;
  const target_id = (body as { target_id?: unknown }).target_id;
  if (typeof report_type !== "string" || typeof target_id !== "string") return null;
  const target = target_id.trim();
  if (!isReportTarget(report_type, target)) return null;
  return { report_type, target_id: target };
}

export function parsePlanRequest(body: unknown): SubscriptionPlan | null {
  if (!body || typeof body !== "object") return null;
  const plan = (body as { plan?: unknown }).plan;
  if (plan === "pro" || plan === "founding" || plan === "team") return plan;
  return null;
}

// --- Stripe events -----------------------------------------------------------------

type Obj = Record<string, unknown>;

export interface StripeEvent {
  id?: string;
  type: string;
  created?: number;
  data?: { object?: Obj };
}

export interface SubscriptionPatch {
  plan?: SubscriptionPlan;
  status?: SubscriptionStatus;
  role?: "owner" | "member";
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  /** Undefined leaves the stored value alone. Null clears it. */
  payment_failed_at?: string | null;
  current_period_end?: string | null;
  seat_limit?: number | null;
}

export interface EntitlementGrant {
  report_type: ReportType;
  target_id: string;
  stripe_session_id: string;
  stripe_payment_intent: string | null;
  amount_total: number | null;
  currency: string | null;
}

export interface BillingEffect {
  user_id: string | null;
  email: string | null;
  stripe_subscription_id: string | null;
  entitlement: EntitlementGrant | null;
  subscription: SubscriptionPatch | null;
}

function asObj(value: unknown): Obj | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Obj;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function metadata(obj: Obj): Obj {
  return asObj(obj.metadata) ?? {};
}

function unixIso(value: unknown): string | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

function stripeStatus(value: unknown): SubscriptionStatus | null {
  const raw = str(value);
  if (!raw) return null;
  if (STATUSES.has(raw as SubscriptionStatus)) return raw as SubscriptionStatus;
  if (raw === "incomplete_expired") return "canceled";
  return null;
}

function planOf(value: unknown): SubscriptionPlan | null {
  const raw = str(value);
  if (raw === "pro" || raw === "founding" || raw === "team") return raw;
  return null;
}

function subscriptionIdOf(obj: Obj): string | null {
  const direct = str(obj.subscription);
  if (direct) return direct;
  const parent = asObj(obj.parent);
  const details = parent ? asObj(parent.subscription_details) : null;
  return details ? str(details.subscription) : null;
}

function emptyEffect(): BillingEffect {
  return { user_id: null, email: null, stripe_subscription_id: null, entitlement: null, subscription: null };
}

/** Map a verified Stripe event onto an entitlement or subscription change. */
export function effectOfStripeEvent(event: StripeEvent, now = new Date()): BillingEffect | null {
  const obj = asObj(event.data?.object);
  if (!obj) return null;
  const meta = metadata(obj);

  if (event.type === "checkout.session.completed") {
    const effect = emptyEffect();
    effect.user_id = str(obj.client_reference_id) ?? str(meta.user_id);
    effect.email = str(asObj(obj.customer_details)?.email);
    const paymentStatus = str(obj.payment_status);
    const reportType = str(meta.report_type);
    const target = str(meta.target_id);
    if (reportType && target && isReportTarget(reportType, target)) {
      if (paymentStatus !== "paid") return null;
      const sessionId = str(obj.id);
      if (!sessionId) return null;
      effect.entitlement = {
        report_type: reportType,
        target_id: target,
        stripe_session_id: sessionId,
        stripe_payment_intent: str(obj.payment_intent),
        amount_total: typeof obj.amount_total === "number" ? obj.amount_total : null,
        currency: str(obj.currency),
      };
      return effect;
    }
    const plan = planOf(meta.plan);
    if (!plan) return null;
    if (paymentStatus !== "paid" && paymentStatus !== "no_payment_required") return null;
    const status: SubscriptionStatus = paymentStatus === "no_payment_required" ? "trialing" : "active";
    effect.stripe_subscription_id = str(obj.subscription);
    effect.subscription = {
      plan,
      status,
      role: "owner",
      stripe_customer_id: str(obj.customer),
      stripe_subscription_id: effect.stripe_subscription_id,
      payment_failed_at: null,
      seat_limit: plan === "team" ? DEFAULT_TEAM_SEATS : null,
    };
    return effect;
  }

  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const status = event.type === "customer.subscription.deleted" ? "canceled" : stripeStatus(obj.status);
    if (!status) return null;
    const effect = emptyEffect();
    effect.user_id = str(meta.user_id);
    effect.stripe_subscription_id = str(obj.id);
    const plan = planOf(meta.plan);
    const patch: SubscriptionPatch = {
      status,
      stripe_customer_id: str(obj.customer),
      stripe_subscription_id: effect.stripe_subscription_id,
      current_period_end:
        event.type === "customer.subscription.deleted"
          ? now.toISOString()
          : unixIso(obj.current_period_end),
    };
    if (plan) patch.plan = plan;
    if (status === "active" || status === "trialing") patch.payment_failed_at = null;
    if (plan === "team") patch.seat_limit = DEFAULT_TEAM_SEATS;
    effect.subscription = patch;
    return effect;
  }

  if (event.type === "invoice.payment_failed") {
    const effect = emptyEffect();
    const details = asObj(obj.subscription_details);
    const nested = details ? metadata(details) : {};
    effect.user_id = str(meta.user_id) ?? str(nested.user_id);
    effect.stripe_subscription_id = subscriptionIdOf(obj);
    const created = typeof event.created === "number" ? new Date(event.created * 1000) : now;
    effect.subscription = {
      status: "past_due",
      stripe_subscription_id: effect.stripe_subscription_id,
      payment_failed_at: created.toISOString(),
    };
    return effect;
  }

  return null;
}
