import { io } from "next/cache";
import { getDb } from "@/lib/billing/db";
import { jsonResponse } from "@/lib/billing/identity";
import { safeEqual, sendDueTrialReminders } from "@/lib/billing/reminders";
import { errorResponse } from "@/lib/lookup";

async function run(req: Request) {
  await io();
  const configured = process.env.CRON_SECRET;
  if (!configured) return jsonResponse({ error: "Trial reminders are not configured." }, 503);
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!token || !safeEqual(token, configured)) return jsonResponse({ error: "Unauthorized." }, 401);
  try {
    const base = (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const result = await sendDueTrialReminders(getDb(), new Date(), {
      accountUrl: `${base}/account`,
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.EMAIL_FROM ?? "Emris <notices@emris.com>",
    });
    return jsonResponse(result);
  } catch (err) {
    return errorResponse(err);
  }
}

export function GET(req: Request) {
  return run(req);
}

export function POST(req: Request) {
  return run(req);
}
