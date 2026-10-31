"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseEnv } from "@/lib/supabase/env";

export function browserClient(): SupabaseClient | null {
  const env = supabaseEnv();
  if (!env) return null;
  return createBrowserClient(env.url, env.key);
}
