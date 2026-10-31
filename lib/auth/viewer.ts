import "server-only";

import { cookies } from "next/headers";
import { serverClient } from "@/lib/supabase/server";

export interface Viewer {
  id: string;
  email: string | null;
  /** There is no billing table. A signed-in user is free. */
  plan: "free";
}

function hasSessionCookie(names: string[]): boolean {
  return names.some(
    (name) =>
      name.includes("auth-token") &&
      !name.includes("code-verifier") &&
      !name.includes("-flow-"),
  );
}

/**
 * User from the session cookie, checked with the auth server.
 * Request body and query fields are not an identity.
 */
export async function viewer(): Promise<Viewer | null> {
  const cookieStore = await cookies();
  if (!hasSessionCookie(cookieStore.getAll().map((cookie) => cookie.name))) return null;
  const supabase = await serverClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.id) return null;
  return { id: data.user.id, email: data.user.email ?? null, plan: "free" };
}
