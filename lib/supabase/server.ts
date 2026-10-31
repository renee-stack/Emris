import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { sessionCookieOptions } from "@/lib/supabase/cookie-options";
import { supabaseEnv } from "@/lib/supabase/env";

async function secureRequest(): Promise<boolean> {
  try {
    const headerStore = await headers();
    const proto = headerStore.get("x-forwarded-proto")?.split(",")[0]?.trim();
    if (proto === "https") return true;
    if (proto === "http") return false;
  } catch {
    // headers() is unavailable outside a request.
  }
  return process.env.NODE_ENV === "production";
}

export async function serverClient() {
  const env = supabaseEnv();
  if (!env) return null;
  const cookieStore = await cookies();
  const secure = await secureRequest();
  return createServerClient(env.url, env.key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, sessionCookieOptions(options, secure));
          });
        } catch {
          // Server Components cannot set cookies. The proxy refreshes the session.
        }
      },
    },
  });
}
