import { connection } from "next/server";
import { errorResponse } from "@/lib/lookup";
import { listPlaces } from "@/lib/markets";

// GET /api/places — areas named in the tract file, with bounds for the map.
export async function GET() {
  try {
    await connection();
    return Response.json({ places: await listPlaces() });
  } catch (err) {
    return errorResponse(err);
  }
}
