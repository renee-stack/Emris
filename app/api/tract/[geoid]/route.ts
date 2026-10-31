import { errorResponse, tractDetail } from "@/lib/lookup";

// GET /api/tract/[geoid] — contract §2.2.
export async function GET(_req: Request, { params }: { params: Promise<{ geoid: string }> }) {
  try {
    const { geoid } = await params;
    return Response.json(await tractDetail(geoid));
  } catch (err) {
    return errorResponse(err);
  }
}
