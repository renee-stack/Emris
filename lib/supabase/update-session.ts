import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseEnv } from "@/lib/supabase/env";

function cookieOptions(options: CookieOptions) {
  const sameSite =
    options.sameSite === true ? "strict" : options.sameSite === false ? "lax" : options.sameSite;
  return {
    domain: options.domain,
    expires: options.expires,
    httpOnly: options.httpOnly,
    maxAge: options.maxAge,
    path: options.path,
    sameSite,
    secure: options.secure,
    partitioned: options.partitioned,
  };
}

/** Refresh the Supabase session cookie. No-ops when auth is not configured. */
export async function updateSession(request: NextRequest) {
  const env = supabaseEnv();
  if (!env) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  try {
    const supabase = createServerClient(env.url, env.key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, cookieOptions(options));
          });
          Object.entries(headers).forEach(([key, value]) => {
            response.headers.set(key, value);
          });
        },
      },
    });
    await supabase.auth.getClaims();
  } catch {
    return NextResponse.next({ request });
  }
  return response;
}
