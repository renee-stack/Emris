import { NextResponse, type NextRequest } from "next/server";
import { clientOnResponse } from "@/lib/supabase/response-client";

export async function POST(request: NextRequest) {
  const response = NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } },
  );
  const supabase = clientOnResponse(request, response);
  if (supabase) await supabase.auth.signOut();
  return response;
}
