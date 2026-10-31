"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { sendMagicLink } from "@/components/use-auth";
import { Suspense } from "react";

function SignInForm() {
  const params = useSearchParams();
  const next = params.get("next") || "/map";
  const errorCode = params.get("error");
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(
    errorCode === "unconfigured"
      ? "Sign-in isn't configured."
      : errorCode === "rate"
        ? "Too many sign-in emails. Try again in an hour."
        : errorCode === "google"
          ? "Google sign-in didn't start."
          : null,
  );

  return (
    <div className="fixed inset-0 overflow-y-auto bg-paper text-ink">
      <main className="mx-auto max-w-md px-5 py-16">
        <Link href="/" className="font-display text-2xl tracking-tight">
          Emris
        </Link>
        <h1 className="mt-8 font-display text-4xl tracking-tight">Sign in</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Use a magic link or Google. There is no password.
        </p>
        <form
          className="mt-8"
          onSubmit={(event) => {
            event.preventDefault();
            if (pending) return;
            setPending(true);
            setMessage(null);
            setError(null);
            void sendMagicLink(email, next)
              .then(() => setMessage("Check your email for a sign-in link."))
              .catch((err: unknown) => {
                setError(err instanceof Error ? err.message : "Couldn't send the sign-in link.");
              })
              .finally(() => setPending(false));
          }}
        >
          <label className="block text-sm font-medium" htmlFor="signin-email">
            Email
            <input
              id="signin-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-rule bg-paper px-3 py-2.5 text-sm outline-none focus:border-teal"
            />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="mt-4 h-12 w-full rounded-md bg-ink font-sans text-sm font-medium text-paper disabled:opacity-60"
          >
            {pending ? "Sending…" : "Email me a link"}
          </button>
        </form>
        <a
          href={`/auth/google?next=${encodeURIComponent(next)}`}
          className="mt-3 flex h-12 w-full items-center justify-center rounded-md border border-ink/25 font-sans text-sm font-medium"
        >
          Continue with Google
        </a>
        {message ? <p className="mt-4 text-sm text-teal">{message}</p> : null}
        {error ? <p className="mt-4 text-sm text-safety">{error}</p> : null}
      </main>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
