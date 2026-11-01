import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { applyCompletedCheckout, applySubscription } from "./apply";
import { buildProCheckoutParams, buildReportCheckoutParams } from "./checkout";
import { openDatabase } from "./db";
import { gateTract } from "./gate";
import {
  FREE_SEARCHES_PER_WEEK,
  PRO_MONTHLY_USD,
  TRIAL_DAYS,
  chicagoWeek,
  firstMemoSection,
  gateMemo,
  isMultifamilyPermit,
  isRehabCandidate,
  previewRecords,
  searchMeterCopy,
  tractUpsell,
  trialEndingEmail,
} from "./pure";
import { sendDueTrialReminders } from "./reminders";
import { consumeSearch, createUser, recordEvent, searchUsage } from "./store";
import type { Permit, ProjectWithDistance, TractProps } from "../data";

function memoryDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "emris-billing-"));
  return openDatabase(path.join(dir, "test.sqlite"));
}

const tract = {
  geoid: "17031837800",
  name: "Near West Side · Tract 8378",
  score: 80,
  percentile: 90,
  momentum: "up",
  momentum_pct: 12,
  signals: { mf_permits: 70, permit_momentum: 60, infra_proximity: 40 },
  permit_count_24mo: 2,
  units_24mo: 16,
} as TractProps;

function permit(id: string, address: string, units: number | null, description: string): Permit {
  return {
    id,
    address,
    lat: 41.88,
    lng: -87.67,
    issue_date: "2026-01-01",
    units,
    description,
    geoid: tract.geoid,
  };
}

test("chicago week resets on the next Monday, across the daylight-saving change", () => {
  const saturday = new Date("2026-10-31T22:00:00.000Z");
  const week = chicagoWeek(saturday);
  assert.equal(week.start.toISOString(), "2026-10-26T05:00:00.000Z");
  assert.equal(week.reset.toISOString(), "2026-11-02T06:00:00.000Z");
  const monday = new Date("2026-11-02T06:30:00.000Z");
  const next = chicagoWeek(monday);
  assert.equal(next.start.toISOString(), "2026-11-02T06:00:00.000Z");
});

test("meter and tract copy use the real counts", () => {
  assert.equal(searchMeterCopy(2, 3), "2 of 3 free searches left this week");
  assert.equal(
    tractUpsell({ multifamily: 8, rehab: 3, permits: 8, owners: 0 }),
    "This tract has 8 multifamily permits and 3 rehab candidates. See them all with Pro.",
  );
  assert.equal(tractUpsell({ multifamily: 1, rehab: 0, permits: 1, owners: 0 }), null);
  assert.equal(
    tractUpsell({ multifamily: 1, rehab: 0, permits: 6, owners: 0 }),
    "This tract has 6 permits on file. See the full history with Pro.",
  );
});

test("preview omits every row after the first", () => {
  const hidden = "SECRET OWNER LLC";
  const rows = previewRecords(
    [
      { id: "1", name: "First Owner", address: "1 N Main" },
      { id: "2", name: hidden, address: "2 N Main" },
    ],
    "preview",
  );
  assert.equal(rows.total, 2);
  assert.deepEqual(rows.rows.map((row) => row.name), ["First Owner"]);
  assert.equal(JSON.stringify(rows).includes(hidden), false);
  assert.equal(previewRecords(rows.rows, "full").rows.length, 1);
});

test("rehab and multifamily classifiers stay on the permit text", () => {
  assert.equal(
    isRehabCandidate({
      description: "INTERIOR DEMOLITION/STRIP-OUT OF AN EXISTING SEVEN UNIT BUILDING. PREPARATION FOR RENOVATION. R-2 RESIDENTIAL",
    }),
    true,
  );
  assert.equal(isRehabCandidate({ description: "ERECT NEW 6 UNIT APARTMENT BUILDING" }), false);
  assert.equal(isMultifamilyPermit({ units: 8, description: "anything" }), true);
  assert.equal(isMultifamilyPermit({ units: 2, description: "R-2 MULTI-FAMILY" }), false);
  assert.equal(isMultifamilyPermit({ units: null, description: "40 D.U. RESIDENTIAL BUILDING" }), true);
});

test("free memo keeps the first section only", () => {
  const full = "## Thesis\n\nTwo sentences.\n\n## Signals\n\nHidden score talk.\n\n## Risks\n\nHidden risk.";
  const gated = gateMemo({ geoid: "17031837800", title: "Memo", memo_markdown: full }, "preview");
  assert.equal(gated.memo_markdown.includes("Hidden"), false);
  assert.deepEqual(gated.locked_sections, ["Signals", "Risks"]);
  assert.equal(gated.access, "preview");
  const split = firstMemoSection(full);
  assert.match(split.markdown, /Thesis/);
});

