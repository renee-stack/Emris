import type Anthropic from "@anthropic-ai/sdk";
import type { AskRequest, AskResponse } from "@/lib/data";
import { getTracts } from "@/lib/data";
import { MODEL, NO_THINKING, complete, getClaude } from "@/lib/claude";
import { geocode } from "@/lib/geocode";
import { nearestTracts } from "@/lib/geo";
import { GEOID_RE, HttpError, errorResponse, getTractFeature, nearPlace, topTracts, tractDetail } from "@/lib/lookup";

// POST /api/ask — contract §2.5. Two Claude calls: classify intent (tool use), then write the reply.

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
- Under 550 characters. Plain text only: no markdown, no bullets, no asterisks, no URLs, no emoji.
- Lead with the direct answer in the first sentence.
- Mention 1-3 specific permits or projects by address or name (with units, date or status when given).
- Only use facts in the JSON. Never invent numbers or places.
- If nothing was found, say so plainly and suggest one of the "suggestions" (a nearby tracked area or the top tracts).
- If the user asked about something Emris has no data on (see "off_topic"), say honestly "I don't have that data" and say what Emris can answer instead: permits and projects near an address or neighborhood, a tract's score, or the top-scoring tracts.
- Don't mention geoids, JSON or "the data I was given". A link to the map is sent separately; don't refer to it.`;

const fmtLatLng = (n: number) => String(Math.round(n * 1e5) / 1e5);
const latLngUrl = (lat: number, lng: number, z: number) => `/?lat=${fmtLatLng(lat)}&lng=${fmtLatLng(lng)}&z=${z}`;

async function classify(question: string): Promise<Intent> {
  const { features } = await getTracts();
  const tractList = features.map((f) => `${f.properties.geoid} ${f.properties.name}`).join("\n");
  const msg = await getClaude().messages.create({
    model: MODEL,
    max_tokens: 300,
    thinking: NO_THINKING,
    system: `Always respond by calling the route_question tool exactly once, with no other text. Tracked tracts:\n${tractList}`,
    tools: [CLASSIFY_TOOL],
    // Forced tool_choice ("tool"/"any") is rejected by this model, so use auto and fall back to help.
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content: question }],
  });
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
        top_tracts: details.map((d) => ({
          ...slimTract(d.tract),
          newest_permits: d.top_permits.slice(0, 2).map(slimPermit),
          nearest_project: d.nearby_projects[0] ? slimProject(d.nearby_projects[0]) : null,
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
        nearby_projects: d.nearby_projects.slice(0, 4).map(slimProject),
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
    const isArea = place.source === "neighborhood";
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
        permits_nearby: res.permits.slice(0, 6).map(slimPermit),
        permit_count_in_radius: res.permits.length,
        projects_nearby: res.projects.slice(0, 4).map(slimProject),
        found: !nothing,
        suggestions: nothing
          ? {
              nearest_tracked_tracts: nearby.map((t) => ({ name: t.properties.name, score: t.properties.score, distance_mi: t.distance_mi })),
              top_tracts: top3,
            }
          : undefined,
        note: "Emris currently tracks only a few neighborhoods, so many places have no tract.",
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
  description: p.description,
});
const slimProject = (p: { name: string; type: string; status: string; expected_completion: string | null; budget_usd: number | null; distance_mi: number }) => ({
  name: p.name,
  type: p.type,
  status: p.status,
  expected_completion: p.expected_completion,
  budget_usd: p.budget_usd,
  distance_mi: p.distance_mi,
});

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
    let body: Partial<AskRequest>;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, "Body must be JSON: { question }");
    }
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question) throw new HttpError(400, "question is required");

    const intent = await classify(question);
    const { context, url } = await lookup(intent);
    const draft = await complete({
      system: REPLY_SYSTEM,
      user: JSON.stringify({ question, intent: intent.type, ...context }),
      maxTokens: 400,
    });
    const res: AskResponse & { intent?: Intent } = { reply: sanitize(draft), url };
    if (process.env.NODE_ENV !== "production") res.intent = intent; // debug aid for smoke tests
    return Response.json(res);
  } catch (err) {
    return errorResponse(err);
  }
}

