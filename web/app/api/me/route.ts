import {
  canExport,
  canSearch,
  canSeeRehabNames,
  canUseAlerts,
  FOUNDING_CAP,
  FREE_ALERT_LIMIT,
  FREE_SEARCH_LIMIT,
  getPlan,
  PAYMENT_GRACE_DAYS,
  PRO_TRIAL_DAYS,
  DEFAULT_TEAM_SEATS,
  SEARCH_WINDOW_DAYS,
} from "@/lib/access";
import { errorResponse } from "@/lib/lookup";
import { getViewer } from "@/lib/viewer";

// GET /api/me — the viewer's plan, computed only by the access rules.
export async function GET(req: Request) {
  try {
    const user = await getViewer(req);
    const plan = getPlan(user);
    return Response.json({
      plan: plan.kind,
      paid: plan.paid,
      search: canSearch(user),
      rehab_names: canSeeRehabNames(user),
      export: canExport(user),
      alerts: canUseAlerts(user),
      entitlements: plan.entitlements,
      limits: {
        free_searches: FREE_SEARCH_LIMIT,
        search_window_days: SEARCH_WINDOW_DAYS,
        free_alerts: FREE_ALERT_LIMIT,
        grace_days: PAYMENT_GRACE_DAYS,
        founding_cap: FOUNDING_CAP,
        team_seats: DEFAULT_TEAM_SEATS,
        pro_trial_days: PRO_TRIAL_DAYS,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
