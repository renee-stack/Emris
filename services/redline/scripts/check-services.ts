// npm run check:services
// Checks the research tools, Google Cloud credentials and the API, using the same settings the service uses. No model calls.
// Inside a deployment, run it from the API container.
//   REDLINE_API_URL      default http://127.0.0.1:${DEMO_PORT:-8792}
// Exits 1 if something is down. Warnings mean it's up but can't do its whole job yet.

import { GoogleAuth } from "google-auth-library";
import { readAgent } from "./lib.ts";
import { researchTools, vertexModel } from "./runtime.ts";

const { agent } = readAgent();
const apiUrl = process.env.REDLINE_API_URL ?? `http://127.0.0.1:${process.env.DEMO_PORT ?? 8792}`;
const TIMEOUT_MS = 5_000;

let failed = false;
const report = (mark: string, what: string, detail: string) => console.log(`${mark.padEnd(4)} ${what.padEnd(11)} ${detail}`);
const ok = (what: string, detail: string) => report("ok", what, detail);
const warn = (what: string, detail: string) => report("warn", what, detail);
const fail = (what: string, detail: string) => {
  failed = true;
  report("FAIL", what, detail);
};

async function get(url: string): Promise<Response> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

async function checkCredentials() {
  try {
    const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
    const project = process.env.VERTEX_PROJECT_ID || process.env.ANTHROPIC_VERTEX_PROJECT_ID || (await auth.getProjectId());
    await auth.getAccessToken();
    ok("vertex", `credentials work for project ${project}; the agent will use ${vertexModel(agent.model)}`);
  } catch (e) {
    fail("vertex", `no usable Google Cloud credentials: ${(e as Error).message}`);
  }
}

async function checkTools() {
  try {
    const tools = await researchTools();
    ok("tools", `${tools.list.length} research tools load`);
    const reply = await tools.call("similar_comments", { jurisdiction: "seattle", query: "stair", limit: 1 });
    if (reply.text.includes("No past comments")) warn("tools", "no Seattle past comments loaded, so similar_comments returns nothing (npm run real:build)");
    else ok("tools", "Seattle past comments are loaded");
  } catch (e) {
    fail("tools", (e as Error).message);
  }
}

async function checkApi() {
  try {
    await get(`${apiUrl}/health`);
    ok("api", `${apiUrl} is up`);
  } catch (e) {
    fail("api", `${apiUrl}: ${(e as Error).message}`);
  }
}

await checkCredentials();
await checkTools();
await checkApi();
process.exit(failed ? 1 : 0);
