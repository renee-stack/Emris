// Runs Redline's agents on Claude through Google Vertex AI, inside this process.
//
// This replaced TrueForge. It keeps the small part of TrueForge's client that the scripts use (agents, sessions,
// turns, events), so their code didn't change: an agent is a model plus instructions, a session holds turns, and a
// turn is one loop of model calls and research tool calls. Everything lives in memory for the life of the process,
// which is all the scripts need: each one exports a session right after running it.
//
// Settings, all optional:
//   VERTEX_PROJECT_ID   Google Cloud project. Defaults to ANTHROPIC_VERTEX_PROJECT_ID, then the credentials' project.
//   VERTEX_REGION       defaults to CLOUD_ML_REGION, then "global"
//   REDLINE_MODEL       Vertex model id for every agent, overriding agent.json
// Credentials come from Google's Application Default Credentials: the VM's service account in production, or
// `gcloud auth application-default login` on a laptop.

import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../mcp/tools.ts";

export namespace RuntimeApi {
  export interface McpServerRef {
    name: string;
    disableTools?: string[];
    preload?: boolean;
    requireApprovalForTools?: string[];
  }
  export interface AgentSpec {
    /** As agent.json writes it: { name: "truefoundry/claude-haiku-4-5" }. Sampling params are ignored. */
    model: { name: string; params?: Record<string, unknown> } | string;
    instructions: string;
    mcpServers?: McpServerRef[];
    skills?: { name: string }[];
    config?: Record<string, unknown>;
  }
  export interface Agent {
    id: string;
    name: string;
    description?: string;
    manifest: AgentSpec;
  }
  export interface ToolCall {
    id: string;
    function: { name: string; arguments: string };
  }
  export type SessionEvent =
    | { type: "user.message"; content: string; createdAt: string }
    | { type: "model.message"; content: string; toolCalls?: ToolCall[]; createdAt: string }
    | { type: "tool.response"; toolCallId: string; name: string; content: string; isError: boolean; createdAt: string };
  export interface TurnMetrics {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
    /** An estimate from the prices below, not a bill. */
    totalCostInUsd: number;
  }
  export interface Turn {
    id: string;
    createdAt: string;
    state: { status: "done" | "error"; output?: string; message?: string; metrics: TurnMetrics };
  }
  export interface Session {
    id: string;
    agentName: string | null;
    model: string;
    title?: string;
    metadata?: Record<string, unknown>;
    createdAt: string;
  }
}

export interface TurnResult {
  turnId: string;
  status: string;
  text: string;
  error?: string;
}

/** The one call the runner makes, so tests can stand in for Vertex. */
export type CreateMessage = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;

const RESEARCH_SERVER = "permit-research";
const MAX_STEPS = 40;
const MAX_TOKENS = 16000;
const MAX_SESSIONS = 500;

/** Dollars per million tokens: input, output, cache read, cache write. Third-party listings; check Vertex AI's pricing page. */
const PRICES: Record<string, [number, number, number, number]> = {
  "claude-haiku-4-5": [1, 5, 0.1, 1.25],
};

/** agent.json names models the way TrueForge did ("truefoundry/claude-haiku-4-5"). Vertex wants the bare id, with a dated snapshot after "@". */
const VERTEX_IDS: Record<string, string> = { "claude-haiku-4-5": "claude-haiku-4-5@20251001" };

export function vertexModel(model: RuntimeApi.AgentSpec["model"]): string {
  if (process.env.REDLINE_MODEL) return process.env.REDLINE_MODEL;
  const name = typeof model === "string" ? model : model.name;
  const bare = name.split("/").pop() ?? name;
  return VERTEX_IDS[bare] ?? bare;
}

function estimateUsd(model: string, m: Omit<RuntimeApi.TurnMetrics, "totalTokens" | "totalCostInUsd">): number {
  const price = PRICES[model.split("@")[0]];
  if (!price) return 0;
  const [inp, out, read, write] = price;
  return (m.inputTokens * inp + m.outputTokens * out + m.cacheReadTokens * read + m.cacheWriteTokens * write) / 1e6;
}

// ---------- shared state for this process ----------

interface SessionState {
  session: RuntimeApi.Session;
  spec: RuntimeApi.AgentSpec;
  turns: (RuntimeApi.Turn & { events: RuntimeApi.SessionEvent[] })[];
  /** The conversation so far, for a turn that continues instead of starting a new root. */
  history: Anthropic.MessageParam[];
}

