import { connection } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { countActiveFounding } from "@/lib/billing/store";
import { foundingSpotsLeft } from "@/lib/billing/rules";
import { FOUNDING_SPOTS } from "@/lib/pricing";
import { jsonError } from "@/lib/billing/http";

export async function GET() {
  await connection();
  const admin = adminClient();
  if (!admin) return jsonError(500, "Billing isn't configured.", "internal");
  try {
    const active = await countActiveFounding(admin);
    const spotsLeft = foundingSpotsLeft(active);
    return Response.json({
      spots_left: spotsLeft,
      spots_total: FOUNDING_SPOTS,
      available: spotsLeft > 0,
    });
  } catch (error) {
    console.error(error);
    return jsonError(500, "Couldn't check founding spots.", "internal");
  }
}