test("gateTract sends the count and the first row, not the rest", () => {
  const permits = [
    permit("a", "19 N Campbell Ave", 8, "FULL BUILDING PERMIT FOR 8 D.U."),
    permit("b", "2431 W Warren Blvd", 8, "FULL BUILDING PERMIT FOR 8 D.U. SECRET-ADDRESS"),
  ];
  const gated = gateTract({
    tract,
    permits,
    projects: [] as ProjectWithDistance[],
    owners: [
      { id: "o1", name: "Able Owner", address: "19 N Campbell Ave" },
      { id: "o2", name: "Zeta Owner", address: "2431 W Warren Blvd" },
    ],
    access: "preview",
  });
  assert.equal(gated.multifamily_permits.total, 2);
  assert.equal(gated.multifamily_permits.rows.length, 1);
  assert.equal(gated.permit_history.rows[0]?.address, "19 N Campbell Ave");
  assert.equal(gated.owners.total, 2);
  const encoded = JSON.stringify(gated);
  assert.equal(encoded.includes("SECRET-ADDRESS"), false);
  assert.equal(encoded.includes("Zeta Owner"), false);
  assert.equal(encoded.includes("Able Owner"), true);
});

test("free search quota is three a week and a repeat does not consume another", () => {
  const db = memoryDb();
  const now = new Date("2026-10-31T22:00:00.000Z");
  for (let i = 0; i < FREE_SEARCHES_PER_WEEK; i += 1) {
    const decision = consumeSearch(db, "anon", `pilsen ${i}`, now);
    assert.equal(decision.ok, true);
    assert.equal(decision.remaining, FREE_SEARCHES_PER_WEEK - i - 1);
  }
  const blocked = consumeSearch(db, "anon", "logan square", now);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.remaining, 0);
  const repeat = consumeSearch(db, "anon", "pilsen 0", new Date(now.getTime() + 1000));
  assert.equal(repeat.ok, true);
  assert.equal(repeat.duplicate, true);
  const nextWeek = consumeSearch(db, "anon", "pilsen", new Date("2026-11-02T06:30:00.000Z"));
  assert.equal(nextWeek.ok, true);
  assert.equal(nextWeek.remaining, 2);
});

test("signup keeps the searches already used on this browser", () => {
  const db = memoryDb();
  const now = new Date("2026-10-31T22:00:00.000Z");
  consumeSearch(db, "anon-1", "pilsen", now);
  const { user } = createUser(db, "a@firm.com", "anon-1", now);
  const usage = searchUsage(db, user.id, now);
  assert.equal(usage.used, 1);
  assert.equal(usage.remaining, 2);
});

test("trial checkout requires a card and a 7-day trial", () => {
  const params = buildProCheckoutParams({
    email: "a@firm.com",
    userId: "user-1",
    customerId: null,
    trial: true,
    origin: "http://localhost:3000",
    surface: "memo",
  });
  assert.equal(params.mode, "subscription");
  assert.equal(params.payment_method_collection, "always");
  assert.equal(params.subscription_data?.trial_period_days, TRIAL_DAYS);
  assert.equal(params.subscription_data?.trial_settings?.end_behavior?.missing_payment_method, "cancel");
  assert.equal(params.line_items?.[0]?.price_data?.unit_amount, PRO_MONTHLY_USD * 100);
  const paid = buildProCheckoutParams({
    email: "a@firm.com",
    userId: "user-1",
    customerId: "cus_1",
    trial: false,
    origin: "http://localhost:3000",
    surface: "memo",
  });
  assert.equal(paid.subscription_data?.trial_period_days, undefined);
  assert.equal(paid.customer, "cus_1");
  const report = buildReportCheckoutParams({
    email: "a@firm.com",
    userId: "user-1",
    customerId: null,
    geoid: "17031837800",
    origin: "http://localhost:3000",
    surface: "memo",
  });
  assert.equal(report.mode, "payment");
  assert.equal(report.metadata?.intent, "report");
});

