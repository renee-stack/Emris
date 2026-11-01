import { randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  FREE_SEARCHES_PER_WEEK,
  SEARCH_REPEAT_MS,
  chicagoWeek,
  formatChicagoDate,
  normalizeQuery,
  type EventName,
  type Plan,
} from "./pure";

export interface User {
  id: string;
  email: string;
  plan: Plan;
  subscriptionStatus: string | null;
  trialEndsAt: string | null;
  trialReminderSentAt: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  onboardingCompletedAt: string | null;
  createdAt: string;
}

interface UserRow {
  id: string;
  email: string;
  plan: string;
  subscription_status: string | null;
  trial_ends_at: string | null;
  trial_reminder_sent_at: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  onboarding_completed_at: string | null;
  created_at: string;
}

function asPlan(value: string): Plan {
  return value === "trial" || value === "pro" ? value : "free";
}

function mapUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    plan: asPlan(row.plan),
    subscriptionStatus: row.subscription_status,
    trialEndsAt: row.trial_ends_at,
    trialReminderSentAt: row.trial_reminder_sent_at,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    onboardingCompletedAt: row.onboarding_completed_at,
    createdAt: row.created_at,
  };
}

export function healUser(db: DatabaseSync, user: User, now: Date): User {
  if (user.plan !== "trial" || !user.trialEndsAt || Date.parse(user.trialEndsAt) > now.getTime()) return user;
  if (user.subscriptionStatus != null && user.subscriptionStatus !== "trialing") return user;
  db.prepare("UPDATE users SET plan = 'free', subscription_status = 'canceled' WHERE id = ?").run(user.id);
  return { ...user, plan: "free", subscriptionStatus: "canceled" };
}

export function getUserById(db: DatabaseSync, id: string, now = new Date()): User | null {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  return row ? healUser(db, mapUser(row), now) : null;
}

export function getUserByEmail(db: DatabaseSync, email: string, now = new Date()): User | null {
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;
  return row ? healUser(db, mapUser(row), now) : null;
}

export function getUserBySession(db: DatabaseSync, sessionId: string, now = new Date()): User | null {
  const row = db.prepare(
    "SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.id = ?",
  ).get(sessionId) as UserRow | undefined;
  return row ? healUser(db, mapUser(row), now) : null;
}

export function getUserByCustomer(db: DatabaseSync, customerId: string, now = new Date()): User | null {
  const row = db.prepare("SELECT * FROM users WHERE stripe_customer_id = ?").get(customerId) as UserRow | undefined;
  return row ? healUser(db, mapUser(row), now) : null;
}

export function getUserBySubscription(db: DatabaseSync, subscriptionId: string, now = new Date()): User | null {
  const row = db.prepare("SELECT * FROM users WHERE stripe_subscription_id = ?").get(subscriptionId) as
    | UserRow
    | undefined;
  return row ? healUser(db, mapUser(row), now) : null;
}

export function recordEvent(
  db: DatabaseSync,
  event: {
    name: EventName;
    userId?: string | null;
    anonymousId?: string | null;
    properties?: Record<string, unknown>;
    at?: Date;
  },
): void {
  db.prepare(
    "INSERT INTO events (name, user_id, anonymous_id, properties, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(
    event.name,
    event.userId ?? null,
    event.anonymousId ?? null,
    JSON.stringify(event.properties ?? {}),
    (event.at ?? new Date()).toISOString(),
  );
}

export function hasEventKey(db: DatabaseSync, userId: string, name: EventName, key: string): boolean {
  const rows = db.prepare("SELECT properties FROM events WHERE name = ? AND user_id = ?").all(name, userId) as {
    properties: string;
  }[];
  return rows.some((row) => {
    try {
      return (JSON.parse(row.properties) as { key?: string }).key === key;
    } catch {
      return false;
    }
  });
}

