import { createHash } from "node:crypto";
import { canViewReport, parseReportRequest } from "@/lib/access";
import { factualMemo, firstSection } from "@/lib/memo-text";
import { errorResponse, HttpError, readJson, tractDetail } from "@/lib/lookup";
import { rehabCandidates, type RehabCandidate } from "@/lib/rehab";
import { getViewer } from "@/lib/viewer";

function stubMemo(target: string): { title: string; memo_markdown: string } {
  return {
    title: `Report ${target}`,
    memo_markdown: [
      "## Summary",
      `This report covers ${target}.`,
      "",
      "## Signals",
      "No tract score is attached to this target.",
      "",
      "## Recent Permits",
      "No permit list is attached to this target.",
      "",
      "## Infrastructure Nearby",
      "No catalyst list is attached to this target.",
      "",
      "## Risks & Unknowns",
      "Open a tract report for scored signals.",
    ].join("\n"),
  };
}

// POST /api/report — 200 for an entitled target, 402 with the first section otherwise.
export async function POST(req: Request) {
  try {
    const report = parseReportRequest(await readJson(req));
    if (!report) throw new HttpError(400, "report_type and target_id are required.");
    const user = await getViewer(req);
    if (!user) throw new HttpError(401, "Sign in to open a report.");

    const geoid = /^\d{11}$/.test(report.target_id) ? report.target_id : null;
    const detail = geoid ? await tractDetail(geoid) : null;
    const memo = detail ? factualMemo(detail) : stubMemo(report.target_id);

    if (!canViewReport(user, report.report_type, report.target_id)) {
      throw new HttpError(402, "A paid report is required.", "payment_required", {
        preview: { title: memo.title, first_section_markdown: firstSection(memo.memo_markdown) },
      });
    }

    const rows: RehabCandidate[] = geoid ? await rehabCandidates(geoid) : [];
    const report_id = createHash("sha256")
      .update(`${user.id}|${report.report_type}|${report.target_id}`)
      .digest("hex")
      .slice(0, 32);
    return Response.json({
      report_id,
      status: "ready",
      pdf_url: null,
      report: {
        report_type: report.report_type,
        target_id: report.target_id,
        title: memo.title,
        memo_markdown: memo.memo_markdown,
        rehab: { count: rows.length, rows },
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
