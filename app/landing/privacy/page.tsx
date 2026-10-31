import type { Metadata } from "next";
import { MarketingShell, container } from "@/components/marketing/shell";

export const metadata: Metadata = {
  title: "Privacy",
  description: "How the Emris marketing site handles an access request.",
};

export default function PrivacyPage() {
  return (
    <MarketingShell>
      <main id="content">
        <article className={`${container} max-w-3xl py-16 sm:py-20`}>
          <h1 className="font-display text-5xl tracking-tight">Privacy</h1>
          <div className="mt-8 space-y-5 text-[15px] leading-relaxed text-ink/85">
            <p>
              Emris scores public records: municipal permit portals, planning and
              zoning agendas, capital improvement plans, county assessors, and the
              Census Bureau.
            </p>
            <p>
              The request-access form on this site confirms in your browser. It
              does not transmit your name, email, company, role, or notes to a
              server, and it does not add you to a marketing list.
            </p>
            <p>
              Tract names, scores, and prices marked illustrative on these pages
              are samples. The live Chicago map is the product at the home route,
              and it reads the same public-record files the app already serves.
            </p>
          </div>
        </article>
      </main>
    </MarketingShell>
  );
}