/** Insert a free account, move this browser's search count onto it, and open a session. */
export function createUser(
  db: DatabaseSync,
  email: string,
  anonymousId: string,
  now = new Date(),
): { user: User; sessionId: string } {
  const id = randomUUID();
  const createdAt = now.toISOString();
  db.prepare("INSERT INTO users (id, email, plan, created_at) VALUES (?, ?, 'free', ?)").run(id, email, createdAt);
  db.prepare("UPDATE searches SET subject_id = ? WHERE subject_id = ?").run(id, anonymousId);
  const user: User = {
    id,
    email,
    plan: "free",
    subscriptionStatus: null,
    trialEndsAt: null,
    trialReminderSentAt: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    onboardingCompletedAt: null,
    createdAt,
  };
  recordEvent(db, {
    name: "signup",
    userId: id,
    anonymousId,
    at: now,
    properties: { source: "checkout" },
  });
  return { user, sessionId: createSession(db, id, now) };
}

export function createSession(db: DatabaseSync, userId: string, now = new Date()): string {
  const id = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (id, user_id, created_at) VALUES (?, ?, ?)").run(id, userId, now.toISOString());
  return id;
}

export function subjectId(user: User | null, anonymousId: string): string {
  return user?.id ?? anonymousId;
}

export interface SearchDecision {
  ok: boolean;
  duplicate: boolean;
  used: number;
  remaining: number;
  limit: number;
  resetsAt: string;
  resetsLabel: string;
}

function weekUsage(db: DatabaseSync, subject: string, now: Date): { used: number; reset: Date } {
  const week = chicagoWeek(now);
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM searches WHERE subject_id = ? AND created_at >= ? AND created_at < ?")
    .get(subject, week.start.toISOString(), week.reset.toISOString()) as { n: number };
  return { used: Number(row.n), reset: week.reset };
}

export function searchUsage(db: DatabaseSync, subject: string, now = new Date()): SearchDecision {
  const { used, reset } = weekUsage(db, subject, now);
  const remaining = Math.max(0, FREE_SEARCHES_PER_WEEK - used);
  return {
    ok: remaining > 0,
    duplicate: false,
    used,
    remaining,
    limit: FREE_SEARCHES_PER_WEEK,
    resetsAt: reset.toISOString(),
    resetsLabel: formatChicagoDate(reset, true),
  };
}

