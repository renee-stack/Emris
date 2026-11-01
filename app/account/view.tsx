"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ProductFrame } from "@/components/upgrade-ui";
import { PRO_MONTHLY_USD, searchMeterCopy, upgradeHref, type AccountSnapshot } from "@/lib/billing/pure";

export default function AccountView() {
  const [account, setAccount] = useState<AccountSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void fetch("/api/account", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error("account");
        return res.json() as Promise<AccountSnapshot>;
      })
      .then(setAccount)
      .catch(() => setFailed(true));
  }, []);

  async function manage() {
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const body = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        setError(body.error ?? "The billing portal is not available right now.");
        setPending(false);
        return;
      }
      window.location.assign(body.url);
    } catch {
      setError("The billing portal is not available right now.");
      setPending(false);
    }
  }

  return (
    <ProductFrame account={account}>
      <h1 className="font-display text-4xl tracking-tight">Account</h1>
      {failed ? <p className="mt-4 font-sans text-sm">Couldn&apos;t load this account.</p> : null}
      {!account && !failed ? <p className="mt-4 font-sans text-sm text-muted">Loading.</p> : null}
      {account ? (
        <div className="mt-6 max-w-xl space-y-3 font-sans text-sm leading-relaxed">
          <p>{account.email ?? "Free plan on this browser. An account is created at checkout."}</p>
          {account.plan === "trial" && account.trial_ends_label ? (
            <p>
              Pro trial. A card is on file. You will be charged ${PRO_MONTHLY_USD} on {account.trial_ends_label} unless
              you cancel before then.
            </p>
          ) : null}
          {account.plan === "pro" ? <p>Pro. ${PRO_MONTHLY_USD} a month.</p> : null}
          {account.plan === "free" && account.searches_limit != null && account.searches_remaining != null ? (
            <p>
              {searchMeterCopy(account.searches_remaining, account.searches_limit)}.
              {account.searches_resets_label ? ` Free searches reset ${account.searches_resets_label}.` : ""}
            </p>
          ) : null}
          {account.plan === "free" ? (
            <p>
              <Link href={upgradeHref({ intent: "pro", surface: "account" })} className="underline underline-offset-2">
                Upgrade
              </Link>
            </p>
          ) : null}
          {account.has_billing ? (
            <button
              type="button"
              onClick={() => void manage()}
              disabled={pending}
              className="mt-2 border border-ink px-4 py-2 disabled:opacity-40"
            >
              Manage billing
            </button>
          ) : null}
          {error ? <p>{error}</p> : null}
        </div>
      ) : null}
    </ProductFrame>
  );
}
