import { billingConfig } from "@/lib/billing/config";

/** Ops-only: which billing env pieces are present. No secret values. */
export async function GET() {
  const config = billingConfig();
  return Response.json({
    ready: config.ready,
    supabase: config.supabasePublic && config.supabaseAdmin,
    stripe: config.stripe,
    webhook: config.webhook,
  });
}
