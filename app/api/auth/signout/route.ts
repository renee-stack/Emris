import { requestUser } from "@/lib/auth/session";
import { serverClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const user = await requestUser();
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  let scope: "local" | "global" = "local";
  try {
    const body = (await req.json()) as { scope?: unknown };
    if (body.scope === "global") scope = "global";
  } catch {
    scope = "local";
  }
  const supabase = await serverClient();
  if (!supabase) return Response.json({ error: "Sign-in isn't configured." }, { status: 503 });
  const { error } = await supabase.auth.signOut({ scope });
  if (error) return Response.json({ error: "Couldn't sign out." }, { status: 400 });
  return Response.json({ ok: true });
}
