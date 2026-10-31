import type { Metadata } from "next";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { Cta } from "@/components/marketing/cta";
import { FaqList } from "@/components/marketing/faq";
import { Eyebrow, MarketingShell, band, container } from "@/components/marketing/shell";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Emris is priced by the metros you invest in. Every plan includes the full six-signal composite score.",
};

const questions = [
  {
    q: "Is there a trial?",
    a: "Early access teams get a guided walkthrough of their own metro before committing.",
  },
  {
    q: "What counts as a metro?",
    a: "A Census-defined metropolitan statistical area. Every tract inside it is scored and ranked against its neighbors.",
  },
  {
    q: "My metro isn't covered yet. Can I still join?",
    a: "Yes. Tell us where you invest. Demand from active teams shapes which metros we add next.",
  },
  {
    q: "Annual billing?",
    a: "Available on every plan.",
  },
];

const rows: { feature: string; cells: string[] }[] = [
  { feature: "Metros", cells: ["1", "Several", "Custom"] },
  { feature: "Seats", cells: ["One team", "Growing team", "Unlimited"] },
  { feature: "Tract map and composite score", cells: ["Included", "Included", "Included"] },
  { feature: "Submarket scorecard", cells: ["Included", "Included", "Included"] },
  { feature: "Narrative briefs", cells: ["None", "Included", "Included"] },
  { feature: "IC memo PDF export", cells: ["None", "Included", "Included"] },
  { feature: "Watchlists and alerts", cells: ["None", "Included", "Included"] },
  { feature: "API and data export", cells: ["None", "None", "Included"] },
  { feature: "SSO and admin controls", cells: ["None", "None", "Included"] },
];

function Item({ children, onDark = false }: { children: ReactNode; onDark?: boolean }) {
  return (
    <li className="flex items-start gap-2.5 text-sm">
      <Check
        className={`mt-0.5 size-4 shrink-0 ${onDark ? "text-score-2" : "text-teal"}`}
        strokeWidth={2.5}
        aria-hidden="true"
      />
      <span>{children}</span>
    </li>
  );
}

export default function PricingPage() {
  return (
    <MarketingShell current="pricing">
      <main id="content">
        <section className={`${container} py-16 text-center sm:py-20`}>
          <Eyebrow>Pricing</Eyebrow>
          <h1 className="mx-auto mt-4 max-w-[16ch] font-display text-5xl leading-[0.96] tracking-tight sm:text-6xl">
            Priced by the metros you invest in.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-muted">
            Start with one market. Add metros and seats as your pipeline grows.
            Every plan includes the full six-signal composite score.
          </p>
          <div className="mt-12 grid items-stretch gap-6 pt-3 text-left lg:grid-cols-3">
            <article className="flex flex-col rounded-2xl border border-rule bg-paper p-6 lg:mt-6">
              <p className="font-mono text-[11px] tracking-[0.16em] text-muted">EXPLORER</p>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                For a single team watching one market.
              </p>
              <p className="mt-6 font-display text-4xl tracking-tight">On request</p>
              <Cta href="/landing/access" variant="outline" className="mt-6 w-full">
                Request access
              </Cta>
              <ul className="mt-6 space-y-3 border-t border-rule pt-5">
                <Item>1 metro</Item>
                <Item>Tract map and composite score</Item>
                <Item>Submarket scorecard</Item>
                <Item>Seats for one team</Item>
              </ul>
            </article>
            <article className="relative flex flex-col rounded-2xl bg-score-5 p-6 text-paper shadow-[0_24px_50px_-28px_rgba(14,79,72,0.8)]">
              <p className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full bg-safety px-3 py-1 font-mono text-[10px] tracking-[0.14em] text-paper">
                MOST TEAMS START HERE
              </p>
              <p className="font-mono text-[11px] tracking-[0.16em] text-paper/65">PROFESSIONAL</p>
              <p className="mt-3 text-sm leading-relaxed text-paper/80">
                For acquisitions teams building a multi-market pipeline.
              </p>
              <p className="mt-6 font-display text-4xl tracking-tight">On request</p>
              <Cta href="/landing/access" className="mt-6 w-full">
                Request access
              </Cta>
              <ul className="mt-6 space-y-3 border-t border-paper/15 pt-5">
                <Item onDark>Several metros</Item>
                <Item onDark>Everything in Explorer</Item>
                <Item onDark>Narrative briefs</Item>
                <Item onDark>IC memo PDF export</Item>
                <Item onDark>Watchlists and alerts</Item>
                <Item onDark>Seats for a growing team</Item>
              </ul>
            </article>
            <article className="flex flex-col rounded-2xl border border-rule bg-paper p-6 lg:mt-6">
              <p className="font-mono text-[11px] tracking-[0.16em] text-muted">ENTERPRISE</p>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                For developers and funds covering many markets.
              </p>
              <p className="mt-6 font-display text-4xl tracking-tight">Custom</p>
              <Cta href="/landing/access" variant="outline" className="mt-6 w-full">
                Talk to us
              </Cta>
              <ul className="mt-6 space-y-3 border-t border-rule pt-5">
                <Item>Custom metro coverage</Item>
                <Item>Everything in Professional</Item>
                <Item>API and data export</Item>
                <Item>Assemblage detection (roadmap)</Item>
                <Item>Unlimited seats, SSO</Item>
              </ul>
            </article>
          </div>
        </section>

        <section id="compare" className={`${container} scroll-mt-24 pb-20 sm:pb-24`}>
          <h2 className="font-display text-4xl tracking-tight">Compare plans</h2>
          <div className="mt-6 overflow-x-auto rounded-xl border border-rule">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <caption className="sr-only">Feature comparison across Explorer, Professional, and Enterprise</caption>
              <thead className={band}>
                <tr>
                  <th scope="col" className="px-4 py-3 font-mono text-[11px] tracking-[0.14em] text-muted">
                    FEATURE
                  </th>
                  <th scope="col" className="px-4 py-3 font-mono text-[11px] tracking-[0.14em] text-muted">
                    EXPLORER
                  </th>
                  <th scope="col" className="px-4 py-3 font-mono text-[11px] tracking-[0.14em] text-safety">
                    PROFESSIONAL
                  </th>
                  <th scope="col" className="px-4 py-3 font-mono text-[11px] tracking-[0.14em] text-muted">
                    ENTERPRISE
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.feature} className="border-t border-rule">
                    <th scope="row" className="px-4 py-3.5 font-medium">
                      {row.feature}
                    </th>
                    {row.cells.map((cell, index) => (
                      <td
                        key={`${row.feature}-${index}`}
                        className={`px-4 py-3.5 ${cell === "None" ? "text-muted" : "text-ink"}`}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={band}>
          <div className={`${container} grid gap-10 py-16 lg:grid-cols-[0.7fr_1.3fr] sm:py-20`}>
            <h2 className="font-display text-4xl tracking-tight">Pricing questions</h2>
            <FaqList items={questions} />
          </div>
        </section>
      </main>
    </MarketingShell>
  );
}
