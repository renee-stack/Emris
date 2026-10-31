import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { FaqList } from "@/components/marketing/faq";
import { EnterpriseForm } from "@/components/marketing/enterprise-form";
import { PricingBoard } from "@/components/marketing/pricing-board";
import { Eyebrow, MarketingShell, band, container } from "@/components/marketing/shell";
import { foundingSpotsLeft } from "@/lib/billing/rules";
import { countActiveFounding } from "@/lib/billing/store";
import {
  areaReport,
  comparison,
  formatUsd,
  pricingFaq,
  propertyReport,
  reports,
} from "@/lib/pricing";
import { adminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Free, Pro, and Team plans, plus one-off area and property reports. Founding membership is $99 a month while spots remain.",
};

async function spotsLeft(): Promise<number | null> {
  const admin = adminClient();
  if (!admin) return null;
  try {
    return foundingSpotsLeft(await countActiveFounding(admin));
  } catch (error) {
    console.error(error);
    return null;
  }
}

async function LiveBoard() {
  await connection();
  return <PricingBoard spotsLeft={await spotsLeft()} />;
}

export default function PricingPage() {
  return (
    <MarketingShell current="pricing">
      <main id="content">
        <section className={`${container} py-16 sm:py-20`}>
          <div className="text-center">
            <Eyebrow>Pricing</Eyebrow>
            <h1 className="mx-auto mt-4 max-w-[18ch] font-display text-5xl leading-[0.96] tracking-tight sm:text-6xl">
              Map for free. Pay when the decision is real.
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-muted">
              Free, Pro, and Team stay on the account. Area and property reports are one-time.
              Annual billing is two months free.
            </p>
          </div>
          <div className="mt-10">
            <Suspense fallback={<PricingBoard spotsLeft={null} />}>
              <LiveBoard />
            </Suspense>
          </div>
        </section>

        <section id="reports" className={`${container} scroll-mt-24 pb-16`}>
          <h2 className="font-display text-4xl tracking-tight">One-off reports</h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
            Buy a report from a tract, a drawn radius, or a property on the map. Payment creates an
            entitlement for that target. The server checks it before the report is served.
          </p>
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            {reports.map((report) => (
              <article key={report.id} className="rounded-2xl border border-rule bg-paper p-6">
                <div className="flex items-baseline justify-between gap-4">
                  <h3 className="font-display text-2xl tracking-tight">{report.name}</h3>
                  <p className="font-mono text-2xl">{formatUsd(report.cents)}</p>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted">{report.summary}</p>
                <ul className="mt-4 space-y-2 text-sm">
                  {report.includes.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
          <p className="mt-4 text-sm text-muted">
            {areaReport.name} {formatUsd(areaReport.cents)} · {propertyReport.name}{" "}
            {formatUsd(propertyReport.cents)}. Open the map and choose a target to buy.
          </p>
        </section>

        <section id="compare" className={`${container} scroll-mt-24 pb-20 sm:pb-24`}>
          <h2 className="font-display text-4xl tracking-tight">Compare plans</h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
            Without an account, the map and tract scores are available. A free account adds the Free
            column. A one-off report unlocks the paid fields for that area or property only.
          </p>
          <div className="mt-6 overflow-x-auto rounded-xl border border-rule">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <caption className="sr-only">Feature comparison across Free, Pro, and Team</caption>
              <thead className={band}>
                <tr>
                  <th scope="col" className="px-4 py-3 font-mono text-[11px] tracking-[0.14em] text-muted">
                    FEATURE
                  </th>
                  <th scope="col" className="px-4 py-3 font-mono text-[11px] tracking-[0.14em] text-muted">
                    FREE
                  </th>
                  <th scope="col" className="px-4 py-3 font-mono text-[11px] tracking-[0.14em] text-safety">
                    PRO
                  </th>
                  <th scope="col" className="px-4 py-3 font-mono text-[11px] tracking-[0.14em] text-muted">
                    TEAM
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((row) => (
                  <tr key={row.feature} className="border-t border-rule">
                    <th scope="row" className="px-4 py-3.5 font-medium">
                      {row.feature}
                    </th>
                    {row.cells.map((cell, index) => (
                      <td key={`${row.feature}-${index}`} className="px-4 py-3.5">
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
            <FaqList items={pricingFaq} />
          </div>
        </section>

        <section id="enterprise" className={`${container} scroll-mt-24 py-16 sm:py-20`}>
          <div className="grid gap-10 lg:grid-cols-[0.7fr_1.3fr]">
            <div>
              <Eyebrow>Enterprise</Eyebrow>
              <h2 className="mt-4 font-display text-4xl tracking-tight">A wider book needs a conversation.</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                Custom coverage, SSO, and an export. Tell us what the desk needs.
              </p>
            </div>
            <EnterpriseForm />
          </div>
        </section>
      </main>
    </MarketingShell>
  );
}
