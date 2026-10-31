import type { Metadata } from "next";
import { Bell, FileDown, FileText, Layers, Map, Rows3 } from "lucide-react";
import type { ComponentType } from "react";
import { Cta } from "@/components/marketing/cta";
import { FaqList } from "@/components/marketing/faq";
import { Eyebrow, MarketingShell, band, container } from "@/components/marketing/shell";

export const metadata: Metadata = {
  title: "Platform",
  description:
    "How Emris turns public records into a tract score, a narrative brief, and an investment-committee memo.",
};

const pipeline = [
  {
    n: "01 →",
    title: "Public filings",
    body: "Permits, agendas, capital plans, assessor rolls, ACS.",
  },
  {
    n: "02 →",
    title: "Geocode to tract",
    body: "Every record pinned to the census tract it affects.",
  },
  {
    n: "03 →",
    title: "Time-decay weighting",
    body: "Fresh activity counts more than last year's.",
  },
  {
    n: "04 →",
    title: "Metro percentile",
    body: "Each tract ranked against its own metro, not the nation.",
  },
  {
    n: "05 →",
    title: "Composite and momentum",
    body: "Six signals blended, then compared with 12 months prior.",
  },
  {
    n: "06",
    title: "Briefs, alerts, memos",
    body: "Plain-English output your committee can read.",
    last: true,
  },
];

const bars = [
  { label: "Entitlements and rezoning", meta: "97th pct · 3 filings", width: "97%", hot: true },
  { label: "Multifamily permits", meta: "94th pct · 2 permits", width: "94%", hot: false },
  { label: "Infrastructure CIP", meta: "89th pct · 1 project", width: "89%", hot: false },
  { label: "Parcel and assessor", meta: "84th pct · 3 transfers", width: "84%", hot: false },
  { label: "Commercial anchors", meta: "68th pct · 1 opening", width: "68%", hot: false },
  { label: "Census and ACS", meta: "61st pct · ACS 5-yr", width: "61%", hot: false },
];

const principles = [
  {
    letter: "A",
    title: "Time-decay weighting",
    body: "A permit filed last month moves the score more than one filed two years ago.",
  },
  {
    letter: "B",
    title: "Percentile rank within metro",
    body: "A 90 means top 10% of that metro, so scores compare cleanly across cities.",
  },
  {
    letter: "C",
    title: "Momentum vs. 12 months prior",
    body: "Direction matters as much as level. See which tracts are accelerating.",
  },
];

const features: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  body: string;
  roadmap?: boolean;
  id?: string;
}[] = [
  {
    icon: Map,
    title: "Tract map",
    body: "A choropleth of every tract in the metro. Toggle any of the six signals or the composite.",
  },
  {
    icon: Rows3,
    title: "Submarket scorecard",
    body: "Rank and filter tracts by score, momentum, unit pipeline or the signal that matters to your thesis.",
  },
  {
    icon: FileText,
    title: "Narrative briefs",
    body: "A plain-English summary of why a tract is moving, with every claim linked to its filing.",
  },
  {
    icon: FileDown,
    title: "IC memo export",
    body: "One click to a formatted PDF with map, score breakdown and narrative, ready for committee.",
    id: "export",
  },
  {
    icon: Bell,
    title: "Watchlists and alerts",
    body: "Follow tracts and get notified when a filing or a score change crosses your threshold.",
  },
  {
    icon: Layers,
    title: "Assemblage detection",
    body: "Flags adjacent parcels changing hands to related owners, often the earliest sign of a project.",
    roadmap: true,
  },
];

const questions = [
  {
    q: "Where does the data come from?",
    a: "Public records only: municipal permit portals, planning and zoning agendas, capital improvement plans, county assessors and the Census Bureau.",
  },
  {
    q: "How often are scores updated?",
    a: "As new public filings are ingested. Alerts fire as soon as a new filing is ingested.",
  },
  {
    q: "Why census tracts and not zip codes?",
    a: "Tracts are small, stable and line up with Census data, so a shift on one corridor isn't averaged away across a whole zip.",
  },
  {
    q: "Can I export for my investment committee?",
    a: "Yes. Any tract or submarket exports to a formatted PDF memo with the map, score breakdown and narrative.",
  },
];

