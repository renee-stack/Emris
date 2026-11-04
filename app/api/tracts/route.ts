import { requestUser } from "@/lib/auth/session";
import { getTracts } from "@/lib/data";
import { errorResponse } from "@/lib/lookup";

// GET /api/tracts — contract §2.1: the full tracts FeatureCollection, unchanged.
export async function GET() {
  try {
    const user = await requestUser();
    return Response.json(await getTracts(), {
      headers: { "x-emris-user": user ? "signed-in" : "signed-out" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
