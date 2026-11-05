// Run the hosted swarm's tick locally against testnet: `npx tsx scripts/swarm-tick.mts [ticks]`.
// Uses the same secrets the worker gets (SWARM_PRIVATE_KEY and SWARM_SEED from .env).
import "dotenv/config";
import { tick } from "../worker/swarm.js";

const env = {
  SWARM_ACCOUNT_ID: process.env.SWARM_ACCOUNT_ID!,
  SWARM_PRIVATE_KEY: process.env.SWARM_PRIVATE_KEY!,
  SWARM_SEED: process.env.SWARM_SEED!,
  PACE: process.env.PACE ?? "2",
};
const n = Number(process.argv[2] ?? 1);
for (let i = 0; i < n; i++) {
  const t0 = performance.now();
  const r = await tick(env);
  console.log(`-- tick ${i + 1}: ${JSON.stringify(r)} in ${Math.round(performance.now() - t0)} ms\n`);
  if (i < n - 1) await new Promise((res) => setTimeout(res, 60_000));
}
