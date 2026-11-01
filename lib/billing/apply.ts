import type { DatabaseSync } from "node:sqlite";
import { hasEventKey, recordEvent, unlockReport, updateSubscription, getUserById, type User } from "./store";
import type { Plan } from "./pure";

export interface SubscriptionSnapshot {
  id: string;
  status: string;
  trialEnd: number | null;
  customerId: string | null;
}

export interface CompletedCheckout {
  id: string;
  mode: "subscription" | "payment" | string;
  status: string | null;
  paymentStatus: string | null;
  customerId: string | null;
  userId: string | null;
  intent: string | null;
  geoid: string | null;
  subscription: SubscriptionSnapshot | null;
}

function planForStatus(status: string): Plan {
  if (status === "trialing") return "trial";
  if (status === "active" || status === "past_due") return "pro";
  return "free";
}

export function applySubscription(db: DatabaseSync, user: User, sub: SubscriptionSnapshot, now = new Date()): User {
  const plan = planForStatus(sub.status);
  const trialEndsAt = sub.trialEnd ? new Date(sub.trialEnd * 1000).toISOString() : user.trialEndsAt;
  const customerId = sub.customerId ?? user.stripeCustomerId;
  updateSubscription(db, user.id, {
    plan,
    subscriptionStatus: sub.status,
    trialEndsAt,
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
  });
  const key = `sub_${sub.id}`;
  if ((plan === "pro" || plan === "trial") && !hasEventKey(db, user.id, "upgraded", key)) {
    recordEvent(db, {
      name: "upgraded",
      userId: user.id,
      at: now,
      properties: { key, plan, trial: plan === "trial" },
    });
  }
  return {
    ...user,
    plan,
    subscriptionStatus: sub.status,
    trialEndsAt,
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
  };
}

export function applyCompletedCheckout(db: DatabaseSync, checkout: CompletedCheckout, now = new Date()): { applied: boolean } {
  if (!checkout.userId) return { applied: false };
  if (checkout.status !== "complete") return { applied: false };
  const user = getUserById(db, checkout.userId, now);
  if (!user) return { applied: false };

  if (checkout.mode === "payment") {
    if (checkout.paymentStatus !== "paid" || checkout.intent !== "report" || !checkout.geoid) return { applied: false };
    unlockReport(db, user.id, checkout.geoid, checkout.id, now);
    if (checkout.customerId && checkout.customerId !== user.stripeCustomerId) {
      updateSubscription(db, user.id, {
        plan: user.plan,
        subscriptionStatus: user.subscriptionStatus,
        trialEndsAt: user.trialEndsAt,
        stripeCustomerId: checkout.customerId,
        stripeSubscriptionId: user.stripeSubscriptionId,
      });
    }
    return { applied: true };
  }

  if (checkout.mode !== "subscription" || !checkout.subscription) return { applied: false };
  const paid = checkout.paymentStatus === "paid" || checkout.paymentStatus === "no_payment_required";
  if (!paid) return { applied: false };
  applySubscription(
    db,
    user,
    { ...checkout.subscription, customerId: checkout.subscription.customerId ?? checkout.customerId },
    now,
  );
  return { applied: true };
}
