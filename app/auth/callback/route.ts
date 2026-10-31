import { NextResponse, type NextRequest } from "next/server";
import { appOrigin } from "@/lib/http/origin";
import { clientIp, take } from "@/lib/ratelimit";
import { clientOnResponse } from "@/lib/supabase/response-client";
import { safeMapPath } from "@/lib/supabase/return-path";
import type { EmailOtpType } from "@supabase/supabase-js";

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

export async function GET(request: NextRequest) {
  const limited = take(`auth:callback:${clientIp(request)}`, 30, 60 * 60 * 1000);
  const origin = appOrigin(request);
  const destination = new URL(safeMapPath(request.nextUrl.searchParams.get("next"), origin), origin);
  const response = NextResponse.redirect(destination);
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Cache-Control", "private, no-store");
  if (!limited.ok) return response;

  const supabase = clientOnResponse(request, response);
  if (!supabase) return response;

  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = emailType(request.nextUrl.searchParams.get("type"));
  if (code) {
    await supabase.auth.exchangeCodeForSession(code);
  } else if (tokenHash && type) {
    await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  }
  return response;
}
