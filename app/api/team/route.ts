import { billingResponse, requireUser } from "@/lib/billing/http";
import { loadTeam } from "@/lib/billing/store";

export async function GET() {
  try {
    const { admin, user } = await requireUser();
    const team = await loadTeam(admin, user);
    return Response.json(team);
  } catch (error) {
    return billingResponse(error);
  }
}
