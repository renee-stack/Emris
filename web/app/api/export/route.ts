import { connection, type NextRequest } from "next/server";
import { canExport, canViewReport, parseReportRequest } from "@/lib/access";
import { errorResponse, HttpError } from "@/lib/lookup";
import { rehabCandidates } from "@/lib/rehab";
import { getViewer } from "@/lib/viewer";

// GET /api/export?report_type=&target_id= — full rows, or 402. Never a trimmed list.
export async function GET(req: NextRequest) {
  await connection();
  try {
    const user = await getViewer(req);
    if (!user) throw new HttpError(401, "Sign in to export.");
    const report = parseReportRequest({
      report_type: req.nextUrl.searchParams.get("report_type"),
      target_id: req.nextUrl.searchParams.get("target_id"),
    });
    if (!report) throw new HttpError(400, "report_type and target_id are required.");
    if (!canExport(user) && !canViewReport(user, report.report_type, report.target_id)) {
      throw new HttpError(402, "Export requires a paid plan or this report.");
    }
    const rows =
      report.report_type === "area" && /^\d{11}$/.test(report.target_id)
        ? await rehabCandidates(report.target_id)
        : [];
    return Response.json({ count: rows.length, rows });
  } catch (err) {
    return errorResponse(err);
  }
}
