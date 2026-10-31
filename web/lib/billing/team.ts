import { randomBytes } from "node:crypto";
import type { AdminClient } from "@/lib/supabase/admin";
import { BillingError } from "@/lib/billing/errors";
import { hasPaidAccess, inviteExpiry, inviteIsOpen, seatRoom } from "@/lib/billing/rules";
import {
  ensureTeam,
  findUser,
  loadTeam,
  snapshotFromRow,
  type TeamView,
  type UserRow,
} from "@/lib/billing/store";
import { sendEmail } from "@/lib/mail";

function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") throw new BillingError("Enter an email address.", 400, "bad_request");
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    throw new BillingError("Enter an email address.", 400, "bad_request");
  }
  return email;
}

async function ownerTeam(admin: AdminClient, user: UserRow): Promise<{ teamId: string; view: TeamView }> {
  const now = new Date();
  if (user.plan !== "team" || !hasPaidAccess(snapshotFromRow(user), now)) {
    throw new BillingError("Team billing isn't active.", 403, "bad_request");
  }
  const teamId = await ensureTeam(admin, user.id);
  const view = await loadTeam(admin, user, now);
  return { teamId, view };
}

export async function inviteMember(args: {
  admin: AdminClient;
  user: UserRow;
  origin: string;
  email: unknown;
}): Promise<{ view: TeamView; emailed: boolean; join_url: string }> {
  const email = normalizeEmail(args.email);
  if (email === args.user.email.trim().toLowerCase()) {
    throw new BillingError("You can't invite yourself.", 400, "bad_request");
  }
  const { teamId, view } = await ownerTeam(args.admin, args.user);
  if (seatRoom(view.seats_paid, view.seats_used, view.seats_pending) <= 0) {
    throw new BillingError("All paid seats are in use.", 409, "seat_limit");
  }
  if (view.members.some((member) => member.email.trim().toLowerCase() === email)) {
    throw new BillingError("That person is already on the team.", 409, "already_subscribed");
  }

  const now = new Date().toISOString();
  await args.admin
    .from("team_invites")
    .update({ revoked_at: now })
    .eq("team_id", teamId)
    .eq("email", email)
    .is("accepted_at", null)
    .is("revoked_at", null);

  const token = randomBytes(32).toString("base64url");
  const expiresAt = inviteExpiry(new Date());
  const inserted = await args.admin.from("team_invites").insert({
    team_id: teamId,
    email,
    token,
    invited_by: args.user.id,
    expires_at: expiresAt,
  });
  if (inserted.error) throw new Error(inserted.error.message);

  const joinUrl = `${args.origin}/account/team/join?token=${encodeURIComponent(token)}`;
  const mailed = await sendEmail({
    to: email,
    subject: "You're invited to an Emris team",
    text: [
      `${args.user.email} invited you to their Emris team.`,
      "",
      `Join: ${joinUrl}`,
      "",
      "This invite expires in 7 days. Sign in with this email address to accept it.",
    ].join("\n"),
  });
  const next = await loadTeam(args.admin, args.user);
  return { view: next, emailed: mailed.ok, join_url: joinUrl };
}

export async function removeMember(args: {
  admin: AdminClient;
  user: UserRow;
  userId: unknown;
}): Promise<TeamView> {
  if (typeof args.userId !== "string" || !args.userId) {
    throw new BillingError("Choose a teammate to remove.", 400, "bad_request");
  }
  if (args.userId === args.user.id) throw new BillingError("The owner stays on the team.", 400, "bad_request");
  const { teamId } = await ownerTeam(args.admin, args.user);
  const removed = await args.admin
    .from("team_members")
    .delete()
    .eq("team_id", teamId)
    .eq("user_id", args.userId)
    .eq("role", "member");
  if (removed.error) throw new Error(removed.error.message);
  return loadTeam(args.admin, args.user);
}

export async function acceptInvite(args: {
  admin: AdminClient;
  user: UserRow;
  token: unknown;
}): Promise<TeamView> {
  if (typeof args.token !== "string" || args.token.length < 20) {
    throw new BillingError("This invite link is not valid.", 400, "bad_request");
  }
  const found = await args.admin
    .from("team_invites")
    .select("id, team_id, email, expires_at, accepted_at, revoked_at")
    .eq("token", args.token)
    .maybeSingle();
  if (found.error) throw new Error(found.error.message);
  const invite = found.data;
  if (!invite) throw new BillingError("This invite link is not valid.", 404, "not_found");
  const now = new Date();
  if (
    !inviteIsOpen(
      {
        expiresAt: invite.expires_at as string,
        acceptedAt: invite.accepted_at as string | null,
        revokedAt: invite.revoked_at as string | null,
      },
      now,
    )
  ) {
    throw new BillingError("This invite has expired.", 410, "invite_expired");
  }
  if ((invite.email as string).toLowerCase() !== args.user.email.trim().toLowerCase()) {
    throw new BillingError("Sign in with the invited email.", 403, "bad_request");
  }

  const teamId = invite.team_id as string;
  const team = await args.admin.from("teams").select("owner_id").eq("id", teamId).single();
  if (team.error) throw new Error(team.error.message);
  const owner = await findUser(args.admin, { userId: team.data.owner_id as string });
  if (!owner || owner.plan !== "team" || !hasPaidAccess(snapshotFromRow(owner), now)) {
    throw new BillingError("Team billing isn't active.", 403, "bad_request");
  }
  const current = await loadTeam(args.admin, owner, now);
  if (current.members.some((member) => member.user_id === args.user.id)) {
    return loadTeam(args.admin, args.user, now);
  }
  if (seatRoom(current.seats_paid, current.seats_used, 0) <= 0) {
    throw new BillingError("All paid seats are in use.", 409, "seat_limit");
  }
  const elsewhere = await args.admin
    .from("team_members")
    .select("team_id")
    .eq("user_id", args.user.id)
    .maybeSingle();
  if (elsewhere.error) throw new Error(elsewhere.error.message);
  if (elsewhere.data && elsewhere.data.team_id !== teamId) {
    throw new BillingError("You already belong to a team.", 409, "already_subscribed");
  }

  const joined = await args.admin.from("team_members").insert({
    team_id: teamId,
    user_id: args.user.id,
    role: "member",
  });
  if (joined.error && joined.error.code !== "23505") throw new Error(joined.error.message);
  const accepted = await args.admin
    .from("team_invites")
    .update({ accepted_at: now.toISOString() })
    .eq("id", invite.id as string);
  if (accepted.error) throw new Error(accepted.error.message);
  return loadTeam(args.admin, args.user, now);
}
