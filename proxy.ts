import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/update-session";

export async function proxy(request: NextRequest) {
  const url = request.nextUrl;

  if (url.pathname === "/landing" || url.pathname.startsWith("/landing/")) {
    const next = url.clone();
    next.pathname = url.pathname === "/landing" ? "/" : url.pathname.slice("/landing".length);
    return NextResponse.redirect(next);
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|json|geojson|mjs|ico)$).*)",
  ],
};
