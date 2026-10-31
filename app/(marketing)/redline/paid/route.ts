import type { NextRequest } from "next/server";

// Stripe's Payment Link sends the buyer here. The service checks the session with Stripe,
// so this URL can't unlock anything by itself.
export async function GET(request: NextRequest) {
  const fail = new URL("/redline?payment=failed", request.url);
  const base = process.env.REDLINE_API_URL;
  const key = process.env.REDLINE_API_KEY;
  const session = request.nextUrl.searchParams.get("session_id") ?? "";
  if (!base || !key || !session) return Response.redirect(fail);
  const res = await fetch(`${base}/api/paid?session_id=${encodeURIComponent(session)}`, { cache: "no-store", headers: { "x-redline-key": key } }).catch(() => null);
  const data = res?.ok ? ((await res.json()) as { report_id?: string }) : null;
  return Response.redirect(data?.report_id ? new URL(`/redline/r/${data.report_id}`, request.url) : fail);
}
