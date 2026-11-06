import { adminClient } from "@/lib/supabase/admin";
import { supabaseEnv } from "@/lib/supabase/env";
import { getStripe } from "@/lib/billing/stripe";

/** Which billing dependencies are present. Never includes secret values. */
export function billingConfig() {
  const supabasePublic = Boolean(supabaseEnv());
  const supabaseAdmin = Boolean(adminClient());
  const stripe = Boolean(getStripe());
  const webhook = Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim());
  return {
    supabasePublic,
    supabaseAdmin,
    stripe,
    webhook,
    ready: supabasePublic && supabaseAdmin && stripe,
  };
}
