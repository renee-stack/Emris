"use client";

import { useState } from "react";
import { buttonClass } from "@/components/marketing/cta";
import { CONTACT_EMAIL } from "@/lib/pricing";

const fieldClass =
  "mt-1.5 w-full rounded-lg border border-rule bg-paper px-3 py-2.5 text-sm text-ink outline-none focus:border-teal";

export function EnterpriseForm() {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (sent) {
    return (
      <div className="rounded-2xl border border-rule bg-paper p-6 sm:p-8">
        <h3 className="font-display text-3xl tracking-tight">Message sent</h3>
        <p className="mt-3 text-sm leading-relaxed text-muted">Renee has the note and will reply by email.</p>
      </div>
    );
  }

  return (
    <form
      className="rounded-2xl border border-rule bg-paper p-6 sm:p-8"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        setPending(true);
        setError(null);
        void fetch("/api/contact", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: data.get("name"),
            email: data.get("email"),
            company: data.get("company"),
            message: data.get("message"),
          }),
        })
          .then(async (response) => {
            const body = (await response.json()) as { error?: string };
            if (!response.ok) throw new Error(body.error || "Couldn't send the note.");
            setSent(true);
          })
          .catch((err: unknown) => {
            setError(err instanceof Error ? err.message : `Email ${CONTACT_EMAIL} directly.`);
          })
          .finally(() => setPending(false));
      }}
    >
      <h3 className="font-display text-3xl tracking-tight">Contact us</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Enterprise coverage, SSO, and a data feed. This emails Renee.
      </p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Name
          <input name="name" required autoComplete="name" className={fieldClass} />
        </label>
        <label className="block text-sm font-medium">
          Work email
          <input name="email" type="email" required autoComplete="email" className={fieldClass} />
        </label>
        <label className="block text-sm font-medium sm:col-span-2">
          Company
          <input name="company" required autoComplete="organization" className={fieldClass} />
        </label>
      </div>
      <label className="mt-4 block text-sm font-medium">
        What do you need?
        <textarea name="message" required rows={4} className={fieldClass} />
      </label>
      <button type="submit" className={`${buttonClass} mt-6`} disabled={pending}>
        {pending ? "Sending…" : "Contact us"}
      </button>
      {error ? (
        <p className="mt-3 text-sm text-safety" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
