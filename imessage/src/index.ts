// Emris iMessage agent on Photon Spectrum Cloud.
import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { config } from "./config.ts";
import { handleText } from "./emris.ts";
import { logIn, logOut } from "./log.ts";

if (!config.photonProjectId || !config.photonProjectSecret) {
  console.error("Missing PHOTON_PROJECT_ID / PHOTON_PROJECT_SECRET in imessage/.env.");
  console.error('Without credentials, use: npm run test-local "your question"');
  process.exit(1);
}

const app = await Spectrum({
  projectId: config.photonProjectId,
  projectSecret: config.photonProjectSecret,
  providers: [imessage.config()],
});

console.log(`[emris] iMessage agent up. API=${config.apiUrl} links=${config.publicUrl}`);

const shutdown = async () => {
  console.log("[emris] shutting down");
  await app.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

for await (const [space, message] of app.messages) {
  if (message.direction !== "inbound") continue;
  const who = message.sender?.id ?? space.id;

  if (message.content.type !== "text") {
    logIn(who, `<${message.content.type}>`);
    continue;
  }
  const text = message.content.text;
  logIn(who, text);

  // Handle each message without blocking the stream for other senders.
  void (async () => {
    try {
      await space.responding(async () => {
        for (const reply of await handleText(who, text)) {
          await space.send(reply);
          logOut(who, reply);
        }
      });
    } catch (err) {
      console.error(`[emris] failed to reply to ${who}:`, err);
    }
  })();
}
