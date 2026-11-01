"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { ProductFrame } from "@/components/upgrade-ui";
import type { AccountSnapshot, CheckoutIntent } from "@/lib/billing/pure";
import { proOfferCopy, reportOfferCopy } from "@/lib/billing/pure";

export default function UpgradeForm({
  initialIntent,
  geoid,
  surface,
  canceled,
}: {
  initialIntent: CheckoutIntent;
  geoid?: string;
  surface: string;
  canceled: boolean;
}) {
  const [intent, setIntent] = useState<CheckoutIntent>(initialIntent);
  const [email, setEmail] = useState("");
  const [account, setAccount] = useState<AccountSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void fetch("/api/account", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<AccountSnapshot>) : null))
      .then((body) => {
        if (!body) return;
        setAccount(body);
        if (body.email) setEmail(body.email);
      })
      .catch(() => setAccount(null));
  }, []);

  const trial = account?.trial_available !== false;
  const reportAvailable = Boolean(geoid);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, intent, geoid, surface }),
      });
      const body = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        setError(body.error ?? "Checkout is not available right now.");
        setPending(false);
        return;
      }
      window.location.assign(body.url);
    } catch {
      setError("Checkout is not available right now.");
      setPending(false);
    }
  }

  return (
    <ProductFrame account={account}>
      <h1 className="font-display text-4xl tracking-tight">Pro</h1>
      <p className="mt-3 max-w-xl font-sans text-sm leading-relaxed text-muted">
        Unlimited searches, full permit history, rehab candidates, owner names, and every IC memo.
      </p>
      {canceled ? (
        <p className="mt-4 font-sans text-sm">Checkout canceled. No charge was made.</p>
      ) : null}
      <form onSubmit={(event) => void submit(event)} className="mt-8 max-w-xl">
        <fieldset className="space-y-3">
          <legend className="sr-only">Plan</legend>
          {reportAvailable ? (
            <label className={`block border p-4 ${intent === "report" ? "border-ink" : "border-rule"}`}>
              <span className="flex items-start gap-3">
                <input
                  type="radio"
                  name="offer"
                  value="report"
                  checked={intent === "report"}
                  onChange={() => setIntent("report")}
                  className="mt-1"
                />
                <span>
                  <span className="font-sans text-sm font-medium">Just this report</span>
                  <span className="mt-1 block font-sans text-sm leading-relaxed text-muted">{reportOfferCopy()}</span>
                </span>
              </span>
            </label>
          ) : null}
          <label className={`block border p-4 ${intent === "pro" ? "border-ink" : "border-rule"}`}>
            <span className="flex items-start gap-3">
              <input
                type="radio"
                name="offer"
                value="pro"
                checked={intent === "pro"}
                onChange={() => setIntent("pro")}
                className="mt-1"
              />
              <span>
                <span className="font-sans text-sm font-medium">Pro: every report</span>
                <span className="mt-1 block font-sans text-sm leading-relaxed text-muted">{proOfferCopy(trial)}</span>
              </span>
            </span>
          </label>
        </fieldset>
        <label className="mt-6 block font-sans text-sm" htmlFor="upgrade-email">
          Work email
          <input
            id="upgrade-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            readOnly={Boolean(account?.email)}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-2 w-full border-b border-rule bg-transparent pb-1.5 outline-none read-only:text-muted focus:border-ink"
          />
        </label>
        {error ? <p className="mt-4 font-sans text-sm">{error}</p> : null}
        <button
          type="submit"
          disabled={pending}
          className="mt-6 h-12 w-full bg-ink font-sans text-sm font-medium text-paper disabled:opacity-40"
        >
          {pending ? "Opening checkout" : "Continue to checkout"}
        </button>
        <p className="mt-3 font-sans text-xs leading-relaxed text-muted">
          Checkout is on Stripe. A card is required
          {intent === "pro" && trial ? ", including for the trial" : ""}.
        </p>
      </form>
      <p className="mt-10 font-sans text-sm text-muted">
        Team and multi-metro plans are still{" "}
        <Link href="/pricing" className="underline underline-offset-2">
          on request
        </Link>
        .
      </p>
    </ProductFrame>
  );
}
