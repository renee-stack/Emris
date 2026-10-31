import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { safeMapPath } from "@/lib/supabase/return-path";
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

function redirectTo(requestUrl: URL, next: string | null) {
  const destination = new URL(safeMapPath(next, requestUrl.origin), requestUrl.origin);
  const response = NextResponse.redirect(destination);
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const destination = redirectTo(url, url.searchParams.get("next"));
  const supabase = await serverClient();
  if (!supabase) return destination;

  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = emailType(url.searchParams.get("type"));

  if (code) {
    await supabase.auth.exchangeCodeForSession(code);
  } else if (tokenHash && type) {
    await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  }

  return destination;
}
