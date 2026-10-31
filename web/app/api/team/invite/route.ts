import { teamInvite } from "@/lib/access";
import { errorResponse, HttpError, readJson } from "@/lib/lookup";
import { getViewer } from "@/lib/viewer";

// POST /api/team/invite — seat check. The owner and each member share paid access.
export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const email = body && typeof body === "object" ? (body as { email?: unknown }).email : null;
    if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      throw new HttpError(400, "A valid email is required.");
    }
    const user = await getViewer(req);
    const decision = teamInvite(user);
    if (!decision.allowed) {
      if (decision.reason === "seat_cap") {
        throw new HttpError(409, "Team seat limit reached.", "seat_cap", {
          seat_limit: decision.seat_limit,
          seats_used: decision.seats_used,
        });
      }
      if (decision.reason === "payment_required") throw new HttpError(402, "Only a team owner can invite.");
      throw new HttpError(401, "Sign in to invite a teammate.");
    }
    return Response.json({
      ok: true,
      email: email.trim(),
      seat_limit: decision.seat_limit,
      seats_used: decision.seats_used,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
