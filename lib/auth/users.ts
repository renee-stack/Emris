import { adminClient } from "@/lib/supabase/admin";

/** Create the users row on first sign-in. Later sign-ins only refresh the email. */
export async function ensureUser(id: string, email: string | null): Promise<boolean> {
  const admin = adminClient();
  if (!admin) return false;
  const { error } = await admin.from("users").upsert({ id, email }, { onConflict: "id" });
  return !error;
}
