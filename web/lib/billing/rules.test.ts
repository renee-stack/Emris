import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { annualCents, FOUNDING_SPOTS, proPlan } from "../pricing";
import {
  canBuyFounding,
  foundingDeniedMessage,
  hasPaidAccess,
  inviteExpiry,
  inviteIsOpen,
  isReportTarget,
  nextBillingState,
  parseCheckoutBody,
  seatRoom,
  trialDaysFor,
  type BillingSnapshot,
} from "./rules";

function freeSnap(over: Partial<BillingSnapshot> = {}): BillingSnapshot {
  return {
    plan: "free",
    subscriptionStatus: "none",
    foundingMember: false,
    seats: 1,
    graceUntil: null,
    interval: null,
    cancelAtPeriodEnd: false,
    ...over,
  };
}

const t0 = new Date("2026-10-31T18:00:00.000Z");

describe("prices and spots", () => {
  it("gives two months free on annual billing", () => {
    assert.equal(annualCents(proPlan.monthlyCents), proPlan.monthlyCents * 10);
    assert.equal(annualCents(9900), 99000);
  });

  it("caps founding at 50 active subscriptions and lets a member return", () => {
    assert.equal(canBuyFounding(49, false), true);
    assert.equal(canBuyFounding(FOUNDING_SPOTS, false), false);
    assert.equal(canBuyFounding(FOUNDING_SPOTS, true), true);
    assert.equal(foundingDeniedMessage(), "Founding spots are gone");
  });

  it("offers a 7-day trial only to first-time pro and team subscribers", () => {
    assert.equal(trialDaysFor("pro", false), 7);
    assert.equal(trialDaysFor("team", false), 7);
    assert.equal(trialDaysFor("pro", true), undefined);
    assert.equal(trialDaysFor("founding", false), undefined);
  });
});

describe("checkout body", () => {
  it("accepts pro monthly and team seats", () => {
    assert.deepEqual(parseCheckoutBody({ plan: "pro", interval: "month" }), {
      plan: "pro",
      interval: "month",
      targetId: null,
      quantity: null,
    });
    assert.deepEqual(parseCheckoutBody({ plan: "team", interval: "year" }), {
      plan: "team",
      interval: "year",
      targetId: null,
      quantity: 3,
    });
  });

  it("rejects a team below 3 seats and a yearly founding plan", () => {
    const team = parseCheckoutBody({ plan: "team", interval: "month", quantity: 2 });
    assert.equal("error" in team, true);
    const founding = parseCheckoutBody({ plan: "founding", interval: "year" });
    assert.equal("error" in founding, true);
  });

  it("requires a real report target", () => {
    const missing = parseCheckoutBody({ plan: "area_report" });
    assert.equal("error" in missing, true);
    assert.equal(isReportTarget("area_report", "17031221500"), true);
    assert.equal(isReportTarget("area_report", "radius:41.9,-87.7,0.5"), true);
    assert.equal(isReportTarget("property_report", "aa-example:14-28-100-001"), true);
    assert.equal(isReportTarget("area_report", "nope"), false);
  });
});

describe("subscription sync", () => {
  it("keeps the plan for 3 days after a failed payment, then drops to Free", () => {
    const active = freeSnap({
      plan: "pro",
      subscriptionStatus: "active",
      interval: "month",
      seats: 1,
    });
    const failed = nextBillingState({
      previous: active,
      event: "payment_failed",
      stripePlan: "pro",
      interval: "month",
      now: t0,
    });
    assert.equal(failed.plan, "pro");
    assert.equal(failed.subscriptionStatus, "past_due");
    assert.equal(hasPaidAccess(failed, t0), true);
    assert.equal(failed.graceUntil, new Date(t0.getTime() + 3 * 86_400_000).toISOString());

    const again = nextBillingState({
      previous: failed,
      event: "subscription",
      stripeStatus: "past_due",
      stripePlan: "pro",
      interval: "month",
      now: new Date(t0.getTime() + 86_400_000),
    });
    assert.equal(again.graceUntil, failed.graceUntil);
    assert.equal(again.plan, "pro");

    const after = new Date(t0.getTime() + 3 * 86_400_000 + 1000);
    const dropped = nextBillingState({
      previous: again,
      event: "payment_failed",
      stripePlan: "pro",
      now: after,
    });
    assert.equal(dropped.plan, "free");
    assert.equal(hasPaidAccess(dropped, after), false);
    assert.equal(dropped.graceUntil, failed.graceUntil);
  });

  it("clears the grace period when the invoice is paid", () => {
    const failed = nextBillingState({
      previous: freeSnap({ plan: "team", subscriptionStatus: "active", seats: 4, interval: "month" }),
      event: "payment_failed",
      stripePlan: "team",
      quantity: 4,
      interval: "month",
      now: t0,
    });
    const paid = nextBillingState({
      previous: failed,
      event: "invoice_paid",
      stripeStatus: "active",
      stripePlan: "team",
      quantity: 4,
      interval: "month",
      now: new Date(t0.getTime() + 86_400_000),
    });
    assert.equal(paid.plan, "team");
    assert.equal(paid.seats, 4);
    assert.equal(paid.graceUntil, null);
    assert.equal(paid.subscriptionStatus, "active");
  });

  it("sets founding_member and keeps it after cancellation", () => {
    const founded = nextBillingState({
      previous: freeSnap(),
      event: "subscription",
      stripeStatus: "active",
      stripePlan: "founding",
      interval: "month",
      now: t0,
    });
    assert.equal(founded.foundingMember, true);
    assert.equal(founded.plan, "founding");
    const canceled = nextBillingState({ previous: founded, event: "deleted", now: t0 });
    assert.equal(canceled.plan, "free");
    assert.equal(canceled.foundingMember, true);
    assert.equal(canceled.subscriptionStatus, "canceled");
  });

  it("records the seat quantity chosen for a team trial", () => {
    const team = nextBillingState({
      previous: freeSnap(),
      event: "subscription",
      stripeStatus: "trialing",
      stripePlan: "team",
      quantity: 6,
      interval: "year",
      now: t0,
    });
    assert.equal(team.seats, 6);
    assert.equal(team.subscriptionStatus, "trialing");
    assert.equal(team.interval, "year");
  });
});

describe("invites", () => {
  it("expires an invite after 7 days and counts pending seats", () => {
    const expiry = inviteExpiry(t0);
    assert.equal(expiry, new Date(t0.getTime() + 7 * 86_400_000).toISOString());
    const invite = { expiresAt: expiry, acceptedAt: null, revokedAt: null };
    assert.equal(inviteIsOpen(invite, new Date(t0.getTime() + 6 * 86_400_000)), true);
    assert.equal(inviteIsOpen(invite, new Date(t0.getTime() + 7 * 86_400_000 + 1)), false);
    assert.equal(seatRoom(3, 2, 1), 0);
    assert.equal(seatRoom(5, 2, 1), 2);
  });
});
