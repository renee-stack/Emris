// npm run mcp
// Serves the agent's research tools (mcp/tools.ts) over HTTP, for MCP clients outside this process.
// Redline's own runner calls the same tools in-process (scripts/runtime.ts), so it doesn't need this server.

import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer, packs } from "./tools.ts";

const PORT = Number(process.env.MCP_PORT ?? 8791);
// Stays on loopback unless a deployment sets this. There's no auth here, so only ever bind it to a private network.
const HOST = process.env.MCP_HOST ?? "127.0.0.1";

createServer(async (req, res) => {
  if (req.url === "/health") return void res.writeHead(200).end("ok");
  if (req.url !== "/mcp") return void res.writeHead(404).end();
  // Stateless: a new server and transport per request, which is all read-only tools need.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = buildServer();
  res.on("close", () => void server.close());
  await server.connect(transport);
  await transport.handleRequest(req, res);
}).listen(PORT, HOST, () => {
  const list = [...packs.values()].map((p) => `${p.profile.id} (${p.sections.length} entries, ${p.history.length} past comments)`).join(", ");
  console.log(`permit-research MCP server on http://${HOST}:${PORT}/mcp: ${list}`);
});
