"use client";

import { useState } from "react";
import Link from "next/link";
import { buttonClass } from "@/components/marketing/cta";

export function BillingActions({ portal }: { portal: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-8 flex flex-col gap-3 sm:flex-row">
      <Link href="/pricing" className={`${buttonClass} sm:min-w-40`}>
        Upgrade
      </Link>
      {portal ? (
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-md border border-ink/25 bg-paper px-4 py-2.5 text-sm font-semibold"
          disabled={pending}
          onClick={() => {
            setPending(true);
            setError(null);
            void fetch("/api/billing/portal", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ flow: "billing" }),
            })
              .then(async (response) => {
                const data = (await response.json()) as { url?: string; error?: string };
                if (!response.ok || !data.url) throw new Error(data.error || "Couldn't open the portal.");
                window.location.href = data.url;
              })
              .catch((err: unknown) => {
                setError(err instanceof Error ? err.message : "Couldn't open the portal.");
                setPending(false);
              });
          }}
        >
          {pending ? "Opening…" : "Manage billing"}
        </button>
      ) : null}
      {error ? (
        <p className="text-sm text-safety sm:self-center" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
