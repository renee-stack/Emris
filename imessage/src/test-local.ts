// Local test mode: no Photon credentials needed.
//   npm run test-local "where is multifamily heating up?"
// Simulates one text from a brand-new sender and prints exactly what would be sent back.
import { config } from "./config.ts";
import { handleText } from "./emris.ts";
import { logIn, logOut } from "./log.ts";

const question = process.argv.slice(2).join(" ");
const who = "+15555550100 (test-local)";

console.log(`[emris] test-local  API=${config.apiUrl}  links=${config.publicUrl}\n`);
logIn(who, question);
const replies = await handleText(who, question);
if (replies.length === 0) console.log("(empty message, ignored; no reply sent)");
for (const r of replies) logOut(who, r);

console.log("\n--- as texted ---");
console.log(replies.join("\n\n--- next bubble ---\n\n") || "(nothing)");
