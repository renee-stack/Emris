// Thin wrapper around the Anthropic SDK. Server-only.
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-sonnet-5-5"; // memo + phone reply
export const FAST_MODEL = "claude-haiku-5-5"; // intent classifier

// Sonnet thinks by default, which eats max_tokens. "between_tools" turns pre-response thinking off.
export const NO_THINKING = { type: "between_tools" } as const;

let client: Anthropic | undefined;

export function getClaude(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  // maxRetries: 0 — never pay twice for a failed call.
  return (client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0 }));
}

/** One-line spend log per call. */
export function logUsage(label: string, msg: Anthropic.Message) {
  console.log(`[claude] ${label} model=${msg.model} in=${msg.usage.input_tokens} out=${msg.usage.output_tokens} stop=${msg.stop_reason}`);
}

/** Single-turn text completion. `truncated` is true when max_tokens cut the reply off. */
export async function complete(opts: {
  label: string;
  system: string;
  user: string;
  maxTokens: number;
}): Promise<{ text: string; truncated: boolean }> {
  const msg = await getClaude().messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens,
    thinking: NO_THINKING,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  });
  logUsage(opts.label, msg);
  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return { text, truncated: msg.stop_reason === "max_tokens" };
}

/** Cut text back to its last full sentence (used when max_tokens truncates a reply). */
export function toLastSentence(text: string): string {
  const m = text.match(/^[\s\S]*[.!?](?=\s|$)/);
  return m ? m[0].trim() : text.trim();
}
