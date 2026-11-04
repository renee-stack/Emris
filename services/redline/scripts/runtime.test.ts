// npm run test:runtime
// The agent runtime with a stand-in for Vertex: the tool loop, events, metrics, and how turns start and continue.
// No network and no model calls. The research tools are the real ones, reading jurisdictions/.

import assert from "node:assert/strict";
import { test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { type CreateMessage, Runtime, vertexModel } from "./runtime.ts";

const usage = (input: number, output: number) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }) as Anthropic.Usage;
const reply = (stop: Anthropic.Message["stop_reason"], content: Anthropic.ContentBlock[], u = usage(100, 10)) =>
  ({ id: "msg", type: "message", role: "assistant", model: "m", content, stop_reason: stop, stop_sequence: null, usage: u }) as Anthropic.Message;
const text = (t: string) => ({ type: "text", text: t, citations: null }) as Anthropic.TextBlock;
const toolUse = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input }) as Anthropic.ToolUseBlock;

/** Replies in order, and keeps every request it was sent. */
function scripted(replies: Anthropic.Message[]) {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const create: CreateMessage = async (params) => {
    requests.push(structuredClone(params));
    const next = replies.shift();
    if (!next) throw new Error("No more scripted replies.");
    return next;
  };
  return { create, requests };
}

const spec = (extra: Partial<{ disableTools: string[] }> = {}) => ({
  model: { name: "truefoundry/claude-haiku-4-5" },
  instructions: "Answer the letter.",
  mcpServers: [{ name: "permit-research", ...extra }],
});

test("a turn runs the research tools and returns the model's answer", async () => {
  const { create, requests } = scripted([
    reply("tool_use", [text("Looking it up."), toolUse("t1", "search_code", { jurisdiction: "chicago", query: "stair" })]),
    reply("end_turn", [text("Done.")], usage(200, 20)),
  ]);
  const rt = new Runtime({ createMessage: create });
  const { data: session } = await rt.sessions.create({ agent: { spec: spec() } });
  const turn = await rt.runTurn(session.id, "C1 Stair headroom is missing.");

  assert.equal(turn.status, "done");
  assert.equal(turn.text, "Done.");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].model, "claude-haiku-4-5@20251001");
  assert.ok(requests[0].tools?.some((t) => "name" in t && t.name === "search_code"));
  const results = requests[1].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
  assert.equal(results[0].tool_use_id, "t1");
  assert.match(String(results[0].content), /results/);

  const [listed] = await rt.sessions.listTurns(session.id);
  assert.equal(listed.state.metrics.inputTokens, 300);
  assert.equal(listed.state.metrics.outputTokens, 30);
  assert.ok(listed.state.metrics.totalCostInUsd > 0);
  const events = await rt.sessions.listTurnEvents(session.id, listed.id);
  assert.deepEqual(events.map((e) => e.type), ["user.message", "model.message", "tool.response", "model.message"]);
  const call = events.find((e) => e.type === "model.message" && e.toolCalls);
  assert.equal(call?.type === "model.message" && call.toolCalls?.[0].function.name, "search_code");
});

test("disabled tools aren't offered", async () => {
  const { create, requests } = scripted([reply("end_turn", [text("ok")])]);
  const rt = new Runtime({ createMessage: create });
  const { data: session } = await rt.sessions.create({ agent: { spec: spec({ disableTools: ["similar_comments"] }) } });
  await rt.runTurn(session.id, "hi");
  const names = (requests[0].tools ?? []).map((t) => ("name" in t ? t.name : ""));
  assert.ok(names.includes("search_code"));
  assert.ok(!names.includes("similar_comments"));
});

test("a root turn starts fresh, and a non-root turn continues", async () => {
  const { create, requests } = scripted([reply("end_turn", [text("one")]), reply("end_turn", [text("two")]), reply("end_turn", [text("three")])]);
  const rt = new Runtime({ createMessage: create });
  const { data: session } = await rt.sessions.create({ agent: { spec: spec() } });
  await rt.runTurn(session.id, "first");
  await rt.runTurn(session.id, "second", false);
  await rt.runTurn(session.id, "third", true);
  assert.equal(requests[1].messages.length, 3);
  assert.equal(requests[2].messages.length, 1);
});

test("hitting the output limit is an error, not an answer", async () => {
  const { create } = scripted([reply("max_tokens", [text("partial")])]);
  const rt = new Runtime({ createMessage: create });
  const { data: session } = await rt.sessions.create({ agent: { spec: spec() } });
  const turn = await rt.runTurn(session.id, "hi");
  assert.equal(turn.status, "error");
  assert.match(turn.error ?? "", /output limit/);
});

test("a failed model call ends the turn with its message", async () => {
  const rt = new Runtime({ createMessage: async () => { throw new Error("permission denied"); } });
  const { data: session } = await rt.sessions.create({ agent: { spec: spec() } });
  const turn = await rt.runTurn(session.id, "hi");
  assert.equal(turn.status, "error");
  assert.equal(turn.error, "permission denied");
});

test("agents are found by name", async () => {
  const rt = new Runtime({ createMessage: scripted([]).create });
  const { data: agent } = await rt.agents.create({ name: "runtime-test-agent", manifest: spec() });
  const { data: session } = await rt.sessions.create({ agent: { name: "runtime-test-agent" } });
  assert.equal(session.agentName, agent.name);
  await assert.rejects(rt.sessions.create({ agent: { name: "nobody" } }));
});

test("agent.json's model names map to Vertex ids", () => {
  assert.equal(vertexModel({ name: "truefoundry/claude-haiku-4-5" }), "claude-haiku-4-5@20251001");
  assert.equal(vertexModel("claude-sonnet-5-5"), "claude-sonnet-5-5");
});
