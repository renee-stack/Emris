import { serverClient } from "@/lib/supabase/server";
import { adminClient, type AdminClient } from "@/lib/supabase/admin";
import { BillingError } from "@/lib/billing/errors";
import { ensureUser, type UserRow } from "@/lib/billing/store";

export { BillingError, billingResponse, jsonError } from "@/lib/billing/errors";

export function appOrigin(request: Request): string {
  const configured = (process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL)?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}

export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BillingError("Request body must be JSON.", 400, "bad_request");
  }
}

export type AccountGate =
  | { kind: "unconfigured" }
  | { kind: "signed_out" }
  | { kind: "ready"; admin: AdminClient; user: UserRow };

export async function accountGate(): Promise<AccountGate> {
  const supabase = await serverClient();
  if (!supabase) return { kind: "unconfigured" };
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { kind: "signed_out" };
  const admin = adminClient();
  if (!admin) return { kind: "unconfigured" };
  const user = await ensureUser(admin, data.user);
  return { kind: "ready", admin, user };
}

export async function requireUser(): Promise<{ admin: AdminClient; user: UserRow }> {
  const gate = await accountGate();
  if (gate.kind === "signed_out") throw new BillingError("Sign in required.", 401, "auth_required");
  if (gate.kind === "unconfigured") throw new BillingError("Billing isn't configured.", 500, "internal");
  return { admin: gate.admin, user: gate.user };
}
