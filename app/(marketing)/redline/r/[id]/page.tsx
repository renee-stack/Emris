import type { Metadata } from "next";
import { Suspense } from "react";
import { MarketingShell } from "@/components/marketing/shell";
import { RedlineFlow } from "@/components/redline/redline-flow";

export const metadata: Metadata = {
  title: "Your Redline report",
  // A report link is private to whoever holds it, so keep it out of search results.
  robots: { index: false, follow: false },
};

export default function RedlineReportPage() {
  return (
    <MarketingShell current="redline">
      <main id="content">
        <Suspense>
          <RedlineFlow />
        </Suspense>
      </main>
    </MarketingShell>
  );
}
