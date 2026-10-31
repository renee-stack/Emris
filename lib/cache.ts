// Tiny two-level cache (memory + JSON files under <cwd>/.cache) so Claude results survive restarts.
// Server-only. Failures to read or write disk are ignored; the cache is an optimisation, never required.
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { unstable_cache } from "next/cache";

// Vercel functions can only write to /tmp (per instance, so it is a warm-instance cache there).
const ROOT = process.env.VERCEL ? "/tmp/emris-cache" : path.join(process.cwd(), ".cache");
const mem = new Map<string, unknown>();

const fileFor = (ns: string, key: string) =>
  path.join(ROOT, ns, createHash("sha1").update(key).digest("hex").slice(0, 20) + ".json");

async function ensureRoot() {
  await fs.mkdir(ROOT, { recursive: true });
  // Self-ignoring folder, so nothing outside /lib needs to change to keep it out of git.
  await fs.writeFile(path.join(ROOT, ".gitignore"), "*\n", { flag: "wx" }).catch(() => {});
}

export async function cacheGet<T>(ns: string, key: string): Promise<T | undefined> {
  const k = `${ns}:${key}`;
  if (mem.has(k)) return mem.get(k) as T;
  try {
    const { value } = JSON.parse(await fs.readFile(fileFor(ns, key), "utf8")) as { key: string; value: T };
    mem.set(k, value);
    return value;
  } catch {
    return undefined;
  }
}

export async function cacheSet<T>(ns: string, key: string, value: T): Promise<void> {
  mem.set(`${ns}:${key}`, value);
  try {
    await ensureRoot();
    const file = fileFor(ns, key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ key, value }));
  } catch {
    // disk cache is best-effort
  }
}

// Bump to invalidate every cached Claude result (e.g. after changing a prompt).
const CACHE_VERSION = "1";

/**
 * Return the cached value for (ns, key), or run `compute` once and cache it.
 * Layers: memory -> local disk (dev) -> Next's data cache on Vercel, which is shared by all
 * instances and survives redeploys. Errors thrown by `compute` are never cached.
 */
export async function cached<T>(ns: string, key: string, compute: () => Promise<T>): Promise<{ value: T; hit: boolean }> {
  const local = await cacheGet<T>(ns, key);
  if (local !== undefined) return { value: local, hit: true };

  let ran = false;
  const run = async () => {
    ran = true;
    return compute();
  };
  const value = process.env.VERCEL
    ? await unstable_cache(run, ["emris", CACHE_VERSION, ns, key], { revalidate: false, tags: [`emris-${ns}`] })()
    : await run();
  await cacheSet(ns, key, value);
  return { value, hit: !ran };
}
