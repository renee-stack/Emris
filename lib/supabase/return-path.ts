/** Same-origin map return path for the magic-link callback. */

const PLACE_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,80}$/;
const TRACT_RE = /^\d{11}$/;

export function mapReturnPath(placeId: string | null, tractId: string | null): string {
  const params = new URLSearchParams();
  if (placeId && PLACE_RE.test(placeId)) params.set("place", placeId);
  if (tractId && TRACT_RE.test(tractId)) params.set("tract", tractId);
  const query = params.toString();
  return query ? `/map?${query}` : "/map";
}

const ALLOWED_PATHS = new Set(["/map", "/onboarding", "/account", "/signin", "/pricing"]);

/**
 * Same-site path only. Map queries keep a place id and an 11-digit tract.
 * Anything else, including a host or a backslash, becomes `/map`.
 */
export function safeNextPath(value: string | null, origin: string): string {
  if (!value) return "/map";
  if (value.includes("\\") || /[\u0000-\u001F\u007F]/.test(value)) return "/map";
  if (!value.startsWith("/") || value.startsWith("//")) return "/map";
  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    return "/map";
  }
  if (url.origin !== origin || url.username || url.password) return "/map";
  if (url.pathname === "/map") return mapReturnPath(url.searchParams.get("place"), url.searchParams.get("tract"));
  if (ALLOWED_PATHS.has(url.pathname)) return url.pathname;
  return "/map";
}

/** Allow only `/map` on this origin, with a place id and an 11-digit tract. */
export function safeMapPath(value: string | null, origin: string): string {
  if (!value) return "/map";
  if (value.includes("\\") || /[\u0000-\u001F\u007F]/.test(value)) return "/map";
  if (!value.startsWith("/") || value.startsWith("//")) return "/map";
  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    return "/map";
  }
  if (url.origin !== origin || url.username || url.password) return "/map";
  if (url.pathname !== "/map") return "/map";
  return mapReturnPath(url.searchParams.get("place"), url.searchParams.get("tract"));
}
