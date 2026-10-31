import Link from "next/link";
import { Cta } from "@/components/marketing/cta";
import { MomentumCard } from "@/components/marketing/momentum-card";
import { Eyebrow, MarketingShell, band, container } from "@/components/marketing/shell";

const signals = [
  {
    n: "01",
    title: "Multifamily permits",
    body: "New building, demolition and conversion permits, by unit count and stage.",
  },
  {
    n: "02",
    title: "Entitlements and rezoning",
    body: "Upzoning, variances and planned developments moving through hearings.",
  },
  {
    n: "03",
    title: "Infrastructure CIP filings",
    body: "Capital improvement plans that fund transit, streetscape and utilities.",
  },
  {
    n: "04",
    title: "Commercial anchor openings",
    body: "Grocers, employers and retail that signal where demand is heading.",
  },
  {
    n: "05",
    title: "Parcel and assessor activity",
    body: "Ownership transfers and value changes that hint at quiet assemblage.",
  },
  {
    n: "06",
    title: "Census and ACS demographics",
    body: "Household formation, income and renter share to ground the story.",
  },
];

const movers = [
  { name: "Riverside North", score: "91", driver: "Planned development approved" },
  { name: "Eastline Corridor", score: "86", driver: "Transit CIP funded" },
  { name: "Mill District", score: "82", driver: "Two 200+ unit permits" },
  { name: "Southport Yards", score: "77", driver: "Upzoning hearing scheduled" },
  { name: "Grove Park West", score: "73", driver: "Grocery anchor opening" },
];

const steps = [
  {
    kicker: "Step 1 · Ingest",
    title: "Pull every public filing",
    body: "Permit portals, zoning agendas, capital plans, assessor rolls and Census data are collected and mapped to the census tract they touch.",
  },
  {
    kicker: "Step 2 · Score",
    title: "Weight what matters now",
    body: "Recent activity counts more than old activity. Each tract is ranked against its own metro and compared with where it stood a year ago.",
  },
  {
    kicker: "Step 3 · Translate",
    title: "Write it for the room",
    body: "Scores become plain-English briefs, watchlist alerts and exportable memos your partners can read in two minutes.",
  },
];

const audiences = [
  {
    title: "Acquisitions teams",
    body: "Build a pipeline of submarkets to underwrite before brokers start calling.",
  },
  {
    title: "Multifamily developers",
    body: "Spot entitlement momentum and land assembly early, and defend the site in committee.",
  },
  {
    title: "Capital partners",
    body: "Pressure-test a sponsor's thesis with the same tract-level evidence they use.",
  },
];

const chips = [
  { label: "Entitlement ↑", className: "border-safety/30 bg-safety/10 text-safety" },
  { label: "Permits ↑", className: "border-safety/30 bg-safety/10 text-safety" },
  { label: "CIP funded", className: "border-teal/30 bg-teal/10 text-teal" },
  { label: "Possible assemblage", className: "border-score-4/30 bg-score-1 text-score-5" },
];

function Trend() {
  const bars = [5, 6, 7, 6, 8, 7, 9, 12];
  return (
    <span className="inline-flex h-4 items-end gap-[3px]" aria-hidden="true">
      {bars.map((height, index) => (
        <span
          key={index}
          className={`w-[5px] rounded-[1px] ${index === bars.length - 1 ? "bg-safety" : "bg-score-3"}`}
          style={{ height }}
        />
      ))}
    </span>
  );
}

