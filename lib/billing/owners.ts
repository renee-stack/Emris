import { promises as fs } from "node:fs";
import path from "node:path";
import type { OwnerRecord } from "@/lib/data";

const DATA_DIR = path.join(process.cwd(), "data");

function isOwner(value: unknown): value is OwnerRecord & { geoid?: string } {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && typeof row.name === "string" && typeof row.address === "string";
}

/** Optional assessor file. Missing data is an empty list, never a guessed name. */
export async function getOwners(): Promise<(OwnerRecord & { geoid: string })[]> {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, "owners.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isOwner).flatMap((row) => {
      const geoid = typeof (row as { geoid?: unknown }).geoid === "string" ? (row as { geoid: string }).geoid : "";
      if (!/^\d{11}$/.test(geoid) || !row.name.trim()) return [];
      return [{ id: row.id, name: row.name.trim(), address: row.address.trim(), geoid }];
    });
  } catch {
    return [];
  }
}