const agents = new Map<string, RuntimeApi.Agent>();
const sessions = new Map<string, SessionState>();
let vertex: AnthropicVertex | null = null;
let research: Promise<Client> | null = null;

function defaultCreate(): CreateMessage {
  vertex ??= new AnthropicVertex({
    projectId: process.env.VERTEX_PROJECT_ID || process.env.ANTHROPIC_VERTEX_PROJECT_ID || undefined,
    region: process.env.VERTEX_REGION || process.env.CLOUD_ML_REGION || "global",
  });
  const client = vertex;
  return (params) => client.messages.create(params);
}

/** The research tools, served in this process over an in-memory MCP connection. */
function researchClient(): Promise<Client> {
  research ??= (async () => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await buildServer().connect(serverSide);
    const client = new Client({ name: "redline-runtime", version: "1.0.0" });
    await client.connect(clientSide);
    return client;
  })().catch((e) => {
    research = null;
    throw e;
  });
  return research;
}

async function toolsFor(spec: RuntimeApi.AgentSpec): Promise<Anthropic.Tool[]> {
  const refs = spec.mcpServers ?? [];
  for (const r of refs) if (!r.name.startsWith(RESEARCH_SERVER)) throw new Error(`Unknown tool server "${r.name}". Only ${RESEARCH_SERVER} runs in-process.`);
  const ref = refs.find((r) => r.name.startsWith(RESEARCH_SERVER));
  if (!ref) return [];
  const disabled = new Set(ref.disableTools ?? []);
  const { tools } = await (await researchClient()).listTools();
  return tools
    .filter((t) => !disabled.has(t.name))
    .map((t) => ({ name: t.name, description: t.description ?? "", input_schema: t.inputSchema as Anthropic.Tool.InputSchema }));
}

async function callTool(name: string, input: unknown): Promise<{ text: string; isError: boolean }> {
  try {
    const result = await (await researchClient()).callTool({ name, arguments: (input ?? {}) as Record<string, unknown> });
    const parts = (result.content as { type: string; text?: string }[]) ?? [];
    return { text: parts.map((p) => p.text ?? "").join("\n"), isError: Boolean(result.isError) };
  } catch (e) {
    return { text: `The tool failed: ${(e as Error).message}`, isError: true };
  }
}

/** The research tools on their own, for health checks. */
export async function researchTools() {
  const { tools } = await (await researchClient()).listTools();
  return { list: tools.map((t) => t.name), call: callTool };
}

function getSession(id: string): SessionState {
  const s = sessions.get(id);
  if (!s) throw new Error(`No session ${id} in this process.`);
  return s;
}

const now = () => new Date().toISOString();

// ---------- the client ----------

export class Runtime {
  private readonly create: CreateMessage;

  constructor(opts: { createMessage?: CreateMessage } = {}) {
    this.create = opts.createMessage ?? defaultCreate();
  }

  readonly agents = {
    list: async ({ agentName }: { agentName?: string } = {}) => [...agents.values()].filter((a) => !agentName || a.name.includes(agentName)),
    create: async ({ name, description, manifest }: { name: string; description?: string; manifest: RuntimeApi.AgentSpec }) => {
      const agent = { id: `agent-${randomUUID()}`, name, description, manifest };
      agents.set(agent.id, agent);
      return { data: agent };
    },
    update: async (id: string, { description, manifest }: { description?: string; manifest: RuntimeApi.AgentSpec }) => {
      const agent = agents.get(id);
      if (!agent) throw new Error(`No agent ${id}.`);
      const next = { ...agent, description: description ?? agent.description, manifest };
      agents.set(id, next);
      return { data: next };
    },
  };

