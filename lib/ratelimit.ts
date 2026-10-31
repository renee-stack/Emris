// In-memory request limits for routes that call paid models. Server-only.
// Counters live per server instance (Vercel may run several), so this is a brake on abuse,
// not a hard cap. The hard cap is the monthly spend limit in the Anthropic console.

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

/** Records a hit. `ok` is false when the window is already full. */
export function take(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): { ok: boolean; resetAt: number } {
  const w = windows.get(key);
  if (!w || now >= w.resetAt) {
    const resetAt = now + windowMs;
    windows.set(key, { count: 1, resetAt });
    if (windows.size > 10_000) prune(now);
    return { ok: true, resetAt };
  }
  if (w.count >= limit) return { ok: false, resetAt: w.resetAt };
  w.count += 1;
  return { ok: true, resetAt: w.resetAt };
}

/** True if `key` is still under `limit` hits per `windowMs`; records the hit. */
export function allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  return take(key, limit, windowMs, now).ok;
}

function prune(now: number) {
  for (const [k, w] of windows) if (now >= w.resetAt) windows.delete(k);
}

/**
 * Client IP for rate limits. Prefer the platform's x-real-ip.
 * A caller can prepend x-forwarded-for, so the last hop is the one a proxy appended.
 */
export function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const parts = req.headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts && parts.length > 0) return parts[parts.length - 1];
  return "unknown";
}
