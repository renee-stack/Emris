import { io } from "next/cache";
import type { NextRequest } from "next/server";
import { getDb } from "@/lib/billing/db";
import { accountSnapshot, identityFrom, jsonResponse, withCookies } from "@/lib/billing/identity";
import { errorResponse } from "@/lib/lookup";

export async function GET(req: NextRequest) {
  await io();
  const db = getDb();
  const identity = identityFrom(db, req);
  try {
    return jsonResponse(accountSnapshot(db, identity), 200, identity.cookies);
  } catch (err) {
    return withCookies(errorResponse(err), identity.cookies);
  }
}
