import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { landingDestination } from "@/lib/supabase/return-path";
import { updateSession } from "@/lib/supabase/update-session";

const PRIVATE_FILES = new Set(["/permits.json", "/infrastructure.json"]);

export async function proxy(request: NextRequest) {
  const url = request.nextUrl;

  if (PRIVATE_FILES.has(url.pathname)) {
    return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const landing = landingDestination(url);
  if (landing) return NextResponse.redirect(landing);

  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|json|geojson|mjs|ico)$).*)",
    "/permits.json",
    "/infrastructure.json",
  ],
};
