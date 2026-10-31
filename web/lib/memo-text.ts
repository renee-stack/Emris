// A factual IC memo built only from a tract response. The first section is the free preview.
import type { TractDetailResponse } from "@/lib/data";

export const MEMO_SECTIONS = [
  "Summary",
  "Signals",
  "Recent Permits",
  "Infrastructure Nearby",
  "Risks & Unknowns",
] as const;

export function firstSection(markdown: string): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.startsWith("## "));
  if (start < 0) return markdown.trim();
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trim();
}

export function sectionCount(markdown: string): number {
  return markdown.split("\n").filter((line) => line.startsWith("## ")).length;
}

/** Cites only fields on the tract response. */
export function factualMemo(detail: TractDetailResponse): { title: string; memo_markdown: string } {
  const tract = detail.tract;
  const permits = detail.top_permits ?? [];
  const projects = detail.nearby_projects ?? [];
  const permitLines = permits.length
    ? permits
        .map((permit) => {
          const units = permit.units == null ? "unit count not reported" : `${permit.units} units`;
          return `- ${permit.address} (${permit.issue_date}, ${units}). ${permit.description}`;
        })
        .join("\n")
    : "No permits are on file for this tract.";
  const projectLines = projects.length
    ? projects
        .map((project) => `- ${project.name} (${project.status}, ${project.distance_mi} mi). ${project.description}`)
        .join("\n")
    : "No catalysts within a mile are on file.";
  const missingUnits = permits.some((permit) => permit.units == null);
  const risks = missingUnits
    ? "Some permits do not report a unit count."
    : "Every permit on file reports a unit count.";
  const memo_markdown = [
    `## Summary`,
    `${tract.name} scores ${tract.score} (percentile ${tract.percentile}). Momentum is ${tract.momentum} (${tract.momentum_pct}).`,
    ``,
    `## Signals`,
    `Multifamily permits ${tract.signals.mf_permits}. Permit momentum ${tract.signals.permit_momentum}. Infrastructure catalysts ${tract.signals.infra_proximity}.`,
    ``,
    `## Recent Permits`,
    permitLines,
    ``,
    `## Infrastructure Nearby`,
    projectLines,
    ``,
    `## Risks & Unknowns`,
    `${risks} ${tract.permit_count_24mo} permits and ${tract.units_24mo} units are on file for the last 24 months.`,
  ].join("\n");
  return {
    title: `${tract.name} — Path of Progress Memo`,
    memo_markdown,
  };
}
