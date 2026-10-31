import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const needles = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "sk_live_",
  "sk_test_",
  "rk_live_",
  "whsec_",
];

async function filesUnder(dir, extensions) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(full, extensions)));
    else if (extensions.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
}

function hits(text) {
  return needles.filter((needle) => text.includes(needle));
}

let failed = false;
const bundle = path.join(root, ".next", "static");
const bundled = await filesUnder(bundle, [".js", ".css", ".html", ".json", ".rsc"]);
if (bundled.length === 0) {
  console.error(`No client bundle at ${bundle}. Run next build first.`);
  process.exit(1);
}
for (const file of bundled) {
  const found = hits(await readFile(file, "utf8"));
  for (const needle of found) {
    console.error(`${path.relative(root, file)} contains ${needle}`);
    failed = true;
  }
}

const sourceRoots = ["app", "components", "lib"].map((dir) => path.join(root, dir));
for (const dir of sourceRoots) {
  for (const file of await filesUnder(dir, [".ts", ".tsx", ".js", ".jsx"])) {
    const text = await readFile(file, "utf8");
    const client = text.includes("use client") || file.includes(`${path.sep}components${path.sep}`);
    if (!client) continue;
    for (const needle of hits(text)) {
      console.error(`${path.relative(root, file)} contains ${needle}`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log(`Client bundles are free of service-role and Stripe secrets (${bundled.length} files).`);
