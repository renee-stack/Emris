import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function isDeepLink(url: URL): boolean {
  const tract = url.searchParams.get("tract");
  if (tract && /^\d{11}$/.test(tract)) return true;
  const lat = url.searchParams.get("lat");
  const lng = url.searchParams.get("lng");
  if (lat == null || lng == null || lat.trim() === "" || lng.trim() === "") return false;
  return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
}

export function proxy(request: NextRequest) {
  const url = request.nextUrl;

  if (url.pathname === "/landing" || url.pathname.startsWith("/landing/")) {
    const next = url.clone();
    next.pathname = url.pathname === "/landing" ? "/" : url.pathname.slice("/landing".length);
    return NextResponse.redirect(next);
  }

  if (url.pathname === "/" && isDeepLink(url)) {
    const mapUrl = url.clone();
    mapUrl.pathname = "/map";
    return NextResponse.redirect(mapUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/landing", "/landing/:path*"],
};