test("a completed trial checkout records upgraded once", () => {
  const db = memoryDb();
  const now = new Date("2026-10-31T22:00:00.000Z");
  const { user } = createUser(db, "a@firm.com", "anon", now);
  const checkout = {
    id: "cs_test",
    mode: "subscription",
    status: "complete",
    paymentStatus: "no_payment_required",
    customerId: "cus_1",
    userId: user.id,
    intent: "pro",
    geoid: null,
    subscription: { id: "sub_1", status: "trialing", trialEnd: Math.floor(now.getTime() / 1000) + 7 * 86400, customerId: "cus_1" },
  };
  assert.equal(applyCompletedCheckout(db, checkout, now).applied, true);
  assert.equal(applyCompletedCheckout(db, checkout, now).applied, true);
  const events = db.prepare("SELECT name FROM events WHERE name = 'upgraded'").all() as { name: string }[];
  assert.equal(events.length, 1);
  const saved = db.prepare("SELECT plan, subscription_status FROM users WHERE id = ?").get(user.id) as {
    plan: string;
    subscription_status: string;
  };
  assert.equal(saved.plan, "trial");
  assert.equal(saved.subscription_status, "trialing");
});

test("a paid report unlocks that tract and does not grant Pro", () => {
  const db = memoryDb();
  const now = new Date("2026-10-31T22:00:00.000Z");
  const { user } = createUser(db, "a@firm.com", "anon", now);
  applyCompletedCheckout(
    db,
    {
      id: "cs_report",
      mode: "payment",
      status: "complete",
      paymentStatus: "paid",
      customerId: "cus_1",
      userId: user.id,
      intent: "report",
      geoid: tract.geoid,
      subscription: null,
    },
    now,
  );
  const row = db.prepare("SELECT plan FROM users WHERE id = ?").get(user.id) as { plan: string };
  assert.equal(row.plan, "free");
  const unlock = db.prepare("SELECT geoid FROM report_unlocks WHERE user_id = ?").get(user.id) as { geoid: string };
  assert.equal(unlock.geoid, tract.geoid);
});

test("trial reminder is queued inside two days and not before", async () => {
  const db = memoryDb();
  const now = new Date("2026-10-31T22:00:00.000Z");
  const soon = createUser(db, "soon@firm.com", "a", now).user;
  const later = createUser(db, "later@firm.com", "b", now).user;
  const trialEndSoon = new Date(now.getTime() + 36 * 60 * 60 * 1000).toISOString();
  const trialEndLater = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString();
  applySubscription(db, soon, { id: "sub_soon", status: "trialing", trialEnd: Math.floor(Date.parse(trialEndSoon) / 1000), customerId: "cus_s" }, now);
  applySubscription(db, later, { id: "sub_later", status: "trialing", trialEnd: Math.floor(Date.parse(trialEndLater) / 1000), customerId: "cus_l" }, now);
  const first = await sendDueTrialReminders(db, now, { accountUrl: "http://localhost:3000/account", from: "Emris <notices@emris.com>" });
  assert.equal(first.sent, 0);
  assert.equal(first.pending, 1);
  const second = await sendDueTrialReminders(db, now, { accountUrl: "http://localhost:3000/account", from: "Emris <notices@emris.com>" });
  assert.equal(second.pending, 1);
  const emails = db.prepare("SELECT to_email, body FROM emails").all() as { to_email: string; body: string }[];
  assert.equal(emails.length, 1);
  assert.equal(emails[0]?.to_email, "soon@firm.com");
  assert.match(emails[0]?.body ?? "", /\$249/);
  assert.match(emails[0]?.body ?? "", /cancel/i);
  const message = trialEndingEmail({ trialEndsAt: trialEndSoon, accountUrl: "http://localhost:3000/account" });
  assert.match(message.subject, /trial ends/);
});

test("subscription updates do not record a second upgrade", () => {
  const db = memoryDb();
  const now = new Date("2026-10-31T22:00:00.000Z");
  const { user } = createUser(db, "a@firm.com", "anon", now);
  const sub = { id: "sub_1", status: "trialing", trialEnd: Math.floor(now.getTime() / 1000) + 86400, customerId: "cus_1" };
  applySubscription(db, user, sub, now);
  applySubscription(db, { ...user, plan: "trial", subscriptionStatus: "trialing", stripeSubscriptionId: "sub_1" }, { ...sub, status: "active" }, now);
  const events = db.prepare("SELECT properties FROM events WHERE name = 'upgraded'").all() as { properties: string }[];
  assert.equal(events.length, 1);
  recordEvent(db, { name: "signup", userId: user.id });
  const signups = db.prepare("SELECT COUNT(*) AS n FROM events WHERE name = 'signup'").get() as { n: number };
  assert.equal(Number(signups.n), 2);
});
