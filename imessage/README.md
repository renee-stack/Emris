# Emris iMessage agent

Text the Emris number a question ("what's being built near 2400 N Milwaukee?"). This service
sends it to `POST {EMRIS_API_URL}/api/ask` (contract §2.5) and texts back:

```
<reply>

{EMRIS_PUBLIC_URL}<url>
```

Built on [Photon Spectrum](https://photon.codes/docs) (`spectrum-ts`, cloud iMessage provider).
Standalone Node/TypeScript service with its own `package.json`, separate from the Next.js app.

## Behavior

- Empty or non-text messages (photos, tapbacks) are ignored.
- The first message from a new sender gets this intro bubble before the answer:
  "Emris here. Ask me about permits and infrastructure near any Chicago address or neighborhood."
  (Remembered in memory, so it resets when the service restarts.)
- If `/api/ask` fails, returns a bad shape, or takes over 15s, the reply is:
  "Emris is thinking too hard. Try again in a moment, or open {EMRIS_PUBLIC_URL}"
- Every inbound (`IN`) and outbound (`OUT`) message is logged to the console with a timestamp.
- Shows the typing indicator while waiting on the API.

## Setup

Needs Node 20.12+ (uses the built-in `.env` loader).

```bash
cd imessage
npm install
cp .env.example .env
```

Fill in `.env`:

| Var | What |
|---|---|
| `PHOTON_PROJECT_ID` | Photon project ID (app.photon.codes → project Settings) |
| `PHOTON_PROJECT_SECRET` | Photon project secret |
| `EMRIS_API_URL` | Where the Next.js app runs, e.g. `http://localhost:3000` |
| `EMRIS_PUBLIC_URL` | Base for the texted link, e.g. the deployed URL. Falls back to `APP_BASE_URL`, then `EMRIS_API_URL` |

`.env` is git-ignored. Never commit it.

## Test locally (no Photon credentials needed)

Against the real app (run `npm run dev` at the repo root first):

```bash
npm run test-local "where is multifamily heating up on the south side?"
```

Against the bundled stub instead (in a second terminal, `npm run stub` listens on :3999):

```bash
npm run stub
```

```bash
EMRIS_API_URL=http://localhost:3999 npm run test-local "what's near 1800 S Halsted in Pilsen"
```

test-local acts as one brand-new sender, so the intro always appears. The stub returns a
contract-shaped answer. Put `error` in the question to get a 500, or `slow` to hit the 15s timeout.

## Run the live agent

After `.env` has Photon credentials:

```bash
npm start
```

Text the project's iMessage line. Ctrl-C stops it cleanly.

## Files

- `src/index.ts`: Spectrum app; reads `app.messages`, replies with `space.send`
- `src/emris.ts`: platform-independent logic (API call, timeout, intro, formatting)
- `src/test-local.ts`: CLI that runs the same logic without iMessage
- `stub/server.ts`: fake `/api/ask` for testing
