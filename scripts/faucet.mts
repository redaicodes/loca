// Testnet faucet helpers for the swarm. Testnet NEAR has no value; never point this at mainnet.
//   npx tsx scripts/faucet.mts root          create SWARM_ACCOUNT_ID via the faucet, key saved to .env
//   npx tsx scripts/faucet.mts topup [n]     create n throwaway faucet accounts and sweep them into the swarm root
import "dotenv/config";
import { appendFileSync } from "node:fs";
import { Account, JsonRpcProvider, KeyPair, type KeyPairString } from "near-api-js";

const RPC = process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com";
const provider = new JsonRpcProvider({ url: RPC });

async function faucetAccount(id: string) {
  const key = KeyPair.fromRandom("ed25519");
  const res = await fetch("https://helper.nearprotocol.com/account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newAccountId: id, newAccountPublicKey: key.getPublicKey().toString() }),
  });
  if (!res.ok) throw new Error(`Faucet refused ${id} (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return key;
}

async function balance(id: string) {
  const a = (await provider.viewAccount({ accountId: id })) as { amount: string | bigint };
  return Number(BigInt(a.amount) / 10n ** 21n) / 1000;
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "root") {
  if (process.env.SWARM_ACCOUNT_ID) {
    console.log(`SWARM_ACCOUNT_ID already set: ${process.env.SWARM_ACCOUNT_ID} (${await balance(process.env.SWARM_ACCOUNT_ID)} NEAR)`);
    process.exit(0);
  }
  const id = `loca-swarm-${Date.now().toString(36)}.testnet`;
  const key = await faucetAccount(id);
  appendFileSync(".env", `\nSWARM_ACCOUNT_ID=${id}\nSWARM_PRIVATE_KEY=${key.toString()}\n`);
  await new Promise((r) => setTimeout(r, 3000));
  console.log(`Created ${id} with ${await balance(id)} NEAR; key saved to .env`);
} else if (cmd === "topup") {
  const root = process.env.SWARM_ACCOUNT_ID;
  if (!root) throw new Error("Run `faucet.mts root` first");
  for (let i = 0; i < Number(arg ?? 1); i++) {
    const id = `loca-tmp-${Date.now().toString(36)}.testnet`;
    const key = await faucetAccount(id);
    await new Promise((r) => setTimeout(r, 3000));
    // Deleting the throwaway account sends its whole balance to the swarm root.
    await new Account(id, provider, key.toString() as KeyPairString).deleteAccount(root);
    console.log(`Swept ${id} into ${root}`);
  }
  console.log(`${root}: ${await balance(root)} NEAR`);
} else {
  console.log("usage: faucet.mts root | topup [n]");
}
