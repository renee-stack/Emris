import { connection } from "next/server";
import { assertIp } from "@/lib/auth/guard";
import { viewer } from "@/lib/auth/viewer";
import { getTracts } from "@/lib/data";
import { errorResponse, privateJson } from "@/lib/lookup";

// GET /api/tracts — free score collection. Permit rows are not in this payload.
export async function GET(req: Request) {
  await connection();
  try {
    assertIp("tracts:ip", 60, 60_000, req);
    await viewer();
    return privateJson(await getTracts());
  } catch (err) {
    return errorResponse(err);
  }
}
