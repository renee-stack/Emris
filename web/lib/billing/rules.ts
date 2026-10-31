import {
  FOUNDING_GONE,
  FOUNDING_SPOTS,
  GRACE_DAYS,
  INVITE_TTL_DAYS,
  TEAM_MAX_SEATS,
  TEAM_MIN_SEATS,
  TRIAL_DAYS,
  isPurchasablePlan,
  isReportPlan,
  isSubscriptionPlan,
  type AccountPlan,
  type Interval,
  type PurchasablePlan,
  type ReportPlan,
  type SubscriptionPlan,
} from "../pricing";

export type SubscriptionStatus =
  | "none"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "unpaid";

export type BillingSnapshot = {
  plan: AccountPlan;
  subscriptionStatus: SubscriptionStatus;
  foundingMember: boolean;
  seats: number;
  graceUntil: string | null;
  interval: Interval | null;
  cancelAtPeriodEnd: boolean;
};

export type CheckoutRequest = {
  plan: PurchasablePlan;
  interval: Interval | null;
  targetId: string | null;
  quantity: number | null;
};

const DAY_MS = 86_400_000;

export function addDays(from: Date, days: number): string {
  return new Date(from.getTime() + days * DAY_MS).toISOString();
}

export function isGraceOpen(graceUntil: string | null, now: Date): boolean {
  if (!graceUntil) return false;
  return new Date(graceUntil).getTime() > now.getTime();
}

export function hasPaidAccess(snapshot: BillingSnapshot, now: Date): boolean {
  if (snapshot.plan === "free") return false;
  if (snapshot.subscriptionStatus === "active" || snapshot.subscriptionStatus === "trialing") {
    return true;
  }
  if (snapshot.subscriptionStatus === "past_due" || snapshot.subscriptionStatus === "unpaid") {
    return isGraceOpen(snapshot.graceUntil, now);
  }
  return false;
}

export function canStartSubscription(snapshot: BillingSnapshot, now: Date): boolean {
  return !hasPaidAccess(snapshot, now);
}

export function foundingSpotsLeft(activeFounding: number, cap = FOUNDING_SPOTS): number {
  return Math.max(0, cap - activeFounding);
}

export function canBuyFounding(activeFounding: number, alreadyMember: boolean, cap = FOUNDING_SPOTS): boolean {
  if (alreadyMember) return true;
  return activeFounding < cap;
}

export function trialDaysFor(plan: SubscriptionPlan, trialUsed: boolean): number | undefined {
  if (plan === "founding" || trialUsed) return undefined;
  return TRIAL_DAYS;
}

export function seatRoom(paid: number, members: number, pending: number): number {
  return paid - members - pending;
}

export function inviteExpiry(from: Date): string {
  return addDays(from, INVITE_TTL_DAYS);
}

export function inviteIsOpen(
  invite: { expiresAt: string; acceptedAt: string | null; revokedAt: string | null },
  now: Date,
): boolean {
  if (invite.acceptedAt || invite.revokedAt) return false;
  return new Date(invite.expiresAt).getTime() > now.getTime();
}

