import "server-only";

import { viewer, type Viewer } from "@/lib/auth/viewer";
import { HttpError } from "@/lib/lookup";
import { clientIp, take } from "@/lib/ratelimit";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const FREE_SEARCHES_PER_WEEK = 3;

export async function requireUser(): Promise<Viewer> {
  const user = await viewer();
  if (!user) throw new HttpError(401, "Sign in required.");
  return user;
}

export function assertRate(key: string, limit: number, windowMs: number): void {
  const hit = take(key, limit, windowMs);
  if (!hit.ok) {
    throw new HttpError(429, "Too many requests. Try again later.", new Date(hit.resetAt).toISOString());
  }
}

export function assertIp(bucket: string, limit: number, windowMs: number, req: Request): void {
  assertRate(`${bucket}:${clientIp(req)}`, limit, windowMs);
}

/** Free accounts get 3 searches a week. The allowance is not taken from the request. */
export function assertFreeSearch(user: Viewer): void {
  if (user.plan !== "free") throw new HttpError(403, "Sign in required.");
  const hit = take(`near:week:${user.id}`, FREE_SEARCHES_PER_WEEK, WEEK_MS);
  if (!hit.ok) {
    throw new HttpError(
      429,
      "You've used your 3 free searches this week.",
      new Date(hit.resetAt).toISOString(),
    );
  }
}
