"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import GettingStarted from "@/components/GettingStarted";

interface Account {
  email: string | null;
  plan: string;
  onboarded: boolean;
  totp: boolean;
}

export default function AccountPage() {
  const [account, setAccount] = useState<Account | null>(null);
  const [ready, setReady] = useState(false);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    void fetch("/api/auth/session", { cache: "no-store" })
      .then((res) => res.json())
      .then((body: { user: Account | null }) => {
        setAccount(body.user);
        setReady(true);
      })
      .catch(() => setReady(true));
  }

  useEffect(() => {
    load();
  }, []);

  if (!ready) {
    return (
      <div className="fixed inset-0 overflow-y-auto bg-paper text-ink">
        <main className="mx-auto max-w-lg px-5 py-16">
          <p className="text-sm text-muted">Loading your account…</p>
        </main>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="fixed inset-0 overflow-y-auto bg-paper text-ink">
        <main className="mx-auto max-w-lg px-5 py-16">
          <h1 className="font-display text-4xl tracking-tight">Account</h1>
          <p className="mt-3 text-sm text-muted">Sign in to see your email and plan.</p>
          <Link href="/signin?next=/account" className="mt-6 inline-block text-sm underline">
            Sign in
          </Link>
        </main>
      </div>
    );
  }

  const pro = account.plan === "Pro" || account.plan === "Founding Member Pro" || account.plan === "Team";

  return (
    <div className="fixed inset-0 overflow-y-auto bg-paper text-ink">
      <main className="mx-auto max-w-lg px-5 py-16">
        <Link href="/map" className="font-display text-2xl tracking-tight">
          Emris
        </Link>
        <h1 className="mt-8 font-display text-4xl tracking-tight">Account</h1>
        <dl className="mt-6 space-y-3 text-sm">
          <div>
            <dt className="text-muted">Email</dt>
            <dd>{account.email}</dd>
          </div>
          <div>
            <dt className="text-muted">Plan</dt>
            <dd>{account.plan}</dd>
          </div>
        </dl>
        {!account.onboarded ? (
          <Link href="/onboarding" className="mt-4 inline-block text-sm underline">
            Finish setting up your market
          </Link>
        ) : null}

        <div className="mt-10">
          <GettingStarted />
        </div>

        <section className="mt-10 border-t border-rule pt-6">
          <h2 className="font-display text-2xl tracking-tight">Authenticator</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {pro
              ? "A second step is a good idea on Pro. It stays optional."
              : "Optional. Add an authenticator app if you want a second step at sign-in."}
          </p>
          {account.totp ? <p className="mt-3 text-sm">An authenticator is on.</p> : null}
          {!qr ? (
            <button
              type="button"
              className="mt-4 rounded-md border border-ink/25 px-3 py-2 text-sm font-medium"
              onClick={() => {
                setError(null);
                void fetch("/api/auth/mfa", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "enroll" }),
                })
                  .then(async (res) => {
                    const body = (await res.json()) as { error?: string; factorId?: string; qr?: string; secret?: string };
                    if (!res.ok) throw new Error(body.error || "Couldn't start authenticator setup.");
                    setFactorId(body.factorId ?? null);
                    setQr(body.qr ?? null);
                    setSecret(body.secret ?? null);
                  })
                  .catch((err: unknown) => setError(err instanceof Error ? err.message : "Couldn't start setup."));
              }}
            >
              Set up an authenticator
            </button>
          ) : (
            <form
              className="mt-4"
              onSubmit={(event) => {
                event.preventDefault();
                void fetch("/api/auth/mfa", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "verify", factorId, code }),
                })
                  .then(async (res) => {
                    const body = (await res.json()) as { error?: string };
                    if (!res.ok) throw new Error(body.error || "That code didn't match.");
                    setMessage("Authenticator saved.");
                    setQr(null);
                    load();
                  })
                  .catch((err: unknown) => setError(err instanceof Error ? err.message : "That code didn't match."));
              }}
            >
              <img
                src={qr.startsWith("data:") ? qr : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr)}`}
                alt="Authenticator QR code"
                className="h-44 w-44"
              />
              {secret ? <p className="mt-2 break-all font-mono text-xs text-muted">{secret}</p> : null}
              <label className="mt-3 block text-sm font-medium" htmlFor="totp-code">
                6-digit code
                <input
                  id="totp-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-rule px-3 py-2.5 text-sm outline-none focus:border-teal"
                />
              </label>
              <button type="submit" className="mt-3 rounded-md bg-ink px-3 py-2 text-sm font-medium text-paper">
                Confirm code
              </button>
            </form>
          )}
        </section>

        <section className="mt-10 flex flex-wrap gap-3 border-t border-rule pt-6">
          <button
            type="button"
            className="rounded-md border border-ink/25 px-3 py-2 text-sm font-medium"
            onClick={() => {
              void fetch("/api/auth/signout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ scope: "local" }),
              }).then(() => {
                window.location.href = "/";
              });
            }}
          >
            Sign out
          </button>
          <button
            type="button"
            className="rounded-md border border-ink/25 px-3 py-2 text-sm font-medium"
            onClick={() => {
              void fetch("/api/auth/signout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ scope: "global" }),
              }).then(() => {
                window.location.href = "/";
              });
            }}
          >
            Sign out of every device
          </button>
        </section>

        <section className="mt-10 border-t border-rule pt-6">
          <h2 className="font-display text-2xl tracking-tight">Delete account</h2>
          <p className="mt-2 text-sm text-muted">Type your email to confirm. This cannot be undone.</p>
          <form
            className="mt-4"
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);
              void fetch("/api/auth/account", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ confirm }),
              })
                .then(async (res) => {
                  const body = (await res.json()) as { error?: string };
                  if (!res.ok) throw new Error(body.error || "Couldn't delete the account.");
                  window.location.href = "/";
                })
                .catch((err: unknown) => setError(err instanceof Error ? err.message : "Couldn't delete the account."));
            }}
          >
            <label className="sr-only" htmlFor="delete-confirm">
              Type your email to confirm deletion
            </label>
            <input
              id="delete-confirm"
              type="email"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              placeholder={account.email ?? "Email"}
              className="w-full rounded-lg border border-rule px-3 py-2.5 text-sm outline-none focus:border-teal"
            />
            <button
              type="submit"
              disabled={confirm.trim().toLowerCase() !== (account.email ?? "").toLowerCase()}
              className="mt-3 rounded-md bg-safety px-3 py-2 text-sm font-medium text-paper disabled:opacity-50"
            >
              Delete account
            </button>
          </form>
        </section>
        {message ? <p className="mt-4 text-sm text-teal">{message}</p> : null}
        {error ? <p className="mt-4 text-sm text-safety">{error}</p> : null}
      </main>
    </div>
  );
}
