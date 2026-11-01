"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import {
  searchMeterCopy,
  upgradeHref,
  type AccountSnapshot,
  type PaywallSurface,
  type SearchLimitPayload,
} from "@/lib/billing/pure";

const seenPaywalls = new Set<string>();

export function usePaywallView(surface: PaywallSurface, active: boolean, geoid?: string) {
  useEffect(() => {
    if (!active) return;
    const key = `${surface}:${geoid ?? ""}`;
    if (seenPaywalls.has(key)) return;
    try {
      const storeKey = `emris-pw:${key}`;
      if (sessionStorage.getItem(storeKey)) {
        seenPaywalls.add(key);
        return;
      }
      sessionStorage.setItem(storeKey, "1");
    } catch {
      // Private browsing can block sessionStorage. The in-memory set still dedupes this page.
    }
    seenPaywalls.add(key);
    void fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "paywall_view", surface, geoid }),
    });
  }, [surface, active, geoid]);
}

export function PlanMark({ account, surface }: { account: AccountSnapshot | null; surface: string }) {
  if (!account) return <span className="inline-block h-4 w-14" aria-hidden="true" />;
  if (account.plan === "pro" || account.plan === "trial") {
    const title =
      account.plan === "trial" && account.trial_ends_label
        ? `Pro trial ends ${account.trial_ends_label}`
        : "Pro";
    return (
      <Link
        href="/account"
        title={title}
        className="inline-flex items-center rounded-full bg-score-5 px-2 py-0.5 font-sans text-[11px] font-medium text-paper"
      >
        Pro
      </Link>
    );
  }
  return (
    <Link href={upgradeHref({ intent: "pro", surface })} className="font-sans text-sm text-muted hover:text-ink">
      Upgrade
    </Link>
  );
}

const FREE_ACCOUNT: AccountSnapshot = {
  plan: "free",
  email: null,
  trial_ends_at: null,
  trial_ends_label: null,
  trial_available: true,
  has_billing: false,
  searches_limit: null,
  searches_remaining: null,
  searches_resets_at: null,
  searches_resets_label: null,
};

export function AccountSlot({ surface = "header" }: { surface?: string }) {
  const [account, setAccount] = useState<AccountSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/account", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<AccountSnapshot>) : null))
      .then((body) => {
        if (!cancelled) setAccount(body);
      })
      .catch(() => {
        if (!cancelled) setAccount(null);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  if (!loaded) return <span className="inline-block h-4 w-14" aria-hidden="true" />;
  return <PlanMark account={account ?? FREE_ACCOUNT} surface={surface} />;
}

export function searchMeterText(account: AccountSnapshot | null): string | null {
  if (!account || account.searches_limit == null || account.searches_remaining == null) return null;
  return searchMeterCopy(account.searches_remaining, account.searches_limit);
}

function LockedRows({ count }: { count: number }) {
  const bars = Math.min(count, 3);
  const label =
    count === 1 ? "1 more record is available with Pro." : `${count} more records are available with Pro.`;
  return (
    <>
      {Array.from({ length: bars }, (_, index) => (
        <li key={`locked-${index}`} className="border-t border-rule py-3" aria-hidden="true">
          <div className="h-3 w-2/3 rounded-sm bg-ink/15 blur-[1px]" />
          <div className="mt-2 h-3 w-1/3 rounded-sm bg-ink/10 blur-[1px]" />
        </li>
      ))}
      <li className="list-none pt-2">
        <p className="font-sans text-xs text-muted">{label}</p>
      </li>
    </>
  );
}

export function RecordList<T extends { id: string }>({
  title,
  total,
  rows,
  empty,
  note,
  surface,
  geoid,
  render,
}: {
  title: string;
  total: number;
  rows: T[];
  empty: string;
  note?: string;
  surface: PaywallSurface;
  geoid?: string;
  render: (row: T) => ReactNode;
}) {
  const locked = Math.max(0, total - rows.length);
  usePaywallView(surface, locked > 0, geoid);
  return (
    <section className="mt-8">
      <h3 className="font-sans text-xs font-medium uppercase tracking-[0.14em] text-muted">
        {title}
        {total > 0 ? ` · ${total}` : ""}
      </h3>
      {note ? <p className="mt-2 font-sans text-sm text-ink">{note}</p> : null}
      {total === 0 ? (
        <p className="mt-3 font-sans text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-2">
          {rows.map((row) => (
            <li key={row.id} className="border-t border-rule py-3">
              {render(row)}
            </li>
          ))}
          {locked > 0 ? <LockedRows count={locked} /> : null}
        </ul>
      )}
    </section>
  );
}

const choiceLink = "flex items-center justify-center px-2 py-2 text-center font-sans text-sm";

export function UpgradeChoice({
  heading,
  body,
  geoid,
  surface,
  className = "",
}: {
  heading?: string;
  body?: string;
  geoid?: string;
  surface: PaywallSurface;
  className?: string;
}) {
  usePaywallView(surface, true, geoid);
  return (
    <div className={`border border-rule p-3 ${className}`}>
      {heading ? <h2 className="font-display text-[22px] leading-tight">{heading}</h2> : null}
      {body ? <p className={`font-sans text-sm leading-relaxed ${heading ? "mt-2" : ""}`}>{body}</p> : null}
      <div className={`grid grid-cols-2 gap-2 ${heading || body ? "mt-3" : ""}`}>
        {geoid ? (
          <Link href={upgradeHref({ intent: "report", surface, geoid })} className={`${choiceLink} border border-rule`}>
            Just this report
          </Link>
        ) : null}
        <Link
          href={upgradeHref({ intent: "pro", surface, geoid })}
          className={`${choiceLink} bg-ink text-paper ${geoid ? "" : "col-span-2"}`}
        >
          Pro: every report
        </Link>
      </div>
    </div>
  );
}

export function SearchLimitCard({ limit }: { limit: SearchLimitPayload }) {
  usePaywallView("search_limit", true);
  return (
    <div className="pr-8 pt-6">
      <h2 className="font-display text-[26px] leading-tight">Free searches are used for this week</h2>
      <p className="mt-3 font-sans text-sm leading-relaxed">{limit.summary}</p>
      <p className="mt-2 font-sans text-sm leading-relaxed">Free searches reset {limit.resets_label}.</p>
      <Link
        href={upgradeHref({ intent: "pro", surface: "search_limit" })}
        className="mt-5 flex h-12 w-full items-center justify-center bg-ink font-sans text-sm font-medium text-paper"
      >
        Upgrade to Pro for unlimited searches
      </Link>
    </div>
  );
}

export function ProductFrame({
  account,
  children,
}: {
  account: AccountSnapshot | null;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 overflow-y-auto bg-paper text-ink">
      <header className="border-b border-rule">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <Link href="/map" className="font-display text-xl tracking-tight">
            Emris
          </Link>
          <PlanMark account={account} surface="header" />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-10">{children}</main>
    </div>
  );
}
