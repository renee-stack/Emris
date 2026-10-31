import { CONTACT_EMAIL } from "@/lib/pricing";

export type Mail = {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
};

export function contactRecipient(): string {
  return process.env.CONTACT_EMAIL?.trim() || CONTACT_EMAIL;
}

/** Sends through Resend when RESEND_API_KEY is set. */
export async function sendEmail(message: Mail): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return { ok: false, error: "Email is not configured." };
  const from = process.env.CONTACT_FROM?.trim() || "Emris <onboarding@resend.dev>";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      reply_to: message.replyTo,
    }),
  });
  if (!response.ok) {
    return { ok: false, error: "The email service rejected the message." };
  }
  return { ok: true };
}
