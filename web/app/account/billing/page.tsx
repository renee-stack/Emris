import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { BillingActions } from "@/components/account/billing-actions";
import { SignIn } from "@/components/account/sign-in";
import { accountGate } from "@/lib/billing/http";
import { formatWhen } from "@/lib/billing/format";
import { hasPaidAccess } from "@/lib/billing/rules";
import { snapshotFromRow } from "@/lib/billing/store";
import { planLabel } from "@/lib/pricing";

export const metadata: Metadata = { title: "Billing — Emris" };

function one(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string | string[]; next?: string | string[] }>;
}) {
  return (
    <Suspense fallback={<h1 className="font-display text-4xl tracking-tight">Billing</h1>}>
      <BillingContent searchParams={searchParams} />
    </Suspense>
  );
}

async function BillingContent({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string | string[]; next?: string | string[] }>;
}) {
  await connection();
  const params = await searchParams;
  const next = one(params.next);
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/account/billing";
  const gate = await accountGate();

  if (gate.kind === "unconfigured") {
    return (
      <>
        <h1 className="font-display text-4xl tracking-tight">Billing</h1>
        <p className="mt-3 text-sm text-muted">Sign-in is not configured on this server.</p>
      </>
    );
  }
  if (gate.kind === "signed_out") {
    return (
      <>
        <h1 className="font-display text-4xl tracking-tight">Billing</h1>
        <div className="mt-6">
          <SignIn next={safeNext} />
        </div>
      </>
    );
  }

  const { user } = gate;
  const now = new Date();
  const snapshot = snapshotFromRow(user);
  const paid = hasPaidAccess(snapshot, now);
  const renews = formatWhen(user.current_period_end);
  const grace = formatWhen(user.grace_until);
  const confirmed = one(params.checkout) === "success";

  let status = "Free";
  if (paid && user.subscription_status === "trialing") status = "Trial";
  else if (paid && user.subscription_status === "past_due") status = "Payment failed";
  else if (paid) status = user.cancel_at_period_end ? "Cancels at period end" : "Active";
  else if (user.subscription_status === "past_due") status = "Returned to Free after a failed payment";

  return (
    <>
      <h1 className="font-display text-4xl tracking-tight">Billing</h1>
      <p className="mt-2 text-sm text-muted">{user.email}</p>
      {confirmed ? (
        <p className="mt-4 rounded-xl bg-score-1 px-4 py-3 text-sm" role="status">
          Stripe has the checkout. This page updates when the webhook lands.
        </p>
      ) : null}
      <section className="mt-8 rounded-2xl border border-rule p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-3xl tracking-tight">{planLabel(paid ? user.plan : "free")}</h2>
          {user.founding_member ? (
            <span className="rounded-full bg-safety px-3 py-1 font-mono text-[10px] tracking-[0.14em] text-paper uppercase">
              Founding member
            </span>
          ) : null}
        </div>
        <dl className="mt-5 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Status</dt>
            <dd>{status}</dd>
          </div>
          {paid && renews ? (
            <div className="flex justify-between gap-4">
              <dt className="text-muted">{user.cancel_at_period_end ? "Access through" : "Renews"}</dt>
              <dd className="font-mono text-xs">{renews}</dd>
            </div>
          ) : null}
          {paid && user.subscription_status === "past_due" && grace ? (
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Grace ends</dt>
              <dd className="font-mono text-xs">{grace}</dd>
            </div>
          ) : null}
          {paid && user.plan === "team" ? (
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Paid seats</dt>
              <dd className="font-mono">{user.seats}</dd>
            </div>
          ) : null}
          {user.billing_interval && paid ? (
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Interval</dt>
              <dd>{user.billing_interval === "year" ? "Annual" : "Monthly"}</dd>
            </div>
          ) : null}
        </dl>
        {paid && user.subscription_status === "past_due" ? (
          <p className="mt-4 text-sm leading-relaxed text-muted">
            Update the card in the billing portal before the grace period ends. After that, the account
            returns to Free.
          </p>
        ) : null}
        <BillingActions portal={Boolean(user.stripe_customer_id)} />
      </section>
    </>
  );
}
