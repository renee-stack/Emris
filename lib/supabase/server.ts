import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
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

export async function serverClient() {
  const env = supabaseEnv();
  if (!env) return null;
  const cookieStore = await cookies();
  return createServerClient(env.url, env.key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, cookieOptions(options));
          });
        } catch {
          // Server Components cannot set cookies. The proxy refreshes the session.
        }
      },
    },
  });
}