/** Counts a successful free search. A repeat of the same query inside a minute does not. */
export function consumeSearch(db: DatabaseSync, subject: string, query: string, now = new Date()): SearchDecision {
  const normalized = normalizeQuery(query);
  const week = chicagoWeek(now);
  db.exec("BEGIN IMMEDIATE");
  try {
    const recent = db
      .prepare("SELECT 1 AS hit FROM searches WHERE subject_id = ? AND query = ? AND created_at >= ? LIMIT 1")
      .get(subject, normalized, new Date(now.getTime() - SEARCH_REPEAT_MS).toISOString()) as { hit: number } | undefined;
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM searches WHERE subject_id = ? AND created_at >= ? AND created_at < ?")
      .get(subject, week.start.toISOString(), week.reset.toISOString()) as { n: number };
    const used = Number(row.n);
    const base = {
      limit: FREE_SEARCHES_PER_WEEK,
      resetsAt: week.reset.toISOString(),
      resetsLabel: formatChicagoDate(week.reset, true),
    };
    if (recent) {
      db.exec("COMMIT");
      return { ...base, ok: true, duplicate: true, used, remaining: Math.max(0, FREE_SEARCHES_PER_WEEK - used) };
    }
    if (used >= FREE_SEARCHES_PER_WEEK) {
      db.exec("COMMIT");
      return { ...base, ok: false, duplicate: false, used, remaining: 0 };
    }
    db.prepare("INSERT INTO searches (subject_id, query, created_at) VALUES (?, ?, ?)").run(
      subject,
      normalized,
      now.toISOString(),
    );
    db.exec("COMMIT");
    return { ...base, ok: true, duplicate: false, used: used + 1, remaining: FREE_SEARCHES_PER_WEEK - used - 1 };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function hasReport(db: DatabaseSync, userId: string, geoid: string): boolean {
  const row = db.prepare("SELECT 1 AS hit FROM report_unlocks WHERE user_id = ? AND geoid = ?").get(userId, geoid) as
    | { hit: number }
    | undefined;
  return Boolean(row);
}

export function unlockReport(db: DatabaseSync, userId: string, geoid: string, stripeSessionId: string, now = new Date()): void {
  db.prepare(
    "INSERT OR IGNORE INTO report_unlocks (user_id, geoid, stripe_session_id, created_at) VALUES (?, ?, ?, ?)",
  ).run(userId, geoid, stripeSessionId, now.toISOString());
}

export function updateSubscription(
  db: DatabaseSync,
  userId: string,
  fields: {
    plan: Plan;
    subscriptionStatus: string | null;
    trialEndsAt: string | null;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
  },
): void {
  db.prepare(
    `UPDATE users
     SET plan = ?, subscription_status = ?, trial_ends_at = ?, stripe_customer_id = ?, stripe_subscription_id = ?
     WHERE id = ?`,
  ).run(
    fields.plan,
    fields.subscriptionStatus,
    fields.trialEndsAt,
    fields.stripeCustomerId,
    fields.stripeSubscriptionId,
    userId,
  );
}

export function markOnboarding(db: DatabaseSync, userId: string, now = new Date()): boolean {
  const user = getUserById(db, userId, now);
  if (!user || user.onboardingCompletedAt) return false;
  db.prepare("UPDATE users SET onboarding_completed_at = ? WHERE id = ?").run(now.toISOString(), userId);
  recordEvent(db, { name: "onboarding_complete", userId, at: now });
  return true;
}

export interface EmailRow {
  id: number;
  user_id: string;
  kind: string;
  to_email: string;
  subject: string;
  body: string;
  status: string;
  error: string | null;
}

export function getEmail(db: DatabaseSync, userId: string, kind: string): EmailRow | null {
  return (db.prepare("SELECT * FROM emails WHERE user_id = ? AND kind = ?").get(userId, kind) as EmailRow | undefined) ?? null;
}

export function upsertEmail(
  db: DatabaseSync,
  row: { userId: string; kind: string; to: string; subject: string; body: string; status: string; error?: string | null; now?: Date },
): void {
  const now = (row.now ?? new Date()).toISOString();
  const existing = getEmail(db, row.userId, row.kind);
  if (!existing) {
    db.prepare(
      "INSERT INTO emails (user_id, kind, to_email, subject, body, status, error, created_at, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      row.userId,
      row.kind,
      row.to,
      row.subject,
      row.body,
      row.status,
      row.error ?? null,
      now,
      row.status === "sent" ? now : null,
    );
    return;
  }
  db.prepare("UPDATE emails SET subject = ?, body = ?, status = ?, error = ?, sent_at = ? WHERE id = ?").run(
    row.subject,
    row.body,
    row.status,
    row.error ?? null,
    row.status === "sent" ? now : existing.status === "sent" ? now : null,
    existing.id,
  );
}

export function markTrialReminderSent(db: DatabaseSync, userId: string, now = new Date()): void {
  db.prepare("UPDATE users SET trial_reminder_sent_at = ? WHERE id = ?").run(now.toISOString(), userId);
}

export function usersDueTrialReminder(db: DatabaseSync, now: Date): User[] {
  const start = now.toISOString();
  const end = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString();
  const rows = db
    .prepare(
      `SELECT * FROM users
       WHERE plan = 'trial'
         AND subscription_status = 'trialing'
         AND trial_reminder_sent_at IS NULL
         AND trial_ends_at IS NOT NULL
         AND trial_ends_at > ?
         AND trial_ends_at <= ?`,
    )
    .all(start, end) as UserRow[];
  return rows.map(mapUser);
}

