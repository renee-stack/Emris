// Shared helpers for the scripts: config, the agent runtime, git, the agent files and the eval tasks.
// The runtime (scripts/runtime.ts) runs agents on Claude through Google Vertex AI. It replaced TrueForge and keeps
// the shape of TrueForge's client, which is why callers still name it `tf`.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Runtime, RuntimeApi, type TurnResult } from "./runtime.ts";
import type { ScoredTask } from "../evals/score.ts";

/** REDLINE_HOME points these tools at another checkout of the repo: the market loop's branch worktree. */
export const ROOT = process.env.REDLINE_HOME ? resolve(process.env.REDLINE_HOME) : resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const AGENT_DIR = join(ROOT, "agent");
export const TASKS_DIR = join(ROOT, "evals", "tasks");
export const RUNS_DIR = join(ROOT, "runs");
/** Sign-off decisions from the demo's review queue. improve reads these along with the eval results. */
export const FEEDBACK_FILE = join(ROOT, "feedback", "reviews.jsonl");
export const SUMMARY_CSV = join(RUNS_DIR, "summary.csv");

// ---------- config ----------

const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (existsSync(join(TOOL_ROOT, ".env"))) process.loadEnvFile(join(TOOL_ROOT, ".env"));

export function client(): Runtime {
  return new Runtime();
}

export function die(msg: string): never {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

export function option(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// ---------- git ----------

export function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

/** The commit that's running. A container has no .git, so its image sets REDLINE_GIT_SHA at build time. */
export function headSha(): string {
  return process.env.REDLINE_GIT_SHA || git("rev-parse", "HEAD");
}

/** True when these paths have no uncommitted changes (staged, unstaged or untracked). */
export function isClean(...paths: string[]): boolean {
  return git("status", "--porcelain", "--", ...paths) === "";
}

// ---------- the agent's files ----------

export interface AgentFile {
  name: string;
  description: string;
  model: { name: string; params?: Record<string, unknown> };
  /** "inline": skills are pasted into the instructions. "git" needed TrueForge's sandbox and isn't supported any more. */
  skill_mode?: "inline" | "git";
  /** Tool servers this agent uses. permit-research runs in-process, so the URL is no longer used. */
  mcp_servers?: { name: string; url: string }[];
}

export interface SkillFile {
  name: string;
  description: string;
  body: string;
  /** Path inside the repo, e.g. agent/skills/review-checklist */
  path: string;
}

export function readAgent(): { agent: AgentFile; instructions: string; skills: SkillFile[] } {
  const agent = JSON.parse(readFileSync(join(AGENT_DIR, "agent.json"), "utf8")) as AgentFile;
  if (process.env.TF_AGENT_NAME) agent.name = process.env.TF_AGENT_NAME;
  if (process.env.TF_MODEL) agent.model = { ...agent.model, name: process.env.TF_MODEL };
  const instructions = readFileSync(join(AGENT_DIR, "instructions.md"), "utf8");
  const skillsDir = join(AGENT_DIR, "skills");
  const skills: SkillFile[] = [];
  if (existsSync(skillsDir)) {
    for (const dir of readdirSync(skillsDir).sort()) {
      const file = join(skillsDir, dir, "SKILL.md");
      if (!existsSync(file)) continue;
      const { meta, body } = parseFrontmatter(readFileSync(file, "utf8"));
      skills.push({
        name: meta.name ?? dir,
        description: meta.description ?? "",
        body,
        path: `agent/skills/${dir}`,
      });
    }
  }
  return { agent, instructions, skills };
}

function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: m[2] };
}

