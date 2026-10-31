import { BillingError, billingResponse, jsonError, readJson } from "@/lib/billing/http";
import { contactRecipient, sendEmail } from "@/lib/mail";

const MAX = 2000;

function text(value: unknown, label: string, max = 200): string {
  if (typeof value !== "string") throw new BillingError(`${label} is required.`, 400, "bad_request");
  const trimmed = value.trim();
  if (!trimmed) throw new BillingError(`${label} is required.`, 400, "bad_request");
  if (trimmed.length > max) throw new BillingError(`${label} is too long.`, 400, "bad_request");
  return trimmed;
}

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    if (!body || typeof body !== "object") {
      throw new BillingError("Request body must be an object.", 400, "bad_request");
    }
    const record = body as Record<string, unknown>;
    const name = text(record.name, "Name");
    const email = text(record.email, "Email");
    const company = text(record.company, "Company");
    const message = text(record.message, "Message", MAX);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BillingError("Enter a work email.", 400, "bad_request");
    }
    const sent = await sendEmail({
      to: contactRecipient(),
      replyTo: email,
      subject: `Enterprise inquiry from ${name}`,
      text: [`Name: ${name}`, `Email: ${email}`, `Company: ${company}`, "", message].join("\n"),
    });
    if (!sent.ok) {
      return jsonError(503, `We couldn't send that note. Email ${contactRecipient()} directly.`, "internal");
    }
    return Response.json({ sent: true });
  } catch (error) {
    return billingResponse(error);
  }
}
