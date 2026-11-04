import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.join(process.cwd(), ".next", "static");
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";

async function files(dir) {
  const found = [];
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await files(full)));
    else if (/\.(js|css|json|html)$/.test(entry.name)) found.push(full);
  }
  return found;
}

const paths = await files(root);
let leaked = false;
for (const file of paths) {
  const text = await readFile(file, "utf8");
  if (text.includes("SUPABASE_SERVICE_ROLE_KEY") || (secret.length > 8 && text.includes(secret))) {
    console.error(`Service role key appeared in client file ${path.relative(process.cwd(), file)}`);
    leaked = true;
  }
}
if (leaked) process.exit(1);
console.log(`Checked ${paths.length} client files for the service role key.`);
