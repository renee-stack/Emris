import { NextResponse, type NextRequest } from "next/server";
import { appOrigin } from "@/lib/http/origin";
import { privateJson } from "@/lib/lookup";
import { clientIp, take } from "@/lib/ratelimit";
import { clientOnResponse } from "@/lib/supabase/response-client";
import { safeMapPath } from "@/lib/supabase/return-path";

const HOUR = 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function tooMany(resetAt: number) {
  const resets = new Date(resetAt).toISOString();
  return privateJson(
    { error: "Too many sign-in attempts. Try again later.", resets },
    429,
    { "x-ratelimit-reset": String(Math.floor(resetAt / 1000)) },
  );
}

export async function POST(request: NextRequest) {
  const ipHit = take(`auth:ip:${clientIp(request)}`, 20, HOUR);
  if (!ipHit.ok) return tooMany(ipHit.resetAt);

  let raw = "";
  try {
    raw = await request.text();
  } catch {
    return privateJson({ error: "Bad request." }, 400);
  }
  if (raw.length > 4_096) return privateJson({ error: "Bad request." }, 413);

  let email = "";
  let next: string | null = null;
  try {
    const body = JSON.parse(raw) as { email?: unknown; next?: unknown };
    email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    next = typeof body.next === "string" ? body.next : null;
  } catch {
    return privateJson({ error: "Bad request." }, 400);
  }
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return privateJson({ error: "Enter a valid email." }, 400);
  }

  const emailHit = take(`auth:email:${email}`, 5, HOUR);
  if (!emailHit.ok) return tooMany(emailHit.resetAt);

  const response = NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } },
  );
  const supabase = clientOnResponse(request, response);
  if (!supabase) return privateJson({ error: "Sign-in isn't configured." }, 503);

  const origin = appOrigin(request);
  const path = safeMapPath(next, origin);
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(path)}` },
  });
  if (error) {
    console.error("magic-link", error.status ?? "", error.code ?? "");
    return privateJson({ error: "Couldn't send the sign-in link." }, 400);
  }
  return response;
}
