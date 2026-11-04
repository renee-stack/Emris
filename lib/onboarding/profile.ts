import { adminClient } from "@/lib/supabase/admin";

export interface FocusPlace {
  id: string;
  name: string;
}

export interface FocusAreas {
  places: FocusPlace[];
  address: string | null;
}

export interface ProfileRow {
  user_id: string;
  role: string | null;
  strategy: string | null;
  focus_areas: FocusAreas;
  onboarded_at: string | null;
}

function focusFrom(value: unknown): FocusAreas {
  if (!value || typeof value !== "object") return { places: [], address: null };
  const rec = value as { places?: unknown; address?: unknown };
  const places = Array.isArray(rec.places)
    ? rec.places.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as { id?: unknown; name?: unknown };
        if (typeof row.id !== "string" || typeof row.name !== "string") return [];
        return [{ id: row.id, name: row.name }];
      })
    : [];
  return {
    places,
    address: typeof rec.address === "string" && rec.address.trim() ? rec.address : null,
  };
}

export async function readProfile(userId: string): Promise<ProfileRow | null> {
  const admin = adminClient();
  if (!admin) return null;
  const { data, error } = await admin.from("profiles").select("user_id, role, strategy, focus_areas, onboarded_at").eq("user_id", userId).maybeSingle();
  if (error || !data) return null;
  return {
    user_id: String(data.user_id),
    role: typeof data.role === "string" ? data.role : null,
    strategy: typeof data.strategy === "string" ? data.strategy : null,
    focus_areas: focusFrom(data.focus_areas),
    onboarded_at: typeof data.onboarded_at === "string" ? data.onboarded_at : null,
  };
}

export async function saveProfile(row: ProfileRow): Promise<boolean> {
  const admin = adminClient();
  if (!admin) return false;
  const { error } = await admin.from("profiles").upsert(
    {
      user_id: row.user_id,
      role: row.role,
      strategy: row.strategy,
      focus_areas: row.focus_areas,
      onboarded_at: row.onboarded_at,
    },
    { onConflict: "user_id" },
  );
  return !error;
}
