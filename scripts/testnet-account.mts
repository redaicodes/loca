// Create a testnet account funded by the NEAR faucet helper and save its key to .env (gitignored).
// Testnet NEAR has no value. Never point this at mainnet.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { KeyPair } from "near-api-js";

const env = existsSync(".env") ? readFileSync(".env", "utf8") : "";
if (/^NEAR_ACCOUNT_ID=.+/m.test(env)) {
  console.log("NEAR_ACCOUNT_ID already set in .env; not creating another account.");
  process.exit(0);
}
const accountId = process.argv[2] ?? `loca-${Date.now().toString(36)}.testnet`;
const key = KeyPair.fromRandom("ed25519");
const res = await fetch("https://helper.nearprotocol.com/account", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: key.getPublicKey().toString() }),
});
const body = await res.text();
if (!res.ok) {
  console.error(`Faucet refused (${res.status}): ${body.slice(0, 300)}`);
  process.exit(1);
}
appendFileSync(".env", `\nNEAR_ACCOUNT_ID=${accountId}\nNEAR_PRIVATE_KEY=${key.toString()}\n`);
console.log(`Created ${accountId}; key saved to .env`);
