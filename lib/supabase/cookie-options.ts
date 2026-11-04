import type { CookieOptions } from "@supabase/ssr";

/** Session cookies stay on this site, are not readable by page scripts, and are Secure on HTTPS. */
export function sessionCookieOptions(options: CookieOptions, secure: boolean) {
  const sameSite =
    options.sameSite === true ? "strict" : options.sameSite === false ? "lax" : options.sameSite;
  return {
    domain: options.domain,
    expires: options.expires,
    httpOnly: true,
    maxAge: options.maxAge,
    path: options.path || "/",
    sameSite: sameSite ?? "lax",
    secure,
    partitioned: options.partitioned,
  };
}
