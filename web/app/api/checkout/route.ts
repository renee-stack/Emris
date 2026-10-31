import { startCheckout } from "@/lib/billing/checkout";
import { parseCheckoutBody } from "@/lib/billing/rules";
import { BillingError, appOrigin, billingResponse, readJson, requireUser } from "@/lib/billing/http";

/** Contract checkout for one-off reports. Subscriptions use /api/billing/checkout. */
export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    if (!body || typeof body !== "object") {
      throw new BillingError("Request body must be an object.", 400, "bad_request");
    }
    const record = body as Record<string, unknown>;
    const reportType = record.report_type;
    const plan = reportType === "area" ? "area_report" : reportType === "property" ? "property_report" : null;
    if (!plan) throw new BillingError("Unknown report type.", 400, "bad_request");
    const parsed = parseCheckoutBody({ plan, target_id: record.target_id });
    if ("error" in parsed) throw new BillingError(parsed.error, 400, "bad_request");
    const { admin, user } = await requireUser();
    const url = await startCheckout({
      admin,
      user,
      origin: appOrigin(request),
      body: { plan, target_id: record.target_id },
    });
    return Response.json({ url });
  } catch (error) {
    return billingResponse(error);
  }
}
