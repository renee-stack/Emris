import { requestUser } from "@/lib/auth/session";
import { ensureUser } from "@/lib/auth/users";
import { sendWelcomeEmail } from "@/lib/auth/welcome";
import { isRole, isStrategy, isValueAdd } from "@/lib/onboarding/choices";
import { marketGlance } from "@/lib/onboarding/glance";
import { saveProfile, type FocusAreas } from "@/lib/onboarding/profile";
import { safeNextPath } from "@/lib/supabase/return-path";

const PLACE_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,80}$/;

export async function POST(req: Request) {
  const user = await requestUser();
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });

  let body: {
    role?: unknown;
    strategy?: unknown;
    places?: unknown;
    address?: unknown;
    next?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const role = typeof body.role === "string" ? body.role : "";
  const strategy = typeof body.strategy === "string" ? body.strategy : "";
  if (!isRole(role) || !isStrategy(strategy)) {
    return Response.json({ error: "Choose a role and a strategy." }, { status: 400 });
  }

  const places: FocusAreas["places"] = [];
  if (Array.isArray(body.places)) {
    for (const item of body.places) {
      if (places.length >= 3) break;
      if (!item || typeof item !== "object") continue;
      const row = item as { id?: unknown; name?: unknown };
      if (typeof row.id !== "string" || typeof row.name !== "string") continue;
      if (!PLACE_RE.test(row.id) || row.name.length > 80) continue;
      places.push({ id: row.id, name: row.name.trim() });
    }
  }
  const address = typeof body.address === "string" ? body.address.trim().slice(0, 160) : "";
  const focus: FocusAreas = { places, address: address || null };

  await ensureUser(user.id, user.email);
  const saved = await saveProfile({
    user_id: user.id,
    role,
    strategy,
    focus_areas: focus,
    onboarded_at: new Date().toISOString(),
  });
  if (!saved) return Response.json({ error: "We couldn't save your profile." }, { status: 503 });

  const origin = new URL(req.url).origin;
  const next = safeNextPath(typeof body.next === "string" ? body.next : null, origin);
  const place = places[0];
  const marketPath = place ? `/map?place=${encodeURIComponent(place.id)}&tour=1` : "/map?tour=1";
  const welcome = user.email
    ? await sendWelcomeEmail({
        to: user.email,
        marketUrl: `${origin}${marketPath}`,
        placeName: place?.name ?? null,
      })
    : "not_configured";

  return Response.json({
    welcome,
    valueAdd: isValueAdd(strategy),
    tracts: await marketGlance(),
    focus: places.map((item) => item.name),
    marketPath,
    next,
  });
}
