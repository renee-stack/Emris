import type { MemoRequest, MemoResponse, TractDetailResponse } from "@/lib/data";
import { getTracts } from "@/lib/data";
import { canReadFullMemo } from "@/lib/access";
import { complete } from "@/lib/claude";
import { cached } from "@/lib/cache";
import { factualMemo, firstSection } from "@/lib/memo-text";
import { HttpError, errorResponse, readJson, tractDetail } from "@/lib/lookup";
import { getViewer } from "@/lib/viewer";

// POST /api/memo — free accounts get the first section. Paid plans and a purchased tract get the full memo.
const SYSTEM = `You are writing a one-page investment committee brief for a multifamily acquisitions team.
Write in plain English, with no jargon a commercial real estate partner wouldn't use.

Output GitHub-flavored markdown with exactly these "##" sections, in this order:
## Thesis
(exactly 2 sentences)
## What the permits show
## Infrastructure catalysts
## Momentum
## Risks and gaps in the data
## Suggested next diligence steps

Rules:
- Only cite facts present in the JSON you are given. Never invent numbers, names, addresses, dates, rents, prices or demographics.
- If something is missing (e.g. a permit's unit count is null, a project has no budget), say it is not reported rather than guessing.
- Scores and signals are 0-100 percentile ranks across the tracts in the dataset; "percentile" means the tract beats that share of tracts. momentum_pct compares permits filed in the last 12 months with the 12 months before.
- Refer to permits by address. Keep the whole memo under 400 words; short paragraphs or bullets. Do not add a title line; start with "## Thesis".`;

const trunc = (s: string, n = 160) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

function modelEnabled(): boolean {
  return process.env.EMRIS_TEST_ACCESS !== "1" && Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export async function POST(req: Request) {
  try {
    const body = (await readJson(req)) as Partial<MemoRequest>;
    const geoid = typeof body.geoid === "string" ? body.geoid.trim() : "";
    const user = await getViewer(req);
    if (!user) throw new HttpError(401, "Sign in to read the memo.");
    const detail = await tractDetail(geoid);
    const full = canReadFullMemo(user, geoid);
    if (!full) {
      const preview = factualMemo(detail);
      const response: MemoResponse & { access: "preview" } = {
        geoid,
        title: preview.title,
        memo_markdown: firstSection(preview.memo_markdown),
        access: "preview",
      };
      return Response.json(response);
    }
    if (!modelEnabled()) {
      const memo = factualMemo(detail);
      return Response.json({ ...memo, geoid, access: "full" as const });
    }
    const { as_of, features } = await getTracts();
    const { value, hit } = await cached("memo", `${as_of}|${geoid}`, () =>
      writeMemo(geoid, detail, as_of, features.length),
    );
    return Response.json({ ...value, access: "full" }, { headers: { "x-emris-cache": hit ? "hit" : "miss" } });
  } catch (err) {
    return errorResponse(err);
  }
}

async function writeMemo(
  geoid: string,
  detail: TractDetailResponse,
  as_of: string,
  tractCount: number,
): Promise<MemoResponse> {
  const t = detail.tract;
  const payload = {
    as_of,
    tracts_in_dataset: tractCount,
    tract: {
      name: t.name,
      score: t.score,
      percentile: t.percentile,
      momentum: t.momentum,
      momentum_pct: t.momentum_pct,
      signals: t.signals,
      permit_count_24mo: t.permit_count_24mo,
      units_24mo: t.units_24mo,
    },
    permits: detail.top_permits.map((p) => ({
      address: p.address,
      issue_date: p.issue_date,
      units: p.units,
      description: trunc(p.description),
    })),
    projects: detail.nearby_projects.map((p) => ({
      name: p.name,
      type: p.type,
      status: p.status,
      distance_mi: p.distance_mi,
      budget_usd: p.budget_usd,
      expected_completion: p.expected_completion,
      description: trunc(p.description),
    })),
  };

  const { text, truncated } = await complete({
    label: `memo(${geoid})`,
    system: SYSTEM,
    user: JSON.stringify(payload),
    maxTokens: 1000,
  });
  if (!text) throw new Error("Empty memo from model");
  if (truncated) throw new Error("Memo was cut off by max_tokens; not cached");

  return {
    geoid,
    title: `${detail.tract.name} — Path of Progress Memo`,
    memo_markdown: text,
  };
}
