import { createHash, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { trialEndingEmail } from "./pure";
import { markTrialReminderSent, upsertEmail, usersDueTrialReminder } from "./store";

export function safeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

export async function sendResendEmail(input: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(detail.slice(0, 300) || `Email provider returned ${res.status}`);
  }
}

/**
 * Sends the trial-ending note once, when the trial end is inside the next 48 hours.
 * Without RESEND_API_KEY the message is stored as pending and retried on the next run.
 */
export async function sendDueTrialReminders(
  db: DatabaseSync,
  now: Date,
  options: { accountUrl: string; apiKey?: string; from: string },
): Promise<{ sent: number; pending: number }> {
  const due = usersDueTrialReminder(db, now);
  let sent = 0;
  let pending = 0;
  for (const user of due) {
    if (!user.trialEndsAt) continue;
    const message = trialEndingEmail({ trialEndsAt: user.trialEndsAt, accountUrl: options.accountUrl });
    if (!options.apiKey) {
      upsertEmail(db, {
        userId: user.id,
        kind: "trial_ending",
        to: user.email,
        subject: message.subject,
        body: message.text,
        status: "pending",
        now,
      });
      pending += 1;
      continue;
    }
    try {
      await sendResendEmail({
        apiKey: options.apiKey,
        from: options.from,
        to: user.email,
        subject: message.subject,
        text: message.text,
      });
      upsertEmail(db, {
        userId: user.id,
        kind: "trial_ending",
        to: user.email,
        subject: message.subject,
        body: message.text,
        status: "sent",
        now,
      });
      markTrialReminderSent(db, user.id, now);
      sent += 1;
    } catch (error) {
      upsertEmail(db, {
        userId: user.id,
        kind: "trial_ending",
        to: user.email,
        subject: message.subject,
        body: message.text,
        status: "failed",
        error: error instanceof Error ? error.message : "send failed",
        now,
      });
      pending += 1;
    }
  }
  return { sent, pending };
}
