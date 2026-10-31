import { supabaseEnv } from "@/lib/supabase/env";
import { safeNextPath } from "@/lib/supabase/return-path";
import { createClient } from "@supabase/supabase-js";
import { allow, clientIp } from "@/lib/ratelimit";

const HOUR = 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  const env = supabaseEnv();
  if (!env) return Response.json({ error: "Sign-in isn't configured." }, { status: 503 });

  let body: { email?: unknown; next?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email) || email.length > 320) {
    return Response.json({ error: "Enter a valid email." }, { status: 400 });
  }

  const ip = clientIp(req);
  if (!allow(`signin:ip:${ip}`, 20, HOUR) || !allow(`signin:email:${email}`, 5, HOUR)) {
    return Response.json({ error: "Too many sign-in emails. Try again in an hour." }, { status: 429 });
  }

  const origin = new URL(req.url).origin;
  const next = safeNextPath(typeof body.next === "string" ? body.next : null, origin);
  const supabase = createClient(env.url, env.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) return Response.json({ error: "Couldn't send a sign-in link." }, { status: 400 });
  return Response.json({ ok: true });
}