export default function LandingPage() {
  return (
    <MarketingShell current="home">
      <main id="content">
        <section className={`${container} grid items-center gap-12 py-16 lg:grid-cols-2 lg:py-24`}>
          <div>
            <Eyebrow>Permit and construction intelligence for multifamily</Eyebrow>
            <h1 className="mt-4 max-w-[12ch] font-display text-5xl leading-[0.95] tracking-[-0.035em] sm:text-6xl">
              See the path of progress before the market prices it in.
            </h1>
            <p className="mt-6 max-w-md text-[15px] leading-relaxed text-ink/80">
              Emris reads permit, zoning, entitlement and infrastructure filings
              for every census tract in a metro, scores the momentum, and writes
              it up in plain English your investment committee can act on.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Cta href="/access">Request access</Cta>
              <Cta href="/map" variant="outline">
                Test it out
              </Cta>
              <Cta href="/platform#scoring" variant="outline">
                How scoring works
              </Cta>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
              <li>Census tract resolution</li>
              <li>Six weighted signals</li>
              <li>IC memo export</li>
            </ul>
          </div>
          <MomentumCard />
        </section>

        <section id="signals" className="border-t border-rule">
          <div className={`${container} py-20 sm:py-24`}>
            <div className="grid items-center gap-8 lg:grid-cols-2">
              <h2 className="max-w-[14ch] font-display text-4xl leading-[0.98] tracking-tight sm:text-5xl">
                Six signals. One composite score.
              </h2>
              <p className="max-w-md text-[15px] leading-relaxed text-muted lg:justify-self-end">
                Any one data source can be found somewhere. What no one else gives
                you is all six, weighted, decayed over time and ranked against the
                rest of the metro, so a real shift stands out from the noise.
              </p>
            </div>
            <div className="mt-12 grid gap-px border border-rule bg-rule sm:grid-cols-3">
              {signals.map((signal) => (
                <article key={signal.n} className="bg-paper p-6">
                  <p className="font-mono text-[11px] tracking-[0.14em] text-safety">
                    {signal.n}
                  </p>
                  <h3 className="mt-3 text-base font-semibold">{signal.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{signal.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="scorecard" className={band}>
          <div className={`${container} py-20 sm:py-24`}>
            <Eyebrow>The submarket scorecard</Eyebrow>
            <h2 className="mt-4 max-w-[16ch] font-display text-4xl leading-[0.98] tracking-tight sm:text-5xl">
              From raw filings to an IC-ready answer.
            </h2>
            <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-muted">
              Rank every tract by momentum, see what is driving it, and pull a
              written brief without opening a single PDF from the city.
            </p>
            <div className="mt-10 grid items-stretch gap-5 lg:grid-cols-2">
              <article className="rounded-2xl border border-rule bg-paper p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-base font-semibold">Top movers this quarter</h3>
                  <span className="rounded-full border border-rule px-2.5 py-1 font-mono text-[9px] tracking-[0.14em] text-muted">
                    ILLUSTRATIVE DATA
                  </span>
                </div>
                <div className="mt-4 hidden grid-cols-[1.3fr_3rem_5.5rem_1.15fr] gap-3 pb-2 font-mono text-[10px] tracking-[0.14em] text-muted sm:grid">
                  <span>SUBMARKET</span>
                  <span>SCORE</span>
                  <span>12-MO TREND</span>
                  <span>TOP DRIVER</span>
                </div>
                <ul>
                  {movers.map((row) => (
                    <li
                      key={row.name}
                      className="grid grid-cols-2 items-center gap-x-4 gap-y-1 border-t border-rule py-3 sm:grid-cols-[1.3fr_3rem_5.5rem_1.15fr]"
                    >
                      <span className="text-sm font-medium">{row.name}</span>
                      <span className="font-display text-xl">{row.score}</span>
                      <span className="hidden sm:block">
                        <Trend />
                        <span className="sr-only">Rising over 12 months</span>
                      </span>
                      <span className="col-span-2 text-sm text-muted sm:col-span-1 sm:text-ink">
                        {row.driver}
                      </span>
                    </li>
                  ))}
                </ul>
              </article>
              <article className="flex flex-col rounded-2xl border border-rule bg-paper p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-base font-semibold">Narrative brief · Riverside North</h3>
                  <span className="rounded-full border border-rule px-2.5 py-1 font-mono text-[9px] tracking-[0.14em] text-muted">
                    SAMPLE
                  </span>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-ink/85">
                  Riverside North moved into the top decile of the metro this
                  quarter. The shift is led by an approved planned development
                  along the river corridor and two multifamily permits totaling
                  roughly 480 units. The city&apos;s capital plan funds a streetscape
                  and transit upgrade within a half mile, and three adjacent
                  parcels changed hands to related LLCs in the last 90 days, a
                  pattern consistent with early assemblage.
                </p>
                <ul className="mt-4 flex flex-wrap gap-2">
                  {chips.map((chip) => (
                    <li
                      key={chip.label}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium ${chip.className}`}
                    >
                      {chip.label}
                    </li>
                  ))}
                </ul>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-4 text-sm">
                  <p className="text-muted">Every sentence links back to its source filing.</p>
                  <Link href="/platform#export" className="font-semibold hover:text-teal">
                    Export as IC memo →
                  </Link>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section id="how-it-works" className={`${container} py-20 sm:py-24`}>
          <h2 className="font-display text-4xl tracking-tight sm:text-5xl">How Emris works</h2>
          <div className="mt-10 grid gap-10 md:grid-cols-3">
            {steps.map((step) => (
              <article key={step.kicker} className="border-t-2 border-ink pt-5">
                <p className="font-mono text-[11px] tracking-[0.14em] text-safety uppercase">
                  {step.kicker}
                </p>
                <h3 className="mt-3 text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
              </article>
            ))}
          </div>
          <div className="mt-14 grid gap-4 md:grid-cols-3">
            {audiences.map((audience) => (
              <article key={audience.title} className="rounded-xl border border-rule p-5">
                <h3 className="text-sm font-semibold">{audience.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{audience.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="bg-score-5 text-paper">
          <div className={`${container} grid items-center gap-8 py-16 lg:grid-cols-[1.1fr_0.9fr] lg:py-20`}>
            <h2 className="max-w-[12ch] font-display text-4xl leading-[0.98] tracking-tight sm:text-5xl">
              Find the next submarket first.
            </h2>
            <div>
              <p className="max-w-md text-sm leading-relaxed text-paper/80">
                Emris is onboarding a small group of multifamily teams in our
                launch metros. Tell us where you invest and we will show you what
                is moving there.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Cta href="/access">Request access</Cta>
                <Cta href="/map" variant="outlineLight">
                  Test it out
                </Cta>
                <Cta href="/pricing" variant="outlineLight">
                  See pricing
                </Cta>
              </div>
            </div>
          </div>
        </section>
      </main>
    </MarketingShell>
  );
}
