"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { buttonClass } from "@/components/marketing/cta";
import {
  FOUNDING_SPOTS,
  TEAM_MIN_SEATS,
  annualCents,
  formatUsd,
  foundingPlan,
  freePlan,
  proPlan,
  teamPlan,
  type Interval,
} from "@/lib/pricing";

function Item({ children, onDark = false }: { children: string; onDark?: boolean }) {
  return (
    <li className="flex items-start gap-2.5 text-sm">
      <Check
        className={`mt-0.5 size-4 shrink-0 ${onDark ? "text-score-2" : "text-teal"}`}
        strokeWidth={2.5}
        aria-hidden="true"
      />
      <span>{children}</span>
    </li>
  );
}

async function beginCheckout(plan: "pro" | "team" | "founding", interval: Interval): Promise<string> {
  const response = await fetch("/api/billing/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plan, interval: plan === "founding" ? "month" : interval }),
  });
  const data = (await response.json()) as { url?: string; error?: string; code?: string };
  if (response.status === 401) return "sign-in";
  if (!response.ok || !data.url) {
    throw new Error(data.error || "Checkout could not start.");
  }
  return data.url;
}

export function PricingBoard({ spotsLeft }: { spotsLeft: number | null }) {
  const router = useRouter();
  const [interval, setInterval] = useState<Interval>("month");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const showFounding = spotsLeft === null || spotsLeft > 0;
  const annual = interval === "year";

  function priceLine(monthlyCents: number, perSeat: boolean) {
    const amount = annual ? annualCents(monthlyCents) : monthlyCents;
    const suffix = perSeat ? (annual ? "/seat/year" : "/seat/month") : annual ? "/year" : "/month";
    return { amount: formatUsd(amount), suffix };
  }

  const pro = priceLine(proPlan.monthlyCents, false);
  const team = priceLine(teamPlan.monthlyCents, true);

  async function buy(plan: "pro" | "team" | "founding") {
    setError(null);
    setPending(plan);
    try {
      const destination = await beginCheckout(plan, interval);
      if (destination === "sign-in") {
        router.push("/account/billing?next=/pricing");
        return;
      }
      window.location.assign(destination);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout could not start.");
      setPending(null);
    }
  }

  return (
    <div>
      <div
        className="mx-auto flex w-fit items-center gap-1 rounded-full border border-rule bg-paper p-1"
        role="radiogroup"
        aria-label="Billing interval"
      >
        <button
          type="button"
          role="radio"
          aria-checked={interval === "month"}
          className={`rounded-full px-4 py-2 text-sm font-semibold ${interval === "month" ? "bg-ink text-paper" : "text-ink"}`}
          onClick={() => setInterval("month")}
        >
          Monthly
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={interval === "year"}
          className={`rounded-full px-4 py-2 text-sm font-semibold ${interval === "year" ? "bg-ink text-paper" : "text-ink"}`}
          onClick={() => setInterval("year")}
        >
          Annual
          <span className="ml-2 font-mono text-[10px] tracking-[0.12em] text-safety uppercase">2 months free</span>
        </button>
      </div>

      {showFounding ? (
        <aside className="mt-8 rounded-2xl bg-score-5 px-5 py-4 text-paper sm:flex sm:items-center sm:justify-between sm:gap-6">
          <p className="text-sm leading-relaxed">
            <span className="font-semibold">Founding member: {formatUsd(foundingPlan.monthlyCents)}/month for life</span>
            {spotsLeft === null
              ? `, ${FOUNDING_SPOTS} spots.`
              : `, ${spotsLeft} of ${FOUNDING_SPOTS} spots left.`}{" "}
            Pro features, billed monthly, price locked.
          </p>
          <button
            type="button"
            className="mt-3 shrink-0 rounded-md bg-safety px-4 py-2.5 text-sm font-semibold text-paper sm:mt-0"
            disabled={pending !== null}
            onClick={() => void buy("founding")}
          >
            {pending === "founding" ? "Starting…" : "Claim a spot"}
          </button>
        </aside>
      ) : null}

      {error ? (
        <p className="mt-4 text-sm text-safety" role="alert">
          {error}
        </p>
      ) : null}

      <div id="plans" className="mt-10 grid items-stretch gap-6 text-left lg:grid-cols-3">
        <article className="flex flex-col rounded-2xl border border-rule bg-paper p-6 lg:mt-6">
          <p className="font-mono text-[11px] tracking-[0.16em] text-muted">FREE</p>
          <p className="mt-3 text-sm leading-relaxed text-muted">{freePlan.summary}</p>
          <p className="mt-6 font-mono text-4xl tracking-tight">
            {formatUsd(0)}
            <span className="text-base text-muted">/month</span>
          </p>
          <Link
            href="/map"
            className="mt-6 inline-flex w-full items-center justify-center rounded-md border border-ink/25 bg-paper px-4 py-2.5 text-sm font-semibold text-ink"
          >
            Create a free account
          </Link>
          <ul className="mt-6 space-y-3 border-t border-rule pt-5">
            {freePlan.features.map((feature) => (
              <Item key={feature}>{feature}</Item>
            ))}
          </ul>
        </article>

        <article className="relative flex flex-col rounded-2xl bg-score-5 p-6 text-paper shadow-[0_24px_50px_-28px_rgba(14,79,72,0.8)]">
          <p className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full bg-safety px-3 py-1 font-mono text-[10px] tracking-[0.14em] text-paper">
            MOST TEAMS START HERE
          </p>
          <p className="font-mono text-[11px] tracking-[0.16em] text-paper/65">PRO</p>
          <p className="mt-3 text-sm leading-relaxed text-paper/80">{proPlan.summary}</p>
          <p className="mt-6 font-mono text-4xl tracking-tight">
            {pro.amount}
            <span className="text-base text-paper/70">{pro.suffix}</span>
          </p>
          {annual ? <p className="mt-1 font-mono text-xs text-score-2">2 months free</p> : null}
          <button
            type="button"
            className={`${buttonClass} mt-6 w-full`}
            disabled={pending !== null}
            onClick={() => void buy("pro")}
          >
            {pending === "pro" ? "Starting…" : "Start 7-day trial"}
          </button>
          <ul className="mt-6 space-y-3 border-t border-paper/15 pt-5">
            {proPlan.features.map((feature) => (
              <Item key={feature} onDark>
                {feature}
              </Item>
            ))}
          </ul>
        </article>

        <article className="flex flex-col rounded-2xl border border-rule bg-paper p-6 lg:mt-6">
          <p className="font-mono text-[11px] tracking-[0.16em] text-muted">TEAM</p>
          <p className="mt-3 text-sm leading-relaxed text-muted">{teamPlan.summary}</p>
          <p className="mt-6 font-mono text-4xl tracking-tight">
            {team.amount}
            <span className="text-base text-muted">{team.suffix}</span>
          </p>
          {annual ? <p className="mt-1 font-mono text-xs text-teal">2 months free</p> : null}
          <p className="mt-2 text-xs text-muted">Minimum {TEAM_MIN_SEATS} seats, chosen at checkout.</p>
          <button
            type="button"
            className="mt-6 inline-flex w-full items-center justify-center rounded-md border border-ink/25 bg-paper px-4 py-2.5 text-sm font-semibold text-ink"
            disabled={pending !== null}
            onClick={() => void buy("team")}
          >
            {pending === "team" ? "Starting…" : "Choose seats"}
          </button>
          <ul className="mt-6 space-y-3 border-t border-rule pt-5">
            {teamPlan.features.map((feature) => (
              <Item key={feature}>{feature}</Item>
            ))}
          </ul>
        </article>
      </div>
    </div>
  );
}
