import { cookies } from "next/headers";
import { adminClient } from "@/lib/supabase/admin";
import { serverClient } from "@/lib/supabase/server";
import { pricing } from "@/lib/pricing";

export interface SessionUser {
  id: string;
  email: string | null;
}

/** The signed-in user from the session cookie. Ignores any id sent by the browser. */
export async function requestUser(): Promise<SessionUser | null> {
  await cookies();
  const supabase = await serverClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

export async function accountPlan(userId: string): Promise<string> {
  const admin = adminClient();
  if (!admin) return pricing.plans.free.name;
  const { data, error } = await admin.from("users").select("plan, founding_member").eq("id", userId).maybeSingle();
  if (error || !data) return pricing.plans.free.name;
  const plan = typeof data.plan === "string" ? data.plan : "free";
  if (plan === "team") return pricing.plans.team.name;
  if (plan === "pro" && data.founding_member === true) return pricing.plans.founding.name;
  if (plan === "pro") return pricing.plans.pro.name;
  return pricing.plans.free.name;
}

export async function paidPlan(userId: string): Promise<boolean> {
  const admin = adminClient();
  if (!admin) return false;
  const { data, error } = await admin.from("users").select("plan").eq("id", userId).maybeSingle();
  if (error || !data) return false;
  return data.plan === "pro" || data.plan === "team";
}