  readonly sessions = {
    create: async ({ agent, metadata }: { agent: { name: string } | { spec: RuntimeApi.AgentSpec }; metadata?: Record<string, unknown> }) => {
      let spec: RuntimeApi.AgentSpec;
      let agentName: string | null = null;
      if ("spec" in agent) {
        spec = agent.spec;
      } else {
        const found = [...agents.values()].find((a) => a.name === agent.name);
        if (!found) throw new Error(`No agent named ${agent.name}. Sync it first.`);
        spec = found.manifest;
        agentName = found.name;
      }
      const session: RuntimeApi.Session = { id: `session-${randomUUID()}`, agentName, model: vertexModel(spec.model), metadata, createdAt: now() };
      if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value!);
      sessions.set(session.id, { session, spec, turns: [], history: [] });
      return { data: session };
    },
    update: async (id: string, { title }: { title?: string }) => {
      const s = getSession(id);
      if (title !== undefined) s.session.title = title;
      return { data: s.session };
    },
    get: async (id: string) => ({ data: getSession(id).session }),
    list: async () => [...sessions.values()].map((s) => s.session),
    listTurns: async (id: string) => getSession(id).turns.map(({ events: _events, ...turn }) => turn),
    listTurnEvents: async (id: string, turnId: string) => getSession(id).turns.find((t) => t.id === turnId)?.events ?? [],
  };

  /** Not used by the in-process runner. Kept so callers written for TrueForge still work. */
  readonly settings = {
    skills: { createOrUpdate: async (_: unknown) => ({}) },
    mcpServers: { createOrUpdate: async (_: unknown) => ({}) },
  };

  readonly server = {
    getCapabilities: async () => ({ data: { skill: { enabled: false, reason: "Skills are pasted into the instructions. There's no sandbox." } } }),
  };

  /**
   * One turn: model calls and research tool calls until the model answers. A root turn starts a new conversation,
   * so letters in the same session don't see each other. Otherwise it continues the session's last turn.
   */
  async runTurn(sessionId: string, content: string, root = true): Promise<TurnResult> {
    const s = getSession(sessionId);
    const turn = { id: `turn-${randomUUID()}`, createdAt: now(), events: [] as RuntimeApi.SessionEvent[] };
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const finish = (status: "done" | "error", output: string, message?: string): TurnResult => {
      const totalTokens = usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
      const metrics = { ...usage, totalTokens, totalCostInUsd: estimateUsd(s.session.model, usage) };
      s.turns.push({ id: turn.id, createdAt: turn.createdAt, state: { status, output, message, metrics }, events: turn.events });
      return { turnId: turn.id, status, text: output, error: message };
    };

    const messages: Anthropic.MessageParam[] = root ? [] : [...s.history];
    messages.push({ role: "user", content });
    turn.events.push({ type: "user.message", content, createdAt: now() });

    try {
      const tools = await toolsFor(s.spec);
      // The instructions and tools are the same for every letter, so they're cached between calls.
      const system: Anthropic.TextBlockParam[] = [{ type: "text", text: s.spec.instructions, cache_control: { type: "ephemeral" } }];
      for (let step = 0; step < MAX_STEPS; step++) {
        const response = await this.create({ model: s.session.model, max_tokens: MAX_TOKENS, system, messages, ...(tools.length ? { tools } : {}) });
        usage.inputTokens += response.usage.input_tokens;
        usage.outputTokens += response.usage.output_tokens;
        usage.cacheReadTokens += response.usage.cache_read_input_tokens ?? 0;
        usage.cacheWriteTokens += response.usage.cache_creation_input_tokens ?? 0;

        const text = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
        const uses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
        const toolCalls = uses.map((u) => ({ id: u.id, function: { name: u.name, arguments: JSON.stringify(u.input) } }));
        turn.events.push({ type: "model.message", content: text, ...(toolCalls.length ? { toolCalls } : {}), createdAt: now() });
        messages.push({ role: "assistant", content: response.content });

        if (response.stop_reason === "tool_use") {
          // Every result goes back in one message, so the model keeps making parallel calls.
          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const u of uses) {
            const { text: out, isError } = await callTool(u.name, u.input);
            turn.events.push({ type: "tool.response", toolCallId: u.id, name: u.name, content: out, isError, createdAt: now() });
            results.push({ type: "tool_result", tool_use_id: u.id, content: out, ...(isError ? { is_error: true } : {}) });
          }
          messages.push({ role: "user", content: results });
          continue;
        }
        if (response.stop_reason === "pause_turn") continue;
        if (response.stop_reason === "max_tokens") return finish("error", text, `The reply hit the ${MAX_TOKENS}-token output limit.`);
        if (response.stop_reason === "refusal") return finish("error", text, "The model declined this request.");
        s.history = messages;
        return finish("done", text);
      }
      return finish("error", "", `The agent made more than ${MAX_STEPS} model calls without answering.`);
    } catch (e) {
      return finish("error", "", (e as Error).message);
    }
  }
}
