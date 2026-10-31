import { getTracts } from "@/lib/data";
import { errorResponse } from "@/lib/lookup";

// GET /api/tracts — contract §2.1: the full tracts FeatureCollection, unchanged.
export async function GET() {
  try {
    return Response.json(await getTracts());
  } catch (err) {
    return errorResponse(err);
  }
}
