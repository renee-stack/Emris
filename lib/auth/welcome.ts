/** One welcome note with a link back to the person's market. Sends only when Resend is configured. */
export async function sendWelcomeEmail(input: {
  to: string;
  marketUrl: string;
  placeName: string | null;
}): Promise<"sent" | "not_configured" | "failed"> {
  const key = process.env.RESEND_API_KEY?.trim() ?? "";
  const from = process.env.RESEND_FROM?.trim() ?? "";
  if (!key || !from) return "not_configured";
  const where = input.placeName ? input.placeName : "your market";
  const text = `Your market on Emris is ready.\n\nOpen ${where}:\n${input.marketUrl}\n`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: "Your market on Emris",
        text,
      }),
    });
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
