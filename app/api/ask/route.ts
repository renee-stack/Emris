import type Anthropic from "@anthropic-ai/sdk";
import type { AskRequest, AskResponse } from "@/lib/data";
import { getTracts } from "@/lib/data";
import { FAST_MODEL, complete, getClaude, logUsage, toLastSentence } from "@/lib/claude";
import { cached } from "@/lib/cache";
import { findNeighborhoodInText, geocode } from "@/lib/geocode";
import { nearestTracts } from "@/lib/geo";
import { GEOID_RE, HttpError, errorResponse, getTractFeature, nearPlace, topTracts, tractDetail } from "@/lib/lookup";
import { requestUser } from "@/lib/auth/session";
import { allow, clientIp } from "@/lib/ratelimit";

// Cost guards: every uncached question is a paid Claude call.
const MAX_QUESTION_CHARS = 280;
const MAX_BODY_BYTES = 4_096;
const PER_IP_PER_MINUTE = 10;
const PER_IP_PER_DAY = 100;
const MODEL_CALLS_PER_DAY = 500; // per server instance, uncached questions only
const DAY = 86_400_000;

// POST /api/ask — contract §2.5. Route the question (regex first, Haiku tool call only when ambiguous),
// look the data up locally, then one Sonnet call writes the SMS reply. Replies are cached by question.

type Intent =
  | { type: "place"; query: string }
  | { type: "top"; n: number }
  | { type: "tract"; geoid: string }
  | { type: "help"; off_topic?: string };

const CLASSIFY_TOOL: Anthropic.Tool = {
  name: "route_question",
  description: "Classify a texted question about Chicago development activity into one lookup.",
  input_schema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["place", "top", "tract", "help"],
        description:
          "place: about a specific address, intersection or neighborhood. top: asks for the best/hottest/top tracts or areas (city-wide or a broad region). tract: names a specific census tract. help: greetings, questions about what Emris does, or anything Emris has no data for (zoning, rents, prices, crime, schools, taxes...).",
      },
      query: { type: "string", description: "For place: just the address or neighborhood, e.g. '1500 N Milwaukee Ave' or 'Pilsen'." },
      n: { type: "integer", description: "For top: how many tracts (default 3, max 10)." },
      geoid: { type: "string", description: "For tract: the 11-digit geoid, from the list given if the user named a tract." },
      off_topic: { type: "string", description: "For help: if they asked about something Emris lacks data on, name it briefly (e.g. 'zoning requirements')." },
    },
    required: ["type"],
  },
};

const REPLY_SYSTEM = `You are Emris, texting a multifamily real estate developer in Chicago. Emris tracks new-construction building permits and public infrastructure projects (transit, parks, streetscapes, civic) and scores census tracts 0-100 on "path of progress" (multifamily permits, permit momentum year over year, nearby infrastructure).

Write the SMS reply from the JSON you are given:
- Under 500 characters (about 3-4 short sentences). Plain text only: no markdown, no bullets, no asterisks, no URLs, no emoji.
- Lead with the direct answer in the first sentence.
- Mention 1-3 specific permits or projects by address or name (with units, date or status when given).
- Only use facts in the JSON. Never invent numbers or places.
- If nothing was found, say so plainly and suggest one of the "suggestions" (a nearby tracked area or the top tracts).
- If the user asked about something Emris has no data on (see "off_topic"), say honestly "I don't have that data" and say what Emris can answer instead: permits and projects near an address or neighborhood, a tract's score, or the top-scoring tracts.
- Don't mention geoids, JSON or "the data I was given". A link to the map is sent separately; don't refer to it.`;

const fmtLatLng = (n: number) => String(Math.round(n * 1e5) / 1e5);
const latLngUrl = (lat: number, lng: number, z: number) => `/?lat=${fmtLatLng(lat)}&lng=${fmtLatLng(lng)}&z=${z}`;

async function classify(question: string): Promise<Intent> {
  const msg = await getClaude().messages.create({
    model: FAST_MODEL,
    max_tokens: 100,
    system: "Route the user's question about Chicago development activity with the route_question tool.",
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: "tool", name: "route_question" },
    messages: [{ role: "user", content: question }],
  });
  logUsage("ask.classify", msg);
  const block = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const input = (block?.input ?? {}) as Record<string, unknown>;
  switch (input.type) {
    case "place":
      if (typeof input.query === "string" && input.query.trim()) return { type: "place", query: input.query.trim() };
      break;
    case "top": {
      const n = Number(input.n);
      return { type: "top", n: Number.isFinite(n) ? Math.min(10, Math.max(1, Math.round(n))) : 3 };
    }
    case "tract":
      if (typeof input.geoid === "string" && GEOID_RE.test(input.geoid)) return { type: "tract", geoid: input.geoid };
      break;
  }
  return { type: "help", off_topic: typeof input.off_topic === "string" ? input.off_topic : undefined };
}

// ---------- local routing (no API call) ----------

