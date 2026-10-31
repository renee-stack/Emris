"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { buttonClass } from "@/components/marketing/cta";
import { formatWhen } from "@/lib/billing/format";
import type { TeamView } from "@/lib/billing/store";

export function TeamManager({ initial }: { initial: TeamView }) {
  const [team, setTeam] = useState(initial);
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNote(null);
    try {
      const response = await fetch("/api/team/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await response.json()) as TeamView & {
        view?: TeamView;
        emailed?: boolean;
        join_url?: string;
        error?: string;
      };
      if (!response.ok || !data.view) throw new Error(data.error || "Couldn't send the invite.");
      setTeam(data.view);
      setEmail("");
      setNote(
        data.emailed
          ? "Invite sent. It expires in 7 days."
          : `Email isn't configured. Share this link, and only that address can accept it: ${data.join_url}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the invite.");
    } finally {
      setPending(false);
    }
  }

  async function remove(userId: string) {
    setError(null);
    setNote(null);
    const response = await fetch("/api/team/members", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_id: userId }),
    });
    const data = (await response.json()) as TeamView & { error?: string };
    if (!response.ok || !data.members) {
      setError(data.error || "Couldn't remove that member.");
      return;
    }
    setTeam(data);
  }

  async function addSeats() {
    setError(null);
    const response = await fetch("/api/billing/portal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flow: "seats" }),
    });
    const data = (await response.json()) as { url?: string; error?: string };
    if (!response.ok || !data.url) {
      setError(data.error || "Couldn't open the portal.");
      return;
    }
    window.location.href = data.url;
  }

  if (team.role === "none") {
    return (
      <div className="mt-6 rounded-2xl border border-rule p-6">
        <p className="text-sm leading-relaxed text-muted">
          Team seats start at 3. Subscribe, then invite people by email.
        </p>
        <Link href="/pricing" className={`${buttonClass} mt-5`}>
          See Team pricing
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-6">
      <section className="rounded-2xl border border-rule p-6">
        <h2 className="font-display text-2xl tracking-tight">Seats</h2>
        <p className="mt-2 font-mono text-sm">
          {team.seats_used} used
          {team.seats_pending ? ` · ${team.seats_pending} pending` : ""} · {team.seats_paid} paid
        </p>
        {!team.active ? (
          <p className="mt-3 text-sm text-muted">Team billing is not active, so new invites are closed.</p>
        ) : null}
        {team.can_manage ? (
          <button
            type="button"
            className="mt-4 inline-flex items-center justify-center rounded-md border border-ink/25 px-4 py-2.5 text-sm font-semibold"
            onClick={() => void addSeats()}
          >
            Add seats
          </button>
        ) : null}
      </section>

      <section className="rounded-2xl border border-rule p-6">
        <h2 className="font-display text-2xl tracking-tight">Members</h2>
        <ul className="mt-4 divide-y divide-rule">
          {team.members.map((member) => (
            <li key={member.user_id} className="flex items-center justify-between gap-3 py-3 text-sm">
              <span>
                {member.email}
                <span className="ml-2 font-mono text-[10px] tracking-[0.14em] text-muted uppercase">
                  {member.role}
                </span>
              </span>
              {team.can_manage && member.role !== "owner" ? (
                <button type="button" className="text-sm text-safety" onClick={() => void remove(member.user_id)}>
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {team.can_manage ? (
        <section className="rounded-2xl border border-rule p-6">
          <h2 className="font-display text-2xl tracking-tight">Invite</h2>
          <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={(event) => void invite(event)}>
            <label className="sr-only" htmlFor="invite-email">
              Email
            </label>
            <input
              id="invite-email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Email"
              className="w-full rounded-lg border border-rule px-3 py-2.5 text-sm outline-none focus:border-teal"
            />
            <button type="submit" className={`${buttonClass} shrink-0`} disabled={pending || !team.can_invite}>
              {pending ? "Sending…" : "Invite"}
            </button>
          </form>
          {!team.can_invite ? <p className="mt-3 text-sm text-muted">All paid seats are in use.</p> : null}
        </section>
      ) : null}

      {team.invites.length ? (
        <section>
          <h2 className="font-display text-2xl tracking-tight">Pending invites</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {team.invites.map((invite) => (
              <li key={invite.id}>
                {invite.email}
                <span className="text-muted"> · expires {formatWhen(invite.expires_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {note ? (
        <p className="text-sm text-teal" role="status">
          {note}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-safety" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
