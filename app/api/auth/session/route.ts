import { connection } from "next/server";
import { accountPlan, requestUser } from "@/lib/auth/session";
import { readProfile } from "@/lib/onboarding/profile";
import { serverClient } from "@/lib/supabase/server";

export async function GET() {
  await connection();
  const user = await requestUser();
  if (!user) return Response.json({ user: null });
  const supabase = await serverClient();
  const factors = supabase ? await supabase.auth.mfa.listFactors() : null;
  const verified = factors?.data?.totp?.filter((factor) => factor.status === "verified") ?? [];
  const profile = await readProfile(user.id);
  return Response.json({
    user: {
      email: user.email,
      plan: await accountPlan(user.id),
      onboarded: Boolean(profile?.onboarded_at),
      totp: verified.length > 0,
    },
  });
}