const OFF_TOPIC_RE =
  /\b(zon(ing|ed)|rents?|rental rates?|prices?|pricing|cost|values?|crime|safe(ty)?|schools?|tax(es)?|tif|demographics?|income|vacanc(y|ies)|cap rates?|weather|parking|setbacks?|density|far|lot sizes?)\b/i;
const GEOID_IN_TEXT_RE = /\b(\d{11})\b/;
const TRACT_NUM_RE = /\btract\s*#?\s*(\d{1,4}(?:\.\d{1,2})?)\b/i;
const TOP_RE = /\b(?:top|best|hottest|highest[- ]scoring)\s+(?:(\d{1,2})\s+)?(?:census\s+)?(?:tracts?|areas|neighborhoods|spots)\b|^\s*top\s+(\d{1,2})\s*$/i;
const ADDRESS_RE =
  /\b(\d{1,5}\s+(?:[NSEW]\.?\s+)?(?:[A-Za-z0-9.']+\s+){0,4}?(?:Ave|Avenue|St|Street|Blvd|Boulevard|Rd|Road|Dr|Drive|Pl|Place|Ct|Court|Pkwy|Parkway|Way|Ln|Lane|Ter|Terrace|Hwy)\b\.?)/i;
const GREETING_RE = /^\s*(hi|hello|hey|yo|help|start|what can you do|how does (this|it) work)\b/i;

/** Decide the intent locally when the question is unambiguous; null means ask the classifier. */
async function routeLocally(question: string): Promise<Intent | null> {
  if (OFF_TOPIC_RE.test(question)) return null; // let the model spot what they're really asking

  const { features } = await getTracts();
  const geoid = question.match(GEOID_IN_TEXT_RE)?.[1];
  if (geoid) return { type: "tract", geoid };
  const tractNum = question.match(TRACT_NUM_RE)?.[1];
  if (tractNum) {
    const hit = features.find((f) => f.properties.name.endsWith(`Tract ${tractNum}`));
    if (hit) return { type: "tract", geoid: hit.properties.geoid };
  }

  const address = question.match(ADDRESS_RE)?.[1]?.replace(/\.$/, "");
  const area = findNeighborhoodInText(question);
  const top = question.match(TOP_RE);

  if (top) {
    if (address || area) return null; // "best tracts in Pilsen" etc. is ambiguous
    const n = Number(top[1] ?? top[2] ?? 3);
    return { type: "top", n: Math.min(10, Math.max(1, n)) };
  }
  if (address) return { type: "place", query: address };
  if (area) return { type: "place", query: area };
  if (GREETING_RE.test(question)) return { type: "help" };
  return null;
}

const trunc = (s: string, n = 160) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

const slimTract = (t: { name: string; score: number; percentile: number; momentum: string; momentum_pct: number; permit_count_24mo: number; units_24mo: number }) => ({
  name: t.name,
  score: t.score,
  percentile: t.percentile,
  momentum: t.momentum,
  momentum_pct: t.momentum_pct,
  permit_count_24mo: t.permit_count_24mo,
  units_24mo: t.units_24mo,
});

/** Runs the lookup for an intent; returns context for the reply writer and the deep link. */
async function lookup(intent: Intent): Promise<{ context: Record<string, unknown>; url: string }> {
  const top3 = (await topTracts(3)).map((f) => slimTract(f.properties));
  const fallbackUrl = `/?tract=${(await topTracts(1))[0]?.properties.geoid ?? ""}`;

  if (intent.type === "top") {
    const tracts = await topTracts(intent.n);
    const details = await Promise.all(tracts.map((f) => tractDetail(f.properties.geoid)));
    return {
      context: {
        // at most 5 permits and 5 projects in total
        top_tracts: details.map((d, i) => ({
          ...slimTract(d.tract),
          newest_permit: i < 5 && d.top_permits[0] ? slimPermit(d.top_permits[0]) : undefined,
          nearest_project: i < 5 && d.nearby_projects[0] ? slimProject(d.nearby_projects[0]) : undefined,
        })),
      },
      url: tracts[0] ? `/?tract=${tracts[0].properties.geoid}` : "/",
    };
  }

  if (intent.type === "tract") {
    const feature = await getTractFeature(intent.geoid);
    if (!feature) return { context: { found: false, suggestions: { top_tracts: top3 } }, url: fallbackUrl };
    const d = await tractDetail(intent.geoid);
    return {
      context: {
        tract: slimTract(d.tract),
        signals: d.tract.signals,
        top_permits: d.top_permits.slice(0, 5).map(slimPermit),
        nearby_projects: d.nearby_projects.slice(0, 5).map(slimProject),
      },
      url: `/?tract=${intent.geoid}`,
    };
  }

  if (intent.type === "place") {
    const place = await geocode(intent.query);
    if (!place) {
      return {
        context: { query: intent.query, found: false, reason: "Couldn't locate that place in Chicago", suggestions: { top_tracts: top3 } },
        url: fallbackUrl,
      };
    }
    const isArea = place.source !== "census"; // neighborhoods and projects cover an area, not a point
    let radius = isArea ? 0.75 : 0.5;
    let res = await nearPlace(place, radius);
    if (!isArea && res.permits.length === 0 && res.projects.length === 0) {
      radius = 1.0;
      res = await nearPlace(place, radius);
    }
    const { features } = await getTracts();
    const nearby = nearestTracts(features, place, 3).filter((t) => t.properties.geoid !== res.tract?.geoid);
    const nothing = res.permits.length === 0 && res.projects.length === 0 && !res.tract;
    return {
      context: {
        place: res.place.label,
        search_radius_mi: radius,
        tract_containing_place: res.tract ? slimTract(res.tract) : null,
        permits_nearby: res.permits.slice(0, 5).map(slimPermit),
        permit_count_in_radius: res.permits.length,
        projects_nearby: res.projects.slice(0, 5).map(slimProject),
        found: !nothing,
        suggestions: nothing
          ? {
              nearest_tracked_tracts: nearby.map((t) => ({ name: t.properties.name, score: t.properties.score, distance_mi: t.distance_mi })),
              top_tracts: top3,
            }
          : undefined,
        note: "Emris covers every Chicago census tract. Permits are new-construction permits with 5+ units (or unknown units) from the last 24 months; infrastructure is a curated project list, so an empty result means no such activity was recorded there.",
      },
      url: res.tract ? `/?tract=${res.tract.geoid}` : latLngUrl(place.lat, place.lng, isArea ? 14 : 15),
    };
  }

  return {
    context: {
      help: true,
      off_topic: intent.off_topic ?? null,
      can_answer: [
        "what's being built near an address or neighborhood",
        "a tract's path-of-progress score and momentum",
        "the top-scoring tracts",
      ],
      suggestions: { top_tracts: top3 },
    },
    url: fallbackUrl,
  };
}

const slimPermit = (p: { address: string; issue_date: string; units: number | null; description: string }) => ({
  address: p.address,
  issue_date: p.issue_date,
  units: p.units,
  description: trunc(p.description),
});
const slimProject = (p: { name: string; type: string; status: string; expected_completion: string | null; budget_usd: number | null; distance_mi: number; description: string }) => ({
  name: p.name,
  type: p.type,
  status: p.status,
  expected_completion: p.expected_completion,
  budget_usd: p.budget_usd,
  distance_mi: p.distance_mi,
  description: trunc(p.description),
});

const normalizeQuestion = (q: string) =>
  q.toLowerCase().replace(/[’']/g, "'").replace(/[?!.,]+/g, " ").replace(/\s+/g, " ").trim();

/** Enforce plain text, no URLs, under 600 chars. */
function sanitize(text: string): string {
  let t = text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_`#>]+/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length >= 600) {
    const cut = t.slice(0, 597);
    const end = cut.lastIndexOf(". ");
    t = end > 300 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + "...";
  }
  return t;
}

export async function POST(req: Request) {
  try {
    const user = await requestUser();
    const ip = user ? `${clientIp(req)}:${user.id}` : clientIp(req);
    if (!allow(`ask:min:${ip}`, PER_IP_PER_MINUTE, 60_000) || !allow(`ask:day:${ip}`, PER_IP_PER_DAY, DAY)) {
      throw new HttpError(429, "Too many questions. Try again later.");
    }
    if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
      throw new HttpError(413, "Request too large");
    }
    let body: Partial<AskRequest>;
    try {
      const raw = await req.text();
      if (raw.length > MAX_BODY_BYTES) throw new HttpError(413, "Request too large");
      body = JSON.parse(raw);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(400, "Body must be JSON: { question }");
    }
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question) throw new HttpError(400, "question is required");
    if (question.length > MAX_QUESTION_CHARS) {
      throw new HttpError(400, `Keep questions under ${MAX_QUESTION_CHARS} characters`);
    }

    const { as_of } = await getTracts();
    let route: "regex" | "haiku" | undefined;
    const { value, hit } = await cached("ask", `${as_of}|${normalizeQuestion(question)}`, async (): Promise<AskResponse> => {
      if (!allow("ask:model-calls", MODEL_CALLS_PER_DAY, DAY)) {
        throw new HttpError(503, "Emris has answered its limit of new questions for today. Try again tomorrow.");
      }
      const local = await routeLocally(question);
      route = local ? "regex" : "haiku";
      const intent = local ?? (await classify(question));
      const { context, url } = await lookup(intent);
      const { text, truncated } = await complete({
        label: `ask.reply(${route}:${intent.type})`,
        system: REPLY_SYSTEM,
        user: JSON.stringify({ question, intent: intent.type, ...context }),
        maxTokens: 250,
      });
      const reply = sanitize(truncated ? toLastSentence(text) : text);
      if (!reply) throw new Error("Empty reply from model");
      return { reply, url };
    });
    const headers: Record<string, string> = { "x-emris-cache": hit ? "hit" : "miss" };
    if (route) headers["x-emris-route"] = route;
    return Response.json(value, { headers });
  } catch (err) {
    return errorResponse(err);
  }
}

