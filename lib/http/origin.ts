/** Origin used for auth redirects. Ignores forwarded host headers. */
export function appOrigin(request: Request): string {
  const configured = (process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "").trim();
  if (configured) {
    try {
      const url = new URL(configured);
      const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
      if (url.protocol === "https:" || local) return url.origin;
    } catch {
      // Ignore a malformed base URL and use the request URL.
    }
  }
  return new URL(request.url).origin;
}