export function isReportTarget(plan: ReportPlan, target: string): boolean {
  if (target.length === 0 || target.length > 160) return false;
  if (plan === "property_report") {
    return /^([a-z]{2}-[a-z0-9]+(?:-[a-z0-9]+)*):([^:\s]{1,80})$/.test(target);
  }
  if (/^\d{11}$/.test(target)) return true;
  const radius = /^radius:(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?),(\d+(?:\.\d+)?)$/.exec(target);
  if (!radius) return false;
  const lat = Number(radius[1]);
  const lng = Number(radius[2]);
  const miles = Number(radius[3]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(miles)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  return miles > 0 && miles <= 100;
}

export function parseCheckoutBody(body: unknown): CheckoutRequest | { error: string } {
  if (!body || typeof body !== "object") return { error: "Request body must be an object." };
  const record = body as Record<string, unknown>;
  const plan = record.plan;
  if (plan === "free") return { error: "Free doesn't use checkout." };
  if (typeof plan !== "string" || !isPurchasablePlan(plan)) return { error: "Unknown plan." };

  const interval = record.interval;
  let parsedInterval: Interval | null = null;
  if (interval !== undefined && interval !== null) {
    if (interval !== "month" && interval !== "year") {
      return { error: "Choose monthly or annual billing." };
    }
    parsedInterval = interval;
  }

  if (isSubscriptionPlan(plan)) {
    if (plan === "founding") {
      if (parsedInterval === "year") return { error: "Founding membership is billed monthly." };
      parsedInterval = "month";
    } else if (!parsedInterval) {
      return { error: "Choose monthly or annual billing." };
    }
  }

  let targetId: string | null = null;
  if (record.target_id !== undefined && record.target_id !== null) {
    if (typeof record.target_id !== "string") return { error: "That report target isn't valid." };
    targetId = record.target_id.trim();
  }
  if (isReportPlan(plan)) {
    if (!targetId || !isReportTarget(plan, targetId)) return { error: "That report target isn't valid." };
  }

  let quantity: number | null = null;
  if (record.quantity !== undefined && record.quantity !== null) {
    if (typeof record.quantity !== "number" || !Number.isInteger(record.quantity)) {
      return { error: "Seat quantity has to be a whole number." };
    }
    quantity = record.quantity;
  }
  if (plan === "team") {
    const starting = quantity ?? TEAM_MIN_SEATS;
    if (starting < TEAM_MIN_SEATS) return { error: `Team plans start at ${TEAM_MIN_SEATS} seats.` };
    if (starting > TEAM_MAX_SEATS) return { error: `Team checkout allows up to ${TEAM_MAX_SEATS} seats.` };
    quantity = starting;
  } else if (quantity !== null) {
    return { error: "Seat quantity is only for the Team plan." };
  }

  return { plan, interval: parsedInterval, targetId, quantity };
}

function seatsFor(plan: AccountPlan, quantity: number | undefined, previous: number): number {
  if (plan === "team") return Math.max(1, quantity ?? previous);
  return 1;
}

function keptPlan(stripePlan: SubscriptionPlan | null, previous: AccountPlan): AccountPlan {
  if (stripePlan) return stripePlan;
  return previous;
}

export function nextBillingState(args: {
  previous: BillingSnapshot;
  event: "subscription" | "payment_failed" | "invoice_paid" | "deleted";
  stripeStatus?: string | null;
  stripePlan?: SubscriptionPlan | null;
  quantity?: number;
  interval?: Interval | null;
  cancelAtPeriodEnd?: boolean;
  now: Date;
}): BillingSnapshot {
  const prev = args.previous;

  if (args.event === "deleted") {
    return {
      plan: "free",
      subscriptionStatus: "canceled",
      foundingMember: prev.foundingMember,
      seats: 1,
      graceUntil: null,
      interval: null,
      cancelAtPeriodEnd: false,
    };
  }

  if (args.event === "payment_failed") {
    const graceUntil = prev.graceUntil ?? addDays(args.now, GRACE_DAYS);
    const open = isGraceOpen(graceUntil, args.now);
    const plan = open ? keptPlan(args.stripePlan ?? null, prev.plan) : "free";
    return {
      plan,
      subscriptionStatus: "past_due",
      foundingMember: prev.foundingMember || plan === "founding",
      seats: plan === "free" ? 1 : seatsFor(plan, args.quantity, prev.seats),
      graceUntil,
      interval: plan === "free" ? null : (args.interval ?? prev.interval),
      cancelAtPeriodEnd: prev.cancelAtPeriodEnd,
    };
  }

  if (args.event === "invoice_paid") {
    const plan = keptPlan(args.stripePlan ?? null, prev.plan);
    const status = args.stripeStatus === "trialing" ? "trialing" : "active";
    return {
      plan,
      subscriptionStatus: plan === "free" ? prev.subscriptionStatus : status,
      foundingMember: prev.foundingMember || plan === "founding",
      seats: seatsFor(plan, args.quantity, prev.seats),
      graceUntil: null,
      interval: args.interval ?? prev.interval,
      cancelAtPeriodEnd: Boolean(args.cancelAtPeriodEnd),
    };
  }

  const status = args.stripeStatus ?? "";
  if (status === "active" || status === "trialing") {
    const plan = args.stripePlan;
    if (!plan) return prev;
    return {
      plan,
      subscriptionStatus: status,
      foundingMember: prev.foundingMember || plan === "founding",
      seats: seatsFor(plan, args.quantity, prev.seats),
      graceUntil: null,
      interval: args.interval ?? prev.interval,
      cancelAtPeriodEnd: Boolean(args.cancelAtPeriodEnd),
    };
  }
  if (status === "past_due" || status === "unpaid") {
    return nextBillingState({ ...args, event: "payment_failed" });
  }
  if (status === "canceled" || status === "incomplete_expired") {
    return nextBillingState({ ...args, event: "deleted" });
  }
  if (status === "incomplete" && !hasPaidAccess(prev, args.now)) {
    return { ...prev, subscriptionStatus: "incomplete" };
  }
  return prev;
}

export function foundingDeniedMessage(): string {
  return FOUNDING_GONE;
}
