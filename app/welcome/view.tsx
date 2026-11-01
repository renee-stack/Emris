"use client";

import { useEffect, useState } from "react";
import { ProductFrame } from "@/components/upgrade-ui";
import { PRO_MONTHLY_USD, type AccountSnapshot } from "@/lib/billing/pure";

interface Ready {
  status: "ready";
  intent: string | null;
  geoid: string | null;
  trialEndsLabel: string | null;
}

type View =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "error"; message: string }
  | Ready;

export default function WelcomeView({ sessionId }: { sessionId: string }) {
  const [account, setAccount] = useState<AccountSnapshot | null>(null);
  const [view, setView] = useState<View>(sessionId ? { status: "loading" } : { status: "missing" });
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void fetch("/api/account", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<AccountSnapshot>) : null))
      .then((body) => setAccount(body))
      .catch(() => setAccount(null));
    if (!sessionId) return;
    void fetch(`/api/checkout?session_id=${encodeURIComponent(sessionId)}`, { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json()) as {
          ok?: boolean;
          error?: string;
          intent?: string | null;
          geoid?: string | null;
          trial_ends_label?: string | null;
        };
        if (!res.ok || !body.ok) {
          setView({ status: "error", message: body.error ?? "We couldn't confirm checkout yet. Refresh this page." });
          return;
        }
        setView({
          status: "ready",
          intent: body.intent ?? null,
          geoid: body.geoid ?? null,
          trialEndsLabel: body.trial_ends_label ?? null,
        });
        const next = await fetch("/api/account", { cache: "no-store" });
        if (next.ok) setAccount((await next.json()) as AccountSnapshot);
      })
      .catch(() => {
        setView({ status: "error", message: "We couldn't confirm checkout yet. Refresh this page." });
      });
  }, [sessionId]);

  async function openMap() {
    if (view.status !== "ready" || pending) return;
    setPending(true);
    try {
      await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "onboarding_complete" }),
      });
    } catch {
      // The map is still the right next step if the event doesn't record.
    }
    const href =
      view.intent === "report" && view.geoid ? `/map?tract=${view.geoid}` : "/map";
    window.location.assign(href);
  }

  return (
    <ProductFrame account={account}>
      {view.status === "loading" ? <p className="font-sans text-sm text-muted">Confirming checkout.</p> : null}
      {view.status === "missing" ? (
        <p className="font-sans text-sm">This page confirms a checkout. Start from Upgrade.</p>
      ) : null}
      {view.status === "error" ? <p className="font-sans text-sm">{view.message}</p> : null}
      {view.status === "ready" ? (
        <>
          <h1 className="font-display text-4xl tracking-tight">
            {view.intent === "report" ? "Report purchased" : "Pro is active"}
          </h1>
          <p className="mt-4 max-w-xl font-sans text-sm leading-relaxed">
            {view.intent === "report"
              ? "The report for this tract is on the account. It includes the full IC memo and the record lists."
              : view.trialEndsLabel
                ? `Pro is active on a 7-day trial. A card is on file. You will be charged $${PRO_MONTHLY_USD} on ${view.trialEndsLabel} unless you cancel before then.`
                : `Pro is active. $${PRO_MONTHLY_USD} a month is billed to the card on file.`}
          </p>
          <button
            type="button"
            onClick={() => void openMap()}
            disabled={pending}
            className="mt-8 h-12 bg-ink px-6 font-sans text-sm font-medium text-paper disabled:opacity-40"
          >
            Open the map
          </button>
        </>
      ) : null}
    </ProductFrame>
  );
}
