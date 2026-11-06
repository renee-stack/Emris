import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { SignIn } from "@/components/account/sign-in";
import { JoinTeam } from "@/components/account/join-team";
import { accountGate } from "@/lib/billing/http";

export const metadata: Metadata = { title: "Join a team — Emris" };

function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  return (
    <Suspense fallback={<h1 className="font-display text-4xl tracking-tight">Join a team</h1>}>
      <JoinContent searchParams={searchParams} />
    </Suspense>
  );
}

async function JoinContent({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  await connection();
  const token = one((await searchParams).token);
  if (!token) {
    return (
      <>
        <h1 className="font-display text-4xl tracking-tight">Join a team</h1>
        <p className="mt-3 text-sm text-muted">This invite link is missing a token.</p>
      </>
    );
  }

  const next = `/account/team/join?token=${encodeURIComponent(token)}`;
  const gate = await accountGate();
  if (gate.kind === "unconfigured") {
    return (
      <>
        <h1 className="font-display text-4xl tracking-tight">Join a team</h1>
        <p className="mt-3 text-sm text-muted">Sign-in is not configured on this server.</p>
      </>
    );
  }
  if (gate.kind === "signed_out") {
    return (
      <>
        <h1 className="font-display text-4xl tracking-tight">Join a team</h1>
        <div className="mt-6">
          <SignIn next={next} title="Sign in to accept the invite" />
        </div>
      </>
    );
  }

  return (
    <>
      <h1 className="font-display text-4xl tracking-tight">Join a team</h1>
      <p className="mt-2 text-sm text-muted">Signed in as {gate.user.email}.</p>
      <JoinTeam token={token} />
    </>
  );
}
