// Loads .env (via Node's built-in loader) and exposes typed config.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envPath = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

const trimSlash = (s: string) => s.replace(/\/+$/, "");

export const config = {
  photonProjectId: process.env.PHOTON_PROJECT_ID ?? "",
  photonProjectSecret: process.env.PHOTON_PROJECT_SECRET ?? "",
  apiUrl: trimSlash(process.env.EMRIS_API_URL || "http://localhost:3000"),
  // Contract §5 calls this APP_BASE_URL; accept either.
  publicUrl: trimSlash(
    process.env.EMRIS_PUBLIC_URL ||
      process.env.APP_BASE_URL ||
      process.env.EMRIS_API_URL ||
      "http://localhost:3000",
  ),
  timeoutMs: Number(process.env.EMRIS_TIMEOUT_MS) || 15_000,
};