export default function PlatformPage() {
  return (
    <MarketingShell current="platform">
      <main id="content">
        <section className={`${container} py-16 sm:py-20`}>
          <Eyebrow>The platform</Eyebrow>
          <h1 className="mt-4 max-w-[16ch] font-display text-5xl leading-[0.96] tracking-tight sm:text-6xl">
            How Emris turns public records into a decision.
          </h1>
          <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-muted">
            Permit portals were built for inspectors, not investors. Emris does the
            reading, mapping and ranking for you, then shows its work so you can
            defend every call.
          </p>
          <div id="scoring" className="mt-14 scroll-mt-24">
            <p className="font-mono text-[11px] tracking-[0.16em] text-muted">
              THE SCORING PIPELINE
            </p>
            <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              {pipeline.map((step) => (
                <li
                  key={step.n}
                  className={
                    step.last
                      ? "rounded-xl bg-ink p-4 text-paper"
                      : "rounded-xl border border-rule bg-paper p-4"
                  }
                >
                  <p
                    className={`font-mono text-[11px] tracking-wide ${step.last ? "text-paper/60" : "text-muted"}`}
                  >
                    {step.n}
                  </p>
                  <h2 className="mt-3 text-sm font-semibold">{step.title}</h2>
                  <p className={`mt-2 text-sm leading-relaxed ${step.last ? "text-paper/75" : "text-muted"}`}>
                    {step.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="breakdown" className={`${band} scroll-mt-24`}>
          <div className={`${container} grid items-center gap-12 py-20 lg:grid-cols-2 sm:py-24`}>
            <div>
              <h2 className="max-w-[14ch] font-display text-4xl leading-[0.98] tracking-tight sm:text-5xl">
                A score you can open up.
              </h2>
              <p className="mt-4 max-w-md text-[15px] leading-relaxed text-muted">
                Black-box scores don&apos;t survive investment committee. Every Emris
                score breaks down into its six categories, and every category links
                to the filings behind it.
              </p>
              <ol className="mt-8 space-y-5">
                {principles.map((item) => (
                  <li key={item.letter} className="grid grid-cols-[1.5rem_1fr] gap-3">
                    <span className="font-mono text-sm text-safety">{item.letter}</span>
                    <div>
                      <h3 className="text-sm font-semibold">{item.title}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-muted">{item.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <article className="rounded-2xl border border-rule bg-paper p-5 shadow-sm sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <p className="font-mono text-[11px] tracking-[0.12em] text-muted">
                  TRACT 0412.03 · RIVERSIDE NORTH
                </p>
                <span className="shrink-0 rounded-full border border-rule px-2.5 py-1 font-mono text-[9px] tracking-[0.14em] text-muted">
                  ILLUSTRATIVE DATA
                </span>
              </div>
              <p className="mt-3 flex items-baseline gap-3">
                <span className="font-display text-5xl leading-none tracking-tight">91</span>
                <span className="text-sm font-medium text-teal">▲ +14 YoY</span>
              </p>
              <ul className="mt-6 space-y-4">
                {bars.map((bar) => (
                  <li key={bar.label}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="font-medium">{bar.label}</span>
                      <span className="shrink-0 text-muted">{bar.meta}</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-score-1">
                      <div
                        className={`h-full rounded-full ${bar.hot ? "bg-safety" : "bg-teal"}`}
                        style={{ width: bar.width }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
              <a href="#sources" className="mt-6 inline-block text-sm font-semibold hover:text-teal">
                View source filings →
              </a>
            </article>
          </div>
        </section>

        <section className={band}>
          <div className={`${container} border-t border-rule py-20 sm:py-24`}>
            <h2 className="max-w-[16ch] font-display text-4xl leading-[0.98] tracking-tight sm:text-5xl">
              Everything you need to go from map to memo.
            </h2>
            <ul className="mt-10 grid gap-4 md:grid-cols-3">
              {features.map((feature) => {
                const Icon = feature.icon;
                return (
                  <li
                    key={feature.title}
                    id={feature.id}
                    className={
                      feature.roadmap
                        ? "scroll-mt-24 rounded-xl border border-dashed border-ink/25 bg-paper/50 p-5"
                        : "scroll-mt-24 rounded-xl border border-rule bg-paper p-5"
                    }
                  >
                    <div className="flex items-center justify-between gap-3">
                      <Icon className="size-5 text-safety" strokeWidth={1.75} aria-hidden="true" />
                      {feature.roadmap ? (
                        <span className="rounded-full border border-rule px-2 py-0.5 font-mono text-[9px] tracking-[0.14em] text-muted">
                          ON THE ROADMAP
                        </span>
                      ) : null}
                    </div>
                    <h3 className="mt-4 text-sm font-semibold">{feature.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted">{feature.body}</p>
                  </li>
                );
              })}
            </ul>
            <div id="sources" className="mt-16 grid scroll-mt-24 gap-10 lg:grid-cols-[0.8fr_1.2fr]">
              <div>
                <h2 className="font-display text-4xl tracking-tight">Questions teams ask</h2>
                <p className="mt-4 text-sm leading-relaxed text-muted">
                  Launch coverage: Chicago. More metros are added based on the
                  quality of their public data.
                </p>
              </div>
              <FaqList items={questions} />
            </div>
          </div>
        </section>

        <section className="bg-score-5 text-paper">
          <div className={`${container} flex flex-col items-start justify-between gap-8 py-16 sm:py-20 lg:flex-row lg:items-center`}>
            <h2 className="max-w-[16ch] font-display text-4xl leading-[0.98] tracking-tight sm:text-5xl">
              See your metro scored, tract by tract.
            </h2>
            <Cta href="/access">Request access</Cta>
          </div>
        </section>
      </main>
    </MarketingShell>
  );
}
