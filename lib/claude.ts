// Thin wrapper around the Anthropic SDK. Server-only.
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-sonnet-5-5";

// This model thinks by default, which eats max_tokens. "between_tools" turns pre-response thinking off.
export const NO_THINKING = { type: "between_tools" } as const;

let client: Anthropic | undefined;

export function getClaude(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  return (client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));
}

/** Single-turn text completion. Returns the concatenated text blocks. */
export async function complete(opts: { system: string; user: string; maxTokens?: number }): Promise<string> {
  const msg = await getClaude().messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 1500,
    thinking: NO_THINKING,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  });
  if (msg.stop_reason === "max_tokens") throw new Error("Model reply was cut off (max_tokens)");
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
