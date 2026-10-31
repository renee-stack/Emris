"use client";

import { useState } from "react";
import { sendMagicLink } from "@/components/use-auth";
import { buttonClass } from "@/components/marketing/cta";

const fieldClass =
  "mt-1.5 w-full rounded-lg border border-rule bg-paper px-3 py-2.5 text-sm text-ink outline-none focus:border-teal";

export function SignIn({ next, title = "Sign in" }: { next: string; title?: string }) {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="max-w-md rounded-2xl border border-rule bg-paper p-6"
      onSubmit={(event) => {
        event.preventDefault();
        const value = email.trim();
        if (!value || pending) return;
        setPending(true);
        setMessage(null);
        setError(null);
        void sendMagicLink(value, next)
          .then(() => setMessage("Check your email for a sign-in link."))
          .catch((err: unknown) => {
            setError(err instanceof Error ? err.message : "Couldn't send the sign-in link.");
          })
          .finally(() => setPending(false));
      }}
    >
      <h2 className="font-display text-3xl tracking-tight">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Use the email on your Emris account. We will send a link, not a password.
      </p>
      <label className="mt-5 block text-sm font-medium">
        Email
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={fieldClass}
        />
      </label>
      <button type="submit" className={`${buttonClass} mt-5 w-full`} disabled={pending}>
        {pending ? "Sending…" : "Email me a link"}
      </button>
      {message ? (
        <p className="mt-3 text-sm text-teal" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm text-safety" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
