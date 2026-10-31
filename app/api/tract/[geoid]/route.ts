import { requestUser } from "@/lib/auth/session";
import { errorResponse, tractDetail } from "@/lib/lookup";

// GET /api/tract/[geoid] — contract §2.2.
export async function GET(_req: Request, { params }: { params: Promise<{ geoid: string }> }) {
  try {
    const user = await requestUser();
    const { geoid } = await params;
    return Response.json(await tractDetail(geoid), {
      headers: { "x-emris-user": user ? "signed-in" : "signed-out" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
