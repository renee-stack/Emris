import {
  canStartFounding,
  canViewReport,
  getPlan,
  parsePlanRequest,
  parseReportRequest,
  PRO_TRIAL_DAYS,
  type AccessUser,
  type ReportType,
  type SubscriptionPlan,
} from "@/lib/access";
import { errorResponse, getTractFeature, HttpError, readJson } from "@/lib/lookup";
import { foundingCount, getViewer } from "@/lib/viewer";

const TEST_URL = "https://checkout.stripe.com/c/pay/cs_test_emris";

function originOf(req: Request): string {
  const configured = process.env.APP_BASE_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;
  return new URL(req.url).origin;
}

function priceFor(item: { report_type: ReportType } | { plan: SubscriptionPlan }): string {
  if ("plan" in item) {
    const key =
      item.plan === "pro" ? "STRIPE_PRICE_PRO" : item.plan === "founding" ? "STRIPE_PRICE_FOUNDING" : "STRIPE_PRICE_TEAM";
    const price = process.env[key]?.trim();
    if (!price) throw new HttpError(500, "Stripe price is not configured.");
    return price;
  }
  const specific =
    item.report_type === "area" ? process.env.STRIPE_PRICE_AREA_REPORT : process.env.STRIPE_PRICE_PROPERTY_REPORT;
  const price = specific?.trim() || process.env.STRIPE_PRICE_REPORT?.trim();
  if (!price) throw new HttpError(500, "Stripe price is not configured.");
  return price;
}

async function startCheckout(
  req: Request,
  user: AccessUser,
  item: { report_type: ReportType; target_id: string } | { plan: SubscriptionPlan },
): Promise<string> {
  if (process.env.EMRIS_TEST_ACCESS === "1") return TEST_URL;
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new HttpError(500, "Stripe is not configured.");
  const origin = originOf(req);
  const fields: Record<string, string> = {
    client_reference_id: user.id,
    "line_items[0][price]": priceFor(item),
    "line_items[0][quantity]": "1",
    success_url: `${origin}/map?checkout=success`,
    cancel_url: `${origin}/map?checkout=cancel`,
    "metadata[user_id]": user.id,
  };
  if ("plan" in item) {
    fields.mode = "subscription";
    fields["metadata[plan]"] = item.plan;
    fields["subscription_data[metadata][user_id]"] = user.id;
    fields["subscription_data[metadata][plan]"] = item.plan;
    if (item.plan === "pro") fields["subscription_data[trial_period_days]"] = String(PRO_TRIAL_DAYS);
  } else {
    fields.mode = "payment";
    fields["metadata[report_type]"] = item.report_type;
    fields["metadata[target_id]"] = item.target_id;
  }
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(fields),
  });
  const json = (await res.json()) as { url?: unknown };
  if (!res.ok || typeof json.url !== "string") throw new HttpError(500, "Could not start checkout.");
  return json.url;
}

// POST /api/checkout — Stripe Checkout, or 409 when the viewer already has access or founding is full.
export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const user = await getViewer(req);
    if (!user) throw new HttpError(401, "Sign in to checkout.");
    const report = parseReportRequest(body);
    const planName = parsePlanRequest(body);
    if (report && planName) throw new HttpError(400, "Send a report or a plan, not both.");
    if (!report && !planName) throw new HttpError(400, "Send a report or a plan.");

    if (report) {
      if (/^\d{11}$/.test(report.target_id)) {
        const feature = await getTractFeature(report.target_id);
        if (!feature) throw new HttpError(404, `Unknown tract ${report.target_id}`);
      }
      if (canViewReport(user, report.report_type, report.target_id)) {
        throw new HttpError(409, "You already have this report.");
      }
      const url = await startCheckout(req, user, report);
      return Response.json({ url });
    }

    if (getPlan(user).paid) throw new HttpError(409, "You already have a paid plan.");
    if (planName === "founding" && !canStartFounding(await foundingCount(req))) {
      throw new HttpError(409, "Founding membership is full.", "founding_cap");
    }
    const url = await startCheckout(req, user, { plan: planName! });
    return Response.json({ url });
  } catch (err) {
    return errorResponse(err);
  }
}
