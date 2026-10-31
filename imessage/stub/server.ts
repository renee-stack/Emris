// Tiny stand-in for the Emris Next.js API, contract §2.5 shape.
//   npm run stub            (listens on :3999)
// Questions containing "error" -> 500, "slow" -> waits 20s (tests the 15s timeout).
import { createServer } from "node:http";

const PORT = Number(process.env.STUB_PORT) || 3999;

createServer((req, res) => {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.method !== "POST" || req.url !== "/api/ask") return send(404, { error: "not found" });

  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    let question = "";
    try {
      question = String(JSON.parse(raw).question ?? "").trim();
    } catch {
      return send(400, { error: "invalid JSON" });
    }
    console.log(`[stub] question: ${question}`);
    if (!question) return send(400, { error: "question is required" });
    if (/error/i.test(question)) return send(500, { error: "stub forced error" });
    const reply =
      "Logan Square tract 2215 scores 87 (beats 84% of Chicago tracts), with 4 new-construction permits " +
      "and 210 units in the last 24 months. Permits are up 50% year over year and the Milwaukee Ave " +
      "streetscape is under construction nearby.";
    const body = /pilsen|address|near/i.test(question)
      ? { reply, url: "/?lat=41.8565&lng=-87.6564&z=15" }
      : { reply, url: "/?tract=17031221500" };
    if (/slow/i.test(question)) return void setTimeout(() => send(200, body), 20_000);
    send(200, body);
  });
}).listen(PORT, () => console.log(`[stub] /api/ask stub on http://localhost:${PORT}`));
