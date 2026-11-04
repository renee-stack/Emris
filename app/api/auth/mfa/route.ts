import { requestUser } from "@/lib/auth/session";
import { serverClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const user = await requestUser();
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  const supabase = await serverClient();
  if (!supabase) return Response.json({ error: "Sign-in isn't configured." }, { status: 503 });

  let body: { action?: unknown; factorId?: unknown; code?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }

  if (body.action === "enroll") {
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Emris",
    });
    if (error || !data) return Response.json({ error: "Couldn't start authenticator setup." }, { status: 400 });
    return Response.json({
      factorId: data.id,
      qr: data.totp.qr_code,
      secret: data.totp.secret,
    });
  }

  const factorId = typeof body.factorId === "string" ? body.factorId : "";
  if (!factorId) return Response.json({ error: "Missing authenticator." }, { status: 400 });

  if (body.action === "verify") {
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!/^\d{6}$/.test(code)) return Response.json({ error: "Enter the 6-digit code." }, { status: 400 });
    const challenge = await supabase.auth.mfa.challenge({ factorId });
    if (challenge.error || !challenge.data) {
      return Response.json({ error: "Couldn't check that code." }, { status: 400 });
    }
    const verified = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.data.id,
      code,
    });
    if (verified.error) return Response.json({ error: "That code didn't match." }, { status: 400 });
    return Response.json({ ok: true });
  }

  if (body.action === "unenroll") {
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) return Response.json({ error: "Couldn't remove the authenticator." }, { status: 400 });
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Unknown action." }, { status: 400 });
}
