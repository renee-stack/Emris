import { startCheckout } from "@/lib/billing/checkout";
import { parseCheckoutBody } from "@/lib/billing/rules";
import { BillingError, appOrigin, billingResponse, readJson, requireUser } from "@/lib/billing/http";

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const parsed = parseCheckoutBody(body);
    if ("error" in parsed) throw new BillingError(parsed.error, 400, "bad_request");
    const { admin, user } = await requireUser();
    const url = await startCheckout({ admin, user, origin: appOrigin(request), body });
    return Response.json({ url });
  } catch (error) {
    return billingResponse(error);
  }
}
