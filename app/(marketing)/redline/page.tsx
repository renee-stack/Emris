import type { Metadata } from "next";
import { Suspense } from "react";
import { MarketingShell } from "@/components/marketing/shell";
import { RedlineFlow } from "@/components/redline/redline-flow";

export const metadata: Metadata = {
  title: "Redline",
  description: "Drop in a building permit correction letter and see every comment sorted, with who needs to act, before you pay anything.",
};

export default function RedlinePage() {
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
