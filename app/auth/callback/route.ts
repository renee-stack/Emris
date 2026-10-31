import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { ensureUser } from "@/lib/auth/users";
import { readProfile } from "@/lib/onboarding/profile";
import { safeNextPath } from "@/lib/supabase/return-path";
import { serverClient } from "@/lib/supabase/server";

function emailType(value: string | null): EmailOtpType | null {
  if (
    value === "signup" ||
    value === "invite" ||
    value === "magiclink" ||
    value === "recovery" ||
    value === "email" ||
    value === "email_change"
  ) {
    return value;
  }
  return null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get("next"), url.origin);
  const supabase = await serverClient();
  let destination = next;

  if (supabase) {
    const code = url.searchParams.get("code");
    const tokenHash = url.searchParams.get("token_hash");
    const type = emailType(url.searchParams.get("type"));
    if (code) await supabase.auth.exchangeCodeForSession(code);
    else if (tokenHash && type) await supabase.auth.verifyOtp({ token_hash: tokenHash, type });

    const { data } = await supabase.auth.getUser();
    const user = data.user;
    if (user) {
      await ensureUser(user.id, user.email ?? null);
      const profile = await readProfile(user.id);
      if (!profile?.onboarded_at) {
        const onboarding = new URL("/onboarding", url.origin);
        onboarding.searchParams.set("next", next);
        destination = `${onboarding.pathname}${onboarding.search}`;
      }
    }
  }

  const response = NextResponse.redirect(new URL(destination, url.origin));
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
