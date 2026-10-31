import { inviteMember } from "@/lib/billing/team";
import { appOrigin, billingResponse, readJson, requireUser } from "@/lib/billing/http";

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const email = body && typeof body === "object" ? (body as { email?: unknown }).email : undefined;
    const { admin, user } = await requireUser();
    const result = await inviteMember({ admin, user, origin: appOrigin(request), email });
    return Response.json(result);
  } catch (error) {
    return billingResponse(error);
  }
}
