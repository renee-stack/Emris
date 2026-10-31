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

/** `/landing` and `/landing/...` become a same-origin path. Anything else is `/`. */
export function pathAfterLanding(pathname: string): string {
  if (pathname === "/landing") return "/";
  if (!pathname.startsWith("/landing/")) return "/";
  const rest = pathname.slice("/landing".length);
  if (!isSameOriginPath(rest)) return "/";
  return rest;
}

export function landingDestination(requestUrl: URL): URL | null {
  if (requestUrl.pathname !== "/landing" && !requestUrl.pathname.startsWith("/landing/")) return null;
  const next = new URL(requestUrl.href);
  next.pathname = pathAfterLanding(requestUrl.pathname);
  if (next.origin !== requestUrl.origin || next.username || next.password) {
    next.pathname = "/";
    next.search = "";
    next.username = "";
    next.password = "";
  }
  return next;
}

function isSameOriginPath(value: string): boolean {
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  if (value.includes("\\") || value.includes("://") || /[\u0000-\u001F\u007F]/.test(value)) return false;
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded.startsWith("/") || decoded.startsWith("//")) return false;
    if (decoded.includes("\\") || decoded.includes("://") || /[\u0000-\u001F\u007F]/.test(decoded)) return false;
  } catch {
    return false;
  }
  return true;
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
