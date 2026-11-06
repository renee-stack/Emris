import { removeMember } from "@/lib/billing/team";
import { billingResponse, readJson, requireUser } from "@/lib/billing/http";

export async function DELETE(request: Request) {
  try {
    const body = await readJson(request);
    const userId = body && typeof body === "object" ? (body as { user_id?: unknown }).user_id : undefined;
    const { admin, user } = await requireUser();
    const view = await removeMember({ admin, user, userId });
    return Response.json(view);
  } catch (error) {
    return billingResponse(error);
  }
}
