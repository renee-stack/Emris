import "server-only";

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { sessionCookieOptions } from "@/lib/supabase/cookies";
import { supabaseEnv } from "@/lib/supabase/env";

/** Supabase client that writes session cookies onto this response. */
export function clientOnResponse(request: NextRequest, response: NextResponse) {
  const env = supabaseEnv();
  if (!env) return null;
  return createServerClient(env.url, env.key, {
    cookieOptions: sessionCookieOptions(),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, sessionCookieOptions(options));
        });
      },
    },
  });
}
