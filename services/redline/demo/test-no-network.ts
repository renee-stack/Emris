// Preloaded into servers started by the tests, so a test can't reach Google Cloud, a model or anything else, whatever
// is running on this machine. Health checks pass, so services start as they would for real.
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.pathname === "/health") return new Response("ok");
  throw new Error("Network is blocked in tests.");
}) as typeof fetch;
