import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";

function nextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return "/map";
  }
  return value;
}

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
  const destination = new URL(nextPath(url.searchParams.get("next")), url.origin);
  const supabase = await serverClient();
  if (!supabase) return NextResponse.redirect(destination);

  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = emailType(url.searchParams.get("type"));

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(destination);
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(destination);
  }

  return NextResponse.redirect(destination);
}
