import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Service-role client. Server routes only. Never import this from a client component. */
export function adminClient(): SupabaseClient | null {
  if (typeof window !== "undefined") {
    throw new Error("The service role client cannot run in the browser.");
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
