"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { sendMagicLink } from "@/components/use-auth";
import { supabaseEnv } from "@/lib/supabase/env";
import { safeNextPath } from "@/lib/supabase/return-path";

const RESEND_AFTER_MS = 60_000;

const fieldClass =
  "mt-1.5 w-full rounded-lg border border-rule bg-paper px-3 py-2.5 font-sans text-sm text-ink outline-none focus:border-teal disabled:cursor-not-allowed disabled:opacity-60";

const primaryClass =
  "inline-flex h-12 w-full items-center justify-center rounded-md bg-ink px-4 font-sans text-sm font-semibold text-paper transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:opacity-60";

const googleClass =
  "inline-flex h-12 w-full items-center justify-center rounded-md border border-ink/25 bg-paper px-4 font-sans text-sm font-semibold text-ink transition-colors hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-60";

function queryError(code: string | null): string | null {
  if (code === "unconfigured") return "Sign-in isn't configured.";
  if (code === "rate") return "Too many sign-in emails. Try again in an hour.";
  if (code === "google") return "Google sign-in didn't start.";
  return null;
}

function secondsRemaining(sentAt: number, now: number): number {
  return Math.max(0, Math.ceil((RESEND_AFTER_MS - (now - sentAt)) / 1000));
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 overflow-y-auto bg-paper text-ink">
      <main className="mx-auto max-w-md px-5 py-16">
        <Link href="/" className="font-display text-2xl tracking-tight">
          Emris
        </Link>
        {children}
      </main>
    </div>
  );
}

function GoogleStart({ href, disabled }: { href: string; disabled: boolean }) {
  if (disabled) {
    return (
      <button type="button" disabled className={`${googleClass} mt-3`}>
        Continue with Google
      </button>
    );
  }
  return (
    <a href={href} className={`${googleClass} mt-3`}>
      Continue with Google
    </a>
  );
}

function SignInForm() {
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"), "https://signin.emris");
  const configured = supabaseEnv() !== null;
  const googleHref = `/auth/google?next=${encodeURIComponent(next)}`;
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sentEmail, setSentEmail] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [error, setError] = useState<string | null>(queryError(params.get("error")));

  useEffect(() => {
    if (sentAt === null) return;
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [sentAt]);

  const remaining = sentAt === null ? 0 : secondsRemaining(sentAt, now || sentAt);
  const unconfigured = !configured || error === "Sign-in isn't configured.";

  async function deliver(address: string) {
    if (unconfigured || pending) return;
    setPending(true);
    setError(null);
    try {
      await sendMagicLink(address, next);
      const stamp = Date.now();
      setSentEmail(address);
      setSentAt(stamp);
      setNow(stamp);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn't send the sign-in link.");
    } finally {
      setPending(false);
    }
  }

  if (sentEmail) {
    return (
      <Frame>
        <h1 className="mt-8 font-display text-4xl tracking-tight">Check your email</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted" aria-live="polite">
          We sent a sign-in link to <span className="text-ink">{sentEmail}</span>.
        </p>
        <button
          type="button"
          className={`${primaryClass} mt-8`}
          disabled={pending || remaining > 0}
          onClick={() => {
            void deliver(sentEmail);
          }}
        >
          {pending ? "Sending…" : remaining > 0 ? `Resend in ${remaining}s` : "Resend email"}
        </button>
        <GoogleStart href={googleHref} disabled={unconfigured} />
        <button
          type="button"
          className="mt-4 font-sans text-sm text-ink underline underline-offset-2 hover:text-teal"
          onClick={() => {
            setSentEmail(null);
            setSentAt(null);
            setError(null);
          }}
        >
          Use a different email
        </button>
        {error ? (
          <p className="mt-4 text-sm text-safety" role="alert">
            {error}
          </p>
        ) : null}
      </Frame>
    );
  }

  return (
    <Frame>
      <h1 className="mt-8 font-display text-4xl tracking-tight">Sign in</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Use a magic link or Google. There is no password.
      </p>
      {unconfigured ? (
        <p className="mt-4 text-sm text-safety" role="alert">
          {"Sign-in isn't configured."}
        </p>
      ) : null}
      <form
        className="mt-8"
        onSubmit={(event) => {
          event.preventDefault();
          const address = email.trim().toLowerCase();
          if (!address) return;
          void deliver(address);
        }}
      >
        <label className="block font-sans text-sm font-medium" htmlFor="signin-email">
          Email
          <input
            id="signin-email"
            type="email"
            required={!unconfigured}
            autoComplete="email"
            value={email}
            disabled={unconfigured || pending}
            onChange={(event) => setEmail(event.target.value)}
            className={fieldClass}
          />
        </label>
        <button type="submit" disabled={unconfigured || pending} className={`${primaryClass} mt-4`}>
          {pending ? "Sending…" : "Email me a link"}
        </button>
      </form>
      <GoogleStart href={googleHref} disabled={unconfigured} />
      {!unconfigured && error ? (
        <p className="mt-4 text-sm text-safety" role="alert">
          {error}
        </p>
      ) : null}
    </Frame>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
