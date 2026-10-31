import { requestUser } from "@/lib/auth/session";
import { adminClient } from "@/lib/supabase/admin";

export async function DELETE(req: Request) {
  const user = await requestUser();
  if (!user?.email) return Response.json({ error: "Sign in required." }, { status: 401 });
  let confirm = "";
  try {
    const body = (await req.json()) as { confirm?: unknown };
    confirm = typeof body.confirm === "string" ? body.confirm.trim().toLowerCase() : "";
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }
  if (confirm !== user.email.toLowerCase()) {
    return Response.json({ error: "Type your email to confirm." }, { status: 400 });
  }
  const admin = adminClient();
  if (!admin) return Response.json({ error: "Account deletion isn't configured." }, { status: 503 });
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return Response.json({ error: "Couldn't delete the account." }, { status: 400 });
  await admin.from("users").delete().eq("id", user.id);
  return Response.json({ ok: true });
}
