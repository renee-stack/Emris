import { Suspense } from "react";
import type { Metadata } from "next";
import WelcomeView from "./view";

export const metadata: Metadata = {
  title: "Welcome",
};

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  return (
    <Suspense fallback={<p className="fixed inset-0 bg-paper p-10 font-sans text-sm text-muted">Confirming checkout.</p>}>
      <ConfirmedCheckout searchParams={searchParams} />
    </Suspense>
  );
}

async function ConfirmedCheckout({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const sessionId = first(params.session_id);
  return <WelcomeView sessionId={sessionId.startsWith("cs_") ? sessionId : ""} />;
}
