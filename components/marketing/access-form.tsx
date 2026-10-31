"use client";

import { useState } from "react";
import Link from "next/link";
import { buttonClass } from "./cta";

const roles = [
  "Acquisitions",
  "Development",
  "Capital",
  "Asset management",
  "Other",
];

const focuses = [
  "Ground-up multifamily",
  "Value-add multifamily",
  "Mixed-use",
  "Development site selection",
];

const fieldClass =
  "mt-1.5 w-full rounded-lg border border-rule bg-paper px-3 py-2.5 text-sm text-ink outline-none focus:border-teal";

export function AccessForm() {
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <div className="rounded-2xl border border-rule bg-paper p-6 shadow-[0_16px_40px_-28px_rgba(23,23,23,0.45)] sm:p-8">
        <h2 className="font-display text-3xl tracking-tight">Request received</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Thanks. This form stays in your browser and is not sent to a server.
          Nothing was added to a marketing list.
        </p>
        <button
          type="button"
          className={`${buttonClass} mt-6`}
          onClick={() => setSent(false)}
        >
          Edit request
        </button>
      </div>
    );
  }

  return (
    <form
      className="rounded-2xl border border-rule bg-paper p-6 shadow-[0_16px_40px_-28px_rgba(23,23,23,0.45)] sm:p-8"
      onSubmit={(event) => {
        event.preventDefault();
        setSent(true);
      }}
    >
      <h2 className="font-display text-3xl tracking-tight">Request access</h2>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Full name
          <input name="name" required autoComplete="name" className={fieldClass} />
        </label>
        <label className="block text-sm font-medium">
          Work email
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className={fieldClass}
          />
        </label>
        <label className="block text-sm font-medium">
          Company
          <input
            name="company"
            required
            autoComplete="organization"
            className={fieldClass}
          />
        </label>
        <label className="block text-sm font-medium">
          Role
          <select name="role" required defaultValue="Acquisitions" className={fieldClass}>
            {roles.map((role) => (
              <option key={role}>{role}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="mt-4 block text-sm font-medium">
        Target metros
        <input
          name="metros"
          required
          placeholder="e.g. Chicago, Nashville"
          className={fieldClass}
        />
      </label>
      <label className="mt-4 block text-sm font-medium">
        Primary focus
        <select
          name="focus"
          required
          defaultValue="Ground-up multifamily"
          className={fieldClass}
        >
          {focuses.map((focus) => (
            <option key={focus}>{focus}</option>
          ))}
        </select>
      </label>
      <label className="mt-4 block text-sm font-medium">
        Anything we should know? (optional)
        <textarea name="note" rows={4} className={fieldClass} />
      </label>
      <button type="submit" className={`${buttonClass} mt-6 w-full`}>
        Request access
      </button>
      <p className="mt-3 text-center text-xs leading-relaxed text-muted">
        Nothing is sent from this form. No marketing lists. See our{" "}
        <Link href="/landing/privacy" className="underline underline-offset-2 hover:text-ink">
          privacy policy
        </Link>
        .
      </p>
    </form>
  );
}
