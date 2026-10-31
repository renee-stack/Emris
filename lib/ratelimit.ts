// In-memory request limits for routes that call paid models. Server-only.
// Counters live per server instance (Vercel may run several), so this is a brake on abuse,
// not a hard cap. The hard cap is the monthly spend limit in the Anthropic console.

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

/** True if `key` is still under `limit` hits per `windowMs`; records the hit. */
export function allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const w = windows.get(key);
  if (!w || now >= w.resetAt) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    if (windows.size > 10_000) prune(now);
    return true;
  }
  if (w.count >= limit) return false;
  w.count += 1;
  return true;
}

function prune(now: number) {
  for (const [k, w] of windows) if (now >= w.resetAt) windows.delete(k);
}

/** Best-effort client IP (Vercel sets x-forwarded-for; first entry is the client). */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}
