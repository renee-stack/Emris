import { acceptInvite } from "@/lib/billing/team";
import { billingResponse, readJson, requireUser } from "@/lib/billing/http";

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const token = body && typeof body === "object" ? (body as { token?: unknown }).token : undefined;
    const { admin, user } = await requireUser();
    const view = await acceptInvite({ admin, user, token });
    return Response.json(view);
  } catch (error) {
    return billingResponse(error);
  }
}
