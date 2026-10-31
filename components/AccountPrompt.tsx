"use client";

import { useState } from "react";
import { sendMagicLink } from "@/components/use-auth";
import { mapReturnPath } from "@/lib/supabase/return-path";

interface Props {
  placeId: string | null;
  tractId: string | null;
}

export default function AccountPrompt({ placeId, tractId }: Props) {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-8">
      <p className="font-sans text-sm text-ink">
        Scores stay free. Permits, search, and the memo need an account.
      </p>
      <form
        className="mt-4"
        onSubmit={(event) => {
          event.preventDefault();
          const next = email.trim();
          if (!next || pending) return;
          setPending(true);
          setMessage(null);
          setError(null);
          void sendMagicLink(next, mapReturnPath(placeId, tractId))
            .then(() => {
              setMessage("Check your email for a sign-in link.");
            })
            .catch((err: unknown) => {
              setError(err instanceof Error ? err.message : "Couldn't send the sign-in link.");
            })
            .finally(() => setPending(false));
        }}
      >
        <label className="sr-only" htmlFor="emris-email">
          Email
        </label>
        <input
          id="emris-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Email"
          className="w-full border-b border-rule bg-transparent pb-1.5 font-sans text-sm text-ink outline-none placeholder:text-muted focus:border-ink"
        />
        <button
          type="submit"
          disabled={pending}
          className="mt-3 h-12 w-full bg-ink font-sans text-sm font-medium text-paper disabled:opacity-60"
        >
          {pending ? "Sending…" : "Email me a link"}
        </button>
      </form>
      {message ? <p className="mt-3 font-sans text-sm text-teal">{message}</p> : null}
      {error ? <p className="mt-3 font-sans text-sm text-safety">{error}</p> : null}
    </div>
  );
}
