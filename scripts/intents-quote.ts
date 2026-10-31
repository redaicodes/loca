// Live NEAR Intents dry quotes: how a customer on another chain would fund a $100 LOCA order.
// `dry: true` moves no funds and needs no keys. Writes runs/intents-latest.json.
//
// Refund addresses below are public example addresses used only to satisfy quote validation;
// a live (non-dry) quote must use the payer's own refund address.

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFundingQuote, findAsset, fundOrderMsg, listTokens, requestQuote, type QuoteOutcome } from "../src/intents/oneclick.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// 1Click rejects recipients that do not exist on mainnet. Until LOCA is deployed there, quote to
// a stand-in account: route, price and fees do not depend on the recipient.
const LOCA = process.env.LOCA_MAINNET_CONTRACT ?? "intents.near";
const STAND_IN = !process.env.LOCA_MAINNET_CONTRACT;

const ROUTES = [
  { label: "ETH on Arbitrum", symbol: "ETH", chain: "arb", refundTo: "0x2527D02599Ba641c19FEa793cD0F167589a0f10D" },
  { label: "USDC on Base", symbol: "USDC", chain: "base", refundTo: "0x2527D02599Ba641c19FEa793cD0F167589a0f10D" },
  { label: "SOL on Solana", symbol: "SOL", chain: "sol", refundTo: "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK" },
  { label: "BTC on Bitcoin", symbol: "BTC", chain: "btc", refundTo: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" },
];

async function main() {
  const tokens = await listTokens();
  console.log(`1Click registry: ${tokens.length} assets. Quoting $100 USDC into ${LOCA} (dry run).`);
  if (STAND_IN) console.log("Recipient is a stand-in: LOCA is not deployed on mainnet yet. Set LOCA_MAINNET_CONTRACT to quote into it.");
  console.log();
  const deadlineNs = BigInt(Date.now() + 3_600_000) * 1_000_000n;
  const msg = fundOrderMsg({ agentId: "atlas-research.near", customerId: "customer.near", termsHash: "demo", deadlineNs });

  const results: { label: string; originAsset: string; outcome: QuoteOutcome }[] = [];
  const run = async (label: string, originAsset: string, refundTo: string, usdcOut = 100_000_000n) => {
    const req = buildFundingQuote({ originAsset, usdcOut, refundTo, locaContract: LOCA, msg, dry: true });
    const outcome = await requestQuote(req, tokens);
    results.push({ label, originAsset, outcome });
    if (outcome.ok) {
      const q = outcome.response.quote;
      console.log(`[ OK ] ${label}: pay ${q.amountInFormatted} (~$${Number(q.amountInUsd).toFixed(2)}) → ${q.amountOutFormatted} USDC delivered, ~${q.timeEstimate}s`);
    } else {
      console.log(`[ ${outcome.reason} ] ${label}: ${outcome.message}`);
    }
  };

  for (const r of ROUTES) {
    const asset = findAsset(tokens, r.symbol, r.chain);
    if (!asset) {
      console.log(`[ ROUTE_UNAVAILABLE ] ${r.label}: not in registry`);
      continue;
    }
    await run(r.label, asset.assetId, r.refundTo);
  }
  // Failure paths the UI must show honestly.
  await run("Unlisted token (fake asset id)", "nep141:not-a-real-token.near", ROUTES[0].refundTo);
  await run("ETH on Arbitrum with an invalid refund address", findAsset(tokens, "ETH", "arb")!.assetId, "not-an-address");

  mkdirSync(join(ROOT, "runs"), { recursive: true });
  const file = join(ROOT, "runs", "intents-latest.json");
  writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString(), recipient: LOCA, recipientIsStandIn: STAND_IN, escrowMsg: msg, results }, null, 2));
  console.log(`\nRun log: ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
