import { Suspense } from "react";
import type { Metadata } from "next";
import UpgradeForm from "./form";
import { GEOID_RE, type CheckoutIntent } from "@/lib/billing/pure";

export const metadata: Metadata = {
  title: "Pro",
  description: "Emris Pro is a 7-day trial, then $249 a month. A single tract report is $79.",
};

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default function UpgradePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  return (
    <Suspense fallback={<p className="fixed inset-0 bg-paper p-10 font-sans text-sm text-muted">Loading.</p>}>
      <UpgradeOffer searchParams={searchParams} />
    </Suspense>
  );
}

async function UpgradeOffer({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const requested = first(params.geoid);
  const geoid = GEOID_RE.test(requested) ? requested : undefined;
  const intent: CheckoutIntent = first(params.intent) === "report" && geoid ? "report" : "pro";
  return (
    <UpgradeForm
      initialIntent={intent}
      geoid={geoid}
      surface={first(params.surface) || "upgrade"}
      canceled={first(params.canceled) === "1"}
    />
  );
}
