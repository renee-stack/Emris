import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { Check } from "lucide-react";
import { FaqList } from "@/components/marketing/faq";
import { Eyebrow, MarketingShell, band, container } from "@/components/marketing/shell";
import { PricingBoard } from "@/components/marketing/pricing-board";
import { EnterpriseForm } from "@/components/marketing/enterprise-form";
import { foundingSpotsLeft } from "@/lib/billing/rules";
import { countActiveFounding } from "@/lib/billing/store";
import { adminClient } from "@/lib/supabase/admin";
import {
  FOUNDING_SPOTS,
  comparison,
  formatCents,
  pricing,
  pricingFaq,
} from "@/lib/pricing";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Free map access, Pro and Team subscriptions, Founding Member pricing, and one-off area or property reports.",
};

async function loadSpotsLeft(): Promise<number | null> {
  const admin = adminClient();
  if (!admin) return FOUNDING_SPOTS;
  try {
    const active = await countActiveFounding(admin);
    return foundingSpotsLeft(active);
  } catch {
    return null;
  }
}

export default function PricingPage() {
  return (
    <MarketingShell current="pricing">
      <Suspense
        fallback={
          <main id="content" className={`${container} py-16 sm:py-20`}>
            <p className="text-sm text-muted">Loading pricing…</p>
          </main>
        }
      >
        <PricingContent />
      </Suspense>
    </MarketingShell>
  );
}

async function PricingContent() {
  await connection();
  const spotsLeft = await loadSpotsLeft();
  const area = pricing.plans.areaReport;
  const property = pricing.plans.propertyReport;

  return (
    <main id="content">
      <section className={`${container} py-16 text-center sm:py-20`}>
        <Eyebrow>Pricing</Eyebrow>
        <h1 className="mx-auto mt-4 max-w-[16ch] font-display text-5xl leading-[0.96] tracking-tight sm:text-6xl">
          Start free. Pay when the filing record matters.
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-muted">
          Map scores stay free. Pro unlocks unlimited search, full permit detail, memos, and reports.
          Team adds seats. Founding locks a lower monthly price.
        </p>
        <div className="mt-12">
          <PricingBoard spotsLeft={spotsLeft} />
        </div>
      </section>

      <section className={`${band} border-y border-rule py-16 sm:py-20`}>
        <div className={container}>
          <Eyebrow>One-off reports</Eyebrow>
          <h2 className="mt-3 max-w-[18ch] font-display text-4xl tracking-tight sm:text-5xl">
            Buy a single report without a subscription.
          </h2>
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            <article className="rounded-2xl border border-rule bg-paper p-6">
              <p className="font-mono text-[11px] tracking-[0.16em] text-muted">AREA REPORT</p>
              <p className="mt-4 font-display text-4xl tracking-tight">{formatCents(area.oneTimeCents!)}</p>
              <p className="mt-3 text-sm leading-relaxed text-muted">{area.summary}</p>
              <ul className="mt-5 space-y-2 text-sm">
                {area.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5">
                    <Check className="mt-0.5 size-4 shrink-0 text-teal" strokeWidth={2.5} aria-hidden="true" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-xs text-muted">
                Start checkout from a tract or radius after sign-in via{" "}
                <code className="font-mono">POST /api/checkout</code>.
              </p>
            </article>
            <article className="rounded-2xl border border-rule bg-paper p-6">
              <p className="font-mono text-[11px] tracking-[0.16em] text-muted">PROPERTY REPORT</p>
              <p className="mt-4 font-display text-4xl tracking-tight">{formatCents(property.oneTimeCents!)}</p>
              <p className="mt-3 text-sm leading-relaxed text-muted">{property.summary}</p>
              <ul className="mt-5 space-y-2 text-sm">
                {property.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5">
                    <Check className="mt-0.5 size-4 shrink-0 text-teal" strokeWidth={2.5} aria-hidden="true" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </article>
          </div>
        </div>
      </section>

      <section className={`${container} py-16 sm:py-20`}>
        <Eyebrow>Compare</Eyebrow>
        <h2 className="mt-3 font-display text-4xl tracking-tight">What each plan includes</h2>
        <div className="mt-8 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-rule">
                <th className="py-3 pr-4 font-medium text-muted">Feature</th>
                <th className="px-4 py-3 font-medium">Free</th>
                <th className="px-4 py-3 font-medium">Pro</th>
                <th className="px-4 py-3 font-medium">Team</th>
              </tr>
            </thead>
            <tbody>
              {comparison.map((row) => (
                <tr key={row.feature} className="border-b border-rule/70">
                  <td className="py-3 pr-4 text-muted">{row.feature}</td>
                  {row.cells.map((cell, index) => (
                    <td key={`${row.feature}-${index}`} className="px-4 py-3">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={`${band} border-y border-rule py-16 sm:py-20`}>
        <div className={`${container} grid gap-10 lg:grid-cols-2 lg:items-start`}>
          <div>
            <Eyebrow>Enterprise</Eyebrow>
            <h2 className="mt-3 font-display text-4xl tracking-tight">Larger funds and custom coverage</h2>
            <p className="mt-4 text-sm leading-relaxed text-muted">{pricing.plans.enterprise.summary}</p>
          </div>
          <EnterpriseForm />
        </div>
      </section>

      <section className={`${container} py-16 sm:py-20`}>
        <Eyebrow>FAQ</Eyebrow>
        <h2 className="mt-3 font-display text-4xl tracking-tight">Common questions</h2>
        <div className="mt-8">
          <FaqList items={pricingFaq} />
        </div>
      </section>
    </main>
  );
}
