import { NextResponse } from "next/server";
import { allow, clientIp } from "@/lib/ratelimit";
import { safeNextPath } from "@/lib/supabase/return-path";
import { serverClient } from "@/lib/supabase/server";

const HOUR = 60 * 60 * 1000;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get("next"), url.origin);
  const signin = new URL("/signin", url.origin);
  signin.searchParams.set("next", next);

  if (!allow(`signin:ip:${clientIp(request)}`, 20, HOUR)) {
    signin.searchParams.set("error", "rate");
    return NextResponse.redirect(signin);
  }

  const supabase = await serverClient();
  if (!supabase) {
    signin.searchParams.set("error", "unconfigured");
    return NextResponse.redirect(signin);
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${url.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      skipBrowserRedirect: true,
    },
  });
  if (error || !data.url) {
    signin.searchParams.set("error", "google");
    return NextResponse.redirect(signin);
  }
  return NextResponse.redirect(data.url);
}
