import type { Metadata } from "next";
import { AccessForm } from "@/components/marketing/access-form";
import { Eyebrow, MarketingShell, container } from "@/components/marketing/shell";

export const metadata: Metadata = {
  title: "Request access",
  description:
    "Tell Emris where you invest. Early access includes a walkthrough of your metro, your top 10 tracts, and a sample IC memo.",
};

const steps = [
  {
    n: "01",
    title: "A 30-minute walkthrough",
    body: "On your target metro, not a canned demo city.",
  },
  {
    n: "02",
    title: "Your top 10 tracts",
    body: "With the filings driving each one.",
  },
  {
    n: "03",
    title: "A sample IC memo",
    body: "So you can judge the output before you commit.",
  },
];

export default function AccessPage() {
  return (
    <MarketingShell current="access">
      <main id="content" className="bg-[color-mix(in_srgb,var(--ink)_4%,var(--paper))]">
        <section className={`${container} grid items-start gap-12 py-16 lg:grid-cols-2 lg:py-24`}>
          <div>
            <Eyebrow>Early access</Eyebrow>
            <h1 className="mt-4 max-w-[12ch] font-display text-5xl leading-[0.96] tracking-tight sm:text-6xl">
              See what&apos;s moving in your market.
            </h1>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-ink/80">
              We&apos;re onboarding a small group of multifamily teams. Tell us where
              you invest and we&apos;ll walk you through your metro, scored tract by
              tract.
            </p>
            <ol className="mt-10 border-t border-rule">
              {steps.map((step) => (
                <li key={step.n} className="grid grid-cols-[2.5rem_1fr] gap-3 border-b border-rule py-5">
                  <span className="font-mono text-sm text-safety">{step.n}</span>
                  <div>
                    <h2 className="text-base font-semibold">{step.title}</h2>
                    <p className="mt-1 text-sm text-muted">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <AccessForm />
        </section>
      </main>
    </MarketingShell>
  );
}
