import type { CookieOptions } from "@supabase/ssr";

/** Session cookies are not readable from JavaScript. */
export function sessionCookieOptions(options: CookieOptions = {}): CookieOptions {
  return {
    ...options,
    path: options.path ?? "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  };
}
