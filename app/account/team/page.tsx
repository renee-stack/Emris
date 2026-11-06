import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { SignIn } from "@/components/account/sign-in";
import { TeamManager } from "@/components/account/team-manager";
import { accountGate } from "@/lib/billing/http";
import { ensureTeam, loadTeam, snapshotFromRow } from "@/lib/billing/store";
import { hasPaidAccess } from "@/lib/billing/rules";

export const metadata: Metadata = { title: "Team — Emris" };

export default function TeamPage() {
  return (
    <Suspense fallback={<h1 className="font-display text-4xl tracking-tight">Team</h1>}>
      <TeamContent />
    </Suspense>
  );
}

async function TeamContent() {
  await connection();
  const gate = await accountGate();
  if (gate.kind === "unconfigured") {
    return (
      <>
        <h1 className="font-display text-4xl tracking-tight">Team</h1>
        <p className="mt-3 text-sm text-muted">Sign-in is not configured on this server.</p>
      </>
    );
  }
  if (gate.kind === "signed_out") {
    return (
      <>
        <h1 className="font-display text-4xl tracking-tight">Team</h1>
        <div className="mt-6">
          <SignIn next="/account/team" title="Sign in to manage the team" />
        </div>
      </>
    );
  }

  const { admin, user } = gate;
  const now = new Date();
  if (user.plan === "team" && hasPaidAccess(snapshotFromRow(user), now)) {
    await ensureTeam(admin, user.id);
  }
  const team = await loadTeam(admin, user, now);

  return (
    <>
      <h1 className="font-display text-4xl tracking-tight">Team</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Invite by email, remove members, and see seats used against seats paid. Invites expire after 7
        days.
      </p>
      <TeamManager initial={team} />
    </>
  );
}
