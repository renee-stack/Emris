import type { NextRequest } from "next/server";

// /api/redline/* — contract §2.7. A thin proxy to the Redline service (services/redline), which runs on its own server.
// It holds the service key, so the browser never sees it, and it forwards only the routes listed here.

const MAX_BODY_BYTES = 4_000_000; // Vercel limits a function's request body, so larger files are refused here with a clear message.

const REPORT = "[a-f0-9]{32}";
const ALLOWED: Record<"GET" | "POST", RegExp[]> = {
  GET: [/^offer$/, /^paid$/, new RegExp(`^job/${REPORT}$`), new RegExp(`^report/${REPORT}$`), new RegExp(`^report/${REPORT}/export$`)],
  POST: [/^start\/extract$/, /^start\/run$/, /^waitlist$/, new RegExp(`^report/${REPORT}/(unlock|review|optin)$`)],
};

type Context = { params: Promise<{ path: string[] }> };

async function forward(request: NextRequest, method: "GET" | "POST", ctx: Context): Promise<Response> {
  const { path } = await ctx.params;
  const route = path.join("/");
  if (!ALLOWED[method].some((re) => re.test(route))) return Response.json({ error: "Not found." }, { status: 404 });

  const base = process.env.REDLINE_API_URL;
  const key = process.env.REDLINE_API_KEY;
  if (!base || !key) return Response.json({ error: "Redline isn't connected yet." }, { status: 503 });

  let body: string | undefined;
  if (method === "POST") {
    body = await request.text();
    if (body.length > MAX_BODY_BYTES) return Response.json({ error: "That file is too large. Paste the comments instead." }, { status: 413 });
  }

  try {
    const upstream = await fetch(`${base}/api/${route}${request.nextUrl.search}`, {
      method,
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(50_000),
      headers: {
        "x-redline-key": key,
        "x-redline-client": request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "",
      },
    });
    const headers = new Headers({ "content-type": upstream.headers.get("content-type") ?? "application/json" });
    const disposition = upstream.headers.get("content-disposition");
    if (disposition) headers.set("content-disposition", disposition);
    return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers });
  } catch {
    return Response.json({ error: "Redline didn't respond. Try again in a moment." }, { status: 502 });
  }
}

export function GET(request: NextRequest, ctx: Context) {
  return forward(request, "GET", ctx);
}

export function POST(request: NextRequest, ctx: Context) {
  return forward(request, "POST", ctx);
}
