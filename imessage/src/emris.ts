// Platform-agnostic logic: turn an inbound text into the outbound text.
// Used by both the iMessage agent (index.ts) and test-local.ts.
import { config } from "./config.ts";

export const INTRO =
  "Emris here. Ask me about permits and infrastructure near any Chicago address or neighborhood.";

export const fallbackText = (publicUrl = config.publicUrl) =>
  `Emris is thinking too hard. Try again in a moment, or open ${publicUrl}`;

export type AskResponse = { reply: string; url: string };

/** POST {apiUrl}/api/ask (contract §2.5). Throws on non-2xx, bad shape, or timeout. */
export async function ask(question: string, opts = config): Promise<AskResponse> {
  const res = await fetch(`${opts.apiUrl}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
    signal: AbortSignal.timeout(opts.timeoutMs),
  });
  const body = (await res.json().catch(() => null)) as Partial<AskResponse & { error: string }> | null;
  if (!res.ok) throw new Error(`API ${res.status}: ${body?.error ?? "no error body"}`);
  if (!body || typeof body.reply !== "string" || typeof body.url !== "string") {
    throw new Error(`API returned unexpected shape: ${JSON.stringify(body)}`);
  }
  return { reply: body.reply, url: body.url };
}

/** reply, blank line, absolute link. */
export function formatAnswer({ reply, url }: AskResponse, publicUrl = config.publicUrl): string {
  const link = /^https?:\/\//.test(url) ? url : `${publicUrl}${url.startsWith("/") ? "" : "/"}${url}`;
  return `${reply.trim()}\n\n${link}`;
}

const seenSenders = new Set<string>();

/**
 * Returns the messages to send back, in order (intro first for a new sender),
 * or [] for an empty message. Never throws: API failures become the fallback text.
 */
export async function handleText(senderId: string, text: string, opts = config): Promise<string[]> {
  const question = text.trim();
  if (!question) return [];

  const out: string[] = [];
  if (!seenSenders.has(senderId)) {
    seenSenders.add(senderId);
    out.push(INTRO);
  }
  try {
    out.push(formatAnswer(await ask(question, opts), opts.publicUrl));
  } catch (err) {
    console.error(`[emris] /api/ask failed for ${senderId}:`, err instanceof Error ? err.message : err);
    out.push(fallbackText(opts.publicUrl));
  }
  return out;
}
