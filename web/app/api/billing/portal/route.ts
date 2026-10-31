import { startPortal } from "@/lib/billing/checkout";
import { BillingError, appOrigin, billingResponse, readJson, requireUser } from "@/lib/billing/http";

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const flow =
      body && typeof body === "object" && (body as { flow?: unknown }).flow === "seats" ? "seats" : "billing";
    if (body && typeof body === "object" && "flow" in body) {
      const requested = (body as { flow?: unknown }).flow;
      if (requested !== undefined && requested !== "billing" && requested !== "seats") {
        throw new BillingError("Unknown portal flow.", 400, "bad_request");
      }
    }
    const { admin, user } = await requireUser();
    const url = await startPortal({ admin, user, origin: appOrigin(request), flow });
    return Response.json({ url });
  } catch (error) {
    return billingResponse(error);
  }
}