/** The agent spec built from agent/. With a place, other places' local skills are left out, so their rules can't leak in. */
export function buildManifest(_gitRef?: string, opts: { place?: string } = {}): RuntimeApi.AgentSpec {
  const { agent, instructions, skills: allSkills } = readAgent();
  if ((agent.skill_mode ?? "inline") !== "inline") die('skill_mode "git" needed TrueForge\'s sandbox. Set "skill_mode": "inline" in agent/agent.json.');
  const skills = opts.place ? allSkills.filter((s) => !s.name.startsWith("local-") || s.name === `local-${opts.place}`) : allSkills;
  // The playbook lives in the instructions, and the improve step rewrites it there.
  const inlined = skills.map((s) => `\n\n---\n\n# Skill: ${s.name}\n\n_${s.description}_\n\n${s.body.trim()}`).join("");
  const mcpServers = (agent.mcp_servers ?? []).map((s) => ({ name: s.name }));
  return { model: agent.model, instructions: instructions.trim() + inlined, mcpServers };
}

/** Register the agent with the runtime so sessions can name it. `gitRef` is kept for callers; the spec doesn't depend on it. */
export async function syncAgent(tf: Runtime, gitRef: string): Promise<RuntimeApi.Agent> {
  const { agent } = readAgent();
  const manifest = buildManifest(gitRef);
  const existing = await findAgent(tf, agent.name);
  if (existing) return (await tf.agents.update(existing.id, { description: agent.description, manifest })).data;
  return (await tf.agents.create({ name: agent.name, description: agent.description, manifest })).data;
}

export async function findAgent(tf: Runtime, name: string): Promise<RuntimeApi.Agent | undefined> {
  return (await tf.agents.list({ agentName: name })).find((a) => a.name === name);
}

// ---------- tasks ----------

export interface Task extends ScoredTask {
  project: ScoredTask["project"] & { address: string; reviewer: string };
  sheets: { id: string; title: string }[];
}

export function loadTasks(): Task[] {
  return readdirSync(TASKS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(TASKS_DIR, f), "utf8")) as Task);
}

/** The message the agent gets for one correction letter. Same text every run. */
export function taskPrompt(t: Pick<Task, "project" | "sheets" | "comments">): string {
  return [
    "Answer this correction letter.",
    "",
    `Jurisdiction id: ${t.project.jurisdiction}`,
    `Project: ${t.project.address}. ${t.project.description}`,
    `Reviewer: ${t.project.reviewer}`,
    "",
    "Sheet index:",
    ...t.sheets.map((s) => `- ${s.id}: ${s.title}`),
    "",
    "Correction letter:",
    ...t.comments.map((c) => `${c.id} [${c.heading}] ${c.text}`),
  ].join("\n");
}

// ---------- turns and sessions ----------

export type { TurnResult };

/**
 * Run one turn and wait for the answer. A root turn starts a new conversation,
 * so tasks in the same session don't see each other.
 */
export async function runTurn(tf: Runtime, sessionId: string, content: string, root = true): Promise<TurnResult> {
  return tf.runTurn(sessionId, content, root);
}

/** Everything the runtime kept about a session: the session, every turn, and every turn's events. */
export async function exportSession(tf: Runtime, sessionId: string) {
  const { data: session } = await tf.sessions.get(sessionId);
  const turns: (RuntimeApi.Turn & { events: RuntimeApi.SessionEvent[] })[] = [];
  for (const turn of await tf.sessions.listTurns(sessionId)) turns.push({ ...turn, events: await tf.sessions.listTurnEvents(sessionId, turn.id) });
  turns.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { exported_at: new Date().toISOString(), runtime: "vertex", session, turns };
}

export type SessionExport = Awaited<ReturnType<typeof exportSession>>;

/** Tokens and tool calls for a whole session, from its export. */
export function sessionStats(exp: SessionExport): { tokens: number; toolCalls: number } {
  let tokens = 0;
  let toolCalls = 0;
  for (const t of exp.turns) {
    tokens += t.state.metrics.totalTokens;
    for (const e of t.events) if (e.type === "model.message") toolCalls += e.toolCalls?.length ?? 0;
  }
  return { tokens, toolCalls };
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

export function runDir(n: number): string {
  return join(RUNS_DIR, `run-${String(n).padStart(2, "0")}`);
}
