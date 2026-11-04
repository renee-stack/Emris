// npm run setup [-- --ping]
// Registers the agent from agent/ with the runtime and shows what it will run. --ping also makes one tiny model call,
// which checks the Google Cloud credentials and that Claude is enabled for the project.
// run-evals calls the same sync before every run, so the agent that runs always matches agent/ at HEAD.

import { client, die, flag, headSha, readAgent, syncAgent } from "./lib.ts";
import { vertexModel } from "./runtime.ts";

const tf = client();
const { agent, skills } = readAgent();
const saved = await syncAgent(tf, headSha());
const model = vertexModel(saved.manifest.model);
console.log(`✓ Agent "${saved.name}" matches agent/ at ${headSha().slice(0, 7)}`);
console.log(`  model: ${model} on Vertex AI, project ${process.env.VERTEX_PROJECT_ID || process.env.ANTHROPIC_VERTEX_PROJECT_ID || "(from credentials)"}, region ${process.env.VERTEX_REGION || process.env.CLOUD_ML_REGION || "global"}`);
console.log(`  tools: ${(agent.mcp_servers ?? []).map((s) => s.name).join(", ") || "(none)"}, in-process`);
console.log(`  skills: ${skills.map((s) => s.name).join(", ") || "(none)"}, pasted into the instructions`);

if (flag("ping")) {
  const { data: session } = await tf.sessions.create({ agent: { spec: { model: saved.manifest.model, instructions: "Reply with the single word OK." } } });
  const turn = await tf.runTurn(session.id, "Ping.");
  if (turn.status !== "done") die(`The model call failed: ${turn.error}\n  Check \`gcloud auth application-default login\`, the project, and that Claude is enabled in Vertex AI's Model Garden.`);
  console.log(`✓ ${model} answered: ${turn.text.trim().slice(0, 40)}`);
}
