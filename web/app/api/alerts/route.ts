import { alertCreate, canUseAlerts } from "@/lib/access";
import { errorResponse, HttpError, readJson } from "@/lib/lookup";
import { getViewer, recordAlert } from "@/lib/viewer";

function areaId(body: unknown): string {
  if (!body || typeof body !== "object") throw new HttpError(400, "Body must include area_id.");
  const area = (body as { area_id?: unknown }).area_id;
  if (typeof area !== "string" || area.trim().length === 0 || area.trim().length > 200) {
    throw new HttpError(400, "area_id is required.");
  }
  return area.trim();
}

// GET /api/alerts — the watchlist allowance for this viewer.
export async function GET(req: Request) {
  try {
    const user = await getViewer(req);
    if (!user) throw new HttpError(401, "Sign in to use alerts.");
    return Response.json(canUseAlerts(user));
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/alerts — add one watchlist area when the plan allows it.
export async function POST(req: Request) {
  try {
    const area = areaId(await readJson(req));
    const user = await getViewer(req);
    const decision = alertCreate(user);
    if (!decision.allowed || !user) {
      if (decision.reason === "limit_reached") throw new HttpError(429, "Alert limit reached.");
      if (decision.reason === "payment_required") throw new HttpError(402, "Alerts are not included in this plan.");
      throw new HttpError(401, "Sign in to use alerts.");
    }
    await recordAlert(user, area);
    return Response.json({ ok: true, ...canUseAlerts(user) });
  } catch (err) {
    return errorResponse(err);
  }
}
