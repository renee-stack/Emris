import { assertIp } from "@/lib/auth/guard";
import { redactTract } from "@/lib/auth/redact";
import { viewer } from "@/lib/auth/viewer";
import { errorResponse, privateJson, tractDetail } from "@/lib/lookup";

// GET /api/tract/[geoid] — scores for everyone; permit and project rows require a session.
export async function GET(req: Request, { params }: { params: Promise<{ geoid: string }> }) {
  try {
    assertIp("tract:ip", 120, 60_000, req);
    const user = await viewer();
    const { geoid } = await params;
    const detail = await tractDetail(geoid);
    return privateJson(redactTract(detail, user !== null));
  } catch (err) {
    return errorResponse(err);
  }
}
