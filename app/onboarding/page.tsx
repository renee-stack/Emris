"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ROLES, STRATEGIES } from "@/lib/onboarding/choices";
import { parsePlaces, type CityPlace } from "@/components/places";

interface GlanceTract {
  geoid: string;
  name: string;
  score: number;
  reason: string;
}

interface Payoff {
  welcome: "sent" | "not_configured" | "failed";
  valueAdd: boolean;
  tracts: GlanceTract[];
  focus: string[];
  marketPath: string;
}

function safeReturn(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/map";
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return "/map";
    if (url.pathname === "/map") return `${url.pathname}${url.search}`;
    if (url.pathname === "/account" || url.pathname === "/pricing") return url.pathname;
  } catch {
    return "/map";
  }
  return "/map";
}

function Choice({
  selected,
  children,
  onClick,
}: {
  selected: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`rounded-full border px-3 py-2 text-sm ${selected ? "border-ink bg-ink text-paper" : "border-rule text-ink"}`}
    >
      {children}
    </button>
  );
}

function OnboardingFlow() {
  const params = useSearchParams();
  const next = params.get("next") || "/map";
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [step, setStep] = useState(0);
  const [role, setRole] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<string | null>(null);
  const [places, setPlaces] = useState<CityPlace[] | null>(null);
  const [placesEmpty, setPlacesEmpty] = useState(false);
  const [picked, setPicked] = useState<CityPlace[]>([]);
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [payoff, setPayoff] = useState<Payoff | null>(null);

  useEffect(() => {
    void fetch("/api/auth/session", { cache: "no-store" })
      .then((res) => res.json())
      .then((body: { user: { onboarded?: boolean } | null }) => {
        if (!body.user) {
          window.location.href = `/signin?next=${encodeURIComponent("/onboarding")}`;
          return;
        }
        if (body.user.onboarded) {
          window.location.href = safeReturn(next);
          return;
        }
        setSignedIn(true);
        setReady(true);
      })
      .catch(() => setReady(true));
  }, [next]);

  useEffect(() => {
    if (step !== 2) return;
    void fetch("/api/places", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("places");
        return parsePlaces(await res.json());
      })
      .then((list) => {
        setPlaces(list);
        setPlacesEmpty(list.length === 0);
      })
      .catch(() => {
        setPlaces([]);
        setPlacesEmpty(true);
      });
  }, [step]);

  if (!ready || !signedIn) {
    return (
      <div className="fixed inset-0 overflow-y-auto bg-paper text-ink">
        <main className="mx-auto max-w-xl px-5 py-16">
          <p className="text-sm text-muted">Loading…</p>
        </main>
      </div>
    );
  }

  if (payoff) {
    return (
      <div className="fixed inset-0 overflow-y-auto bg-paper text-ink">
        <main className="mx-auto max-w-xl px-5 py-16">
          <p className="font-mono text-[11px] tracking-[0.16em] text-safety">YOUR MARKET</p>
          <h1 className="mt-3 font-display text-5xl tracking-tight">Your market at a glance</h1>
          {payoff.focus.length > 0 ? (
            <p className="mt-3 text-sm text-muted">You marked {payoff.focus.join(", ")}.</p>
          ) : null}
          <p className="mt-3 text-sm leading-relaxed text-muted">
            These are the five strongest tracts in the record we have today.
          </p>
          <ol className="mt-6 space-y-4">
            {payoff.tracts.map((tract) => (
              <li key={tract.geoid} className="border-t border-rule pt-4">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="font-sans text-sm font-medium">{tract.name}</h2>
                  <span className="font-mono text-sm">{tract.score}</span>
                </div>
                <p className="mt-1 text-sm text-muted">{tract.reason}</p>
              </li>
            ))}
          </ol>
          {payoff.valueAdd ? (
            <section className="mt-8 rounded-2xl border border-rule p-5">
              <h2 className="font-display text-2xl tracking-tight">12 rehab candidates found in this area</h2>
              <div className="mt-4 space-y-2" aria-hidden="true">
                {["a", "b", "c", "d"].map((row) => (
                  <div key={row} className="h-8 rounded bg-ink/10 blur-sm" />
                ))}
              </div>
              <Link href="/pricing" className="mt-4 inline-block text-sm font-medium underline">
                Unlock with Pro
              </Link>
            </section>
          ) : null}
          <p className="mt-6 text-sm text-muted">
            {payoff.welcome === "sent"
              ? "Check your email for a link back to this market."
              : "A welcome email was not sent from this server."}
          </p>
          <Link
            href={payoff.marketPath}
            className="mt-6 inline-flex h-12 items-center rounded-md bg-ink px-4 font-sans text-sm font-medium text-paper"
          >
            Open the map
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 overflow-y-auto bg-paper text-ink">
      <main className="mx-auto max-w-xl px-5 py-16">
        <p className="font-mono text-[11px] tracking-[0.16em] text-safety">STEP {step + 1} OF 3</p>
        {step === 0 ? (
          <>
            <h1 className="mt-3 font-display text-4xl tracking-tight">What do you do?</h1>
            <div className="mt-6 flex flex-wrap gap-2">
              {ROLES.map((item) => (
                <Choice key={item} selected={role === item} onClick={() => setRole(item)}>
                  {item}
                </Choice>
              ))}
            </div>
          </>
        ) : null}
        {step === 1 ? (
          <>
            <h1 className="mt-3 font-display text-4xl tracking-tight">What is your strategy?</h1>
            <div className="mt-6 flex flex-wrap gap-2">
              {STRATEGIES.map((item) => (
                <Choice key={item} selected={strategy === item} onClick={() => setStrategy(item)}>
                  {item}
                </Choice>
              ))}
            </div>
          </>
        ) : null}
        {step === 2 ? (
          <>
            <h1 className="mt-3 font-display text-4xl tracking-tight">Where are you focused?</h1>
            <p className="mt-3 text-sm text-muted">Pick up to three markets. An address or neighborhood is optional.</p>
            {placesEmpty ? <p className="mt-4 text-sm">No markets are live yet.</p> : null}
            <div className="mt-4 flex flex-wrap gap-2">
              {places?.map((place) => {
                const selected = picked.some((item) => item.id === place.id);
                return (
                  <Choice
                    key={place.id}
                    selected={selected}
                    onClick={() => {
                      setPicked((current) => {
                        if (current.some((item) => item.id === place.id)) {
                          return current.filter((item) => item.id !== place.id);
                        }
                        if (current.length >= 3) return current;
                        return [...current, place];
                      });
                    }}
                  >
                    {place.name}
                  </Choice>
                );
              })}
            </div>
            <label className="mt-6 block text-sm font-medium" htmlFor="focus-address">
              Address or neighborhood
              <input
                id="focus-address"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                className="mt-1.5 w-full rounded-lg border border-rule px-3 py-2.5 text-sm outline-none focus:border-teal"
              />
            </label>
          </>
        ) : null}
        {error ? <p className="mt-4 text-sm text-safety">{error}</p> : null}
        <div className="mt-8 flex gap-3">
          {step > 0 ? (
            <button type="button" onClick={() => setStep((value) => value - 1)} className="text-sm underline">
              Back
            </button>
          ) : null}
          <button
            type="button"
            disabled={pending || (step === 0 && !role) || (step === 1 && !strategy)}
            className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
            onClick={() => {
              if (step < 2) {
                setStep((value) => value + 1);
                return;
              }
              setPending(true);
              setError(null);
              void fetch("/api/onboarding", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  role,
                  strategy,
                  places: picked.map((place) => ({ id: place.id, name: place.name })),
                  address,
                  next,
                }),
              })
                .then(async (res) => {
                  const body = (await res.json()) as Payoff & { error?: string };
                  if (!res.ok) throw new Error(body.error || "We couldn't save your profile.");
                  setPayoff(body);
                })
                .catch((err: unknown) => setError(err instanceof Error ? err.message : "We couldn't save your profile."))
                .finally(() => setPending(false));
            }}
          >
            {step < 2 ? "Continue" : pending ? "Saving…" : "See your market"}
          </button>
        </div>
      </main>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense>
      <OnboardingFlow />
    </Suspense>
  );
}
