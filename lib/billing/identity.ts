import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { DatabaseSync } from "node:sqlite";
import {
  effectivePlan,
  formatChicagoDate,
  hasProAccess,
  trialAvailable,
  type AccessLevel,
  type AccountSnapshot,
} from "./pure";
import { getUserBySession, hasReport, searchUsage, subjectId, type User } from "./store";

export const AID_COOKIE = "emris_aid";
export const SID_COOKIE = "emris_sid";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SID_RE = /^[0-9a-f]{64}$/i;

export interface CookieWrite {
  name: string;
  value: string;
  clear?: boolean;
}

export interface Identity {
  anonymousId: string;
  user: User | null;
  cookies: CookieWrite[];
}

const COOKIE_BASE = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 400,
};

export function resolveIdentity(
  db: DatabaseSync,
  input: { aid?: string | null; sid?: string | null },
  now = new Date(),
): Identity {
  const cookies: CookieWrite[] = [];
  let anonymousId = input.aid && UUID_RE.test(input.aid) ? input.aid : null;
  if (!anonymousId) {
    anonymousId = randomUUID();
    cookies.push({ name: AID_COOKIE, value: anonymousId });
  }
  let user: User | null = null;
  if (input.sid && SID_RE.test(input.sid)) {
    user = getUserBySession(db, input.sid, now);
    if (!user) cookies.push({ name: SID_COOKIE, value: "", clear: true });
  }
  return { anonymousId, user, cookies };
}

export function identityFrom(
  db: DatabaseSync,
  req: { cookies: { get(name: string): { value: string } | undefined } },
  now = new Date(),
): Identity {
  return resolveIdentity(
    db,
    { aid: req.cookies.get(AID_COOKIE)?.value ?? null, sid: req.cookies.get(SID_COOKIE)?.value ?? null },
    now,
  );
}

export function sessionCookie(sessionId: string): CookieWrite {
  return { name: SID_COOKIE, value: sessionId };
}

export function accessFor(db: DatabaseSync, identity: Identity, geoid: string, now = new Date()): AccessLevel {
  if (hasProAccess(identity.user, now)) return "full";
  if (identity.user && hasReport(db, identity.user.id, geoid)) return "full";
  return "preview";
}

export function accountSnapshot(db: DatabaseSync, identity: Identity, now = new Date()): AccountSnapshot {
  const plan = effectivePlan(identity.user, now);
  const usage =
    plan === "free" ? searchUsage(db, subjectId(identity.user, identity.anonymousId), now) : null;
  const trialEnds = identity.user?.trialEndsAt ?? null;
  return {
    plan,
    email: identity.user?.email ?? null,
    trial_ends_at: trialEnds,
    trial_ends_label: trialEnds ? formatChicagoDate(new Date(trialEnds)) : null,
    trial_available: trialAvailable(identity.user),
    has_billing: Boolean(identity.user?.stripeCustomerId),
    searches_limit: usage ? usage.limit : null,
    searches_remaining: usage ? usage.remaining : null,
    searches_resets_at: usage ? usage.resetsAt : null,
    searches_resets_label: usage ? usage.resetsLabel : null,
  };
}

export function applyCookies(res: NextResponse, cookies: CookieWrite[]): NextResponse {
  for (const cookie of cookies) {
    if (cookie.clear) res.cookies.set(cookie.name, "", { ...COOKIE_BASE, maxAge: 0 });
    else res.cookies.set(cookie.name, cookie.value, COOKIE_BASE);
  }
  return res;
}

export function jsonResponse(body: unknown, status = 200, cookies: CookieWrite[] = []): NextResponse {
  const res = NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
  return applyCookies(res, cookies);
}

export function withCookies(res: Response, cookies: CookieWrite[]): Response {
  if (cookies.length === 0) return res;
  const next = new NextResponse(res.body, { status: res.status, headers: res.headers });
  return applyCookies(next, cookies);
}
