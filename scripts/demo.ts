// End-to-end LOCA loop. `--network sandbox` runs a local NEAR node (no funds, no keys);
// `--network testnet` uses NEAR_ACCOUNT_ID / NEAR_PRIVATE_KEY. Writes runs/<network>-latest.json.

import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Account, nearToYocto } from "near-api-js";
import { STRATEGIES, type BidDecision } from "../src/agents/lenders.js";
import { sha256, vendorDataset, writeReport, type ResearchBrief } from "../src/agents/research.js";
import { call, chainNowNs, connect, ContractError, EXPLORER, view, type Env, type Network, type TxResult } from "../src/lib/near.js";
import { fmtUsd, usd, type Agent, type Offer, type Order, type ScoreReport } from "../src/lib/types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WASM = {
  loca: join(ROOT, "contracts/target/near/loca/loca.wasm"),
  token: join(ROOT, "contracts/target/near/test_token/test_token.wasm"),
};
const SEC = 1_000_000_000n;

interface Step {
  act: string;
  title: string;
  detail?: Record<string, unknown>;
  tx?: string;
  events?: unknown[];
  error?: string;
}

const args = process.argv.slice(2);
const network = (args[args.indexOf("--network") + 1] ?? "sandbox") as Network;

const steps: Step[] = [];
let env: Env;

function log(step: Step) {
  steps.push(step);
  const tx = step.tx ? `  tx ${step.tx.slice(0, 10)}…` : "";
  console.log(`[ ${step.act} ] ${step.title}${tx}${step.error ? `  ✗ ${step.error}` : ""}`);
}

async function tx<T>(act: string, title: string, p: Promise<TxResult<T>>, detail?: Record<string, unknown>) {
  const r = await p;
  log({ act, title, detail, tx: r.hash, events: r.events });
  return r;
}

async function main() {
  console.log(`LOCA demo on ${network}\n`);
  env = await connect(network);
  const p = env.provider;
  try {
    // ---------- setup ----------
    const n = network === "sandbox";
    const [locaAcc, usdcAcc, arbiter, operator, agent, vendor, custA, custB, custC, l1, l2, l3] = await Promise.all([
      env.account("loca", n ? "20" : "3.4"),
      env.account("usdc", n ? "10" : "2"),
      ...["arbiter", "operator", "agent", "vendor", "cust-a", "cust-b", "cust-c", "lender-cov", "lender-hist", "lender-conc"]
        .map((x) => env.account(x, n ? "5" : "0.2")),
    ]);
    const lenders = [l1, l2, l3];
    const LOCA = locaAcc.accountId;
    const USDC = usdcAcc.accountId;

    await usdcAcc.deployContract(readFileSync(WASM.token));
    await call(usdcAcc, USDC, "new", { symbol: "USDC", decimals: 6 });
    await locaAcc.deployContract(readFileSync(WASM.loca));
    await tx("00", "Deploy LOCA credit contract", call(locaAcc, LOCA, "new", {
      owner_id: env.root.accountId, arbiter_id: arbiter.accountId, token_id: USDC,
      dispute_window_sec: 30, max_advance_bps: 5000,
    }), { loca: LOCA, token: USDC });

    const everyone = [LOCA, operator, agent, vendor, custA, custB, custC, ...lenders, arbiter]
      .map((a) => (typeof a === "string" ? a : a.accountId));
    await call(env.root, USDC, "register", { account_ids: everyone });
    for (const [a, amt] of [[custA, 200], [custB, 200], [custC, 200], [operator, 50], [l1, 200], [l2, 200], [l3, 200]] as const) {
      await call(env.root, USDC, "mint", { account_id: a.accountId, amount: usd(amt).toString() });
    }

    const ftCall = (from: Account, amount: bigint, msg: unknown) =>
      call(from, USDC, "ft_transfer_call", { receiver_id: LOCA, amount: amount.toString(), msg: JSON.stringify(msg) }, 1n);
    const now = () => chainNowNs(p);
    const getAgent = () => view<Agent>(p, LOCA, "get_agent", { agent_id: agent.accountId });
    const getScore = () => view<ScoreReport>(p, LOCA, "get_score", { agent_id: agent.accountId });

    // ---------- identity ----------
    await call(env.root, LOCA, "add_vendor", { vendor_id: vendor.accountId });
    const profile = { name: "Atlas Research Agent", service: "paid research briefs", version: "1" };
    // Registration costs 0.01 NEAR of storage; the agent's orders and loans, and each lender's bids,
    // are paid from storage prepaid here (NEP-145 style).
    await tx("01", "Agent registers LOCA ID", call(agent, LOCA, "register_agent", {
      operator_id: operator.accountId, profile_hash: sha256(JSON.stringify(profile)),
    }, nearToYocto("0.01")), { agent: agent.accountId, operator: operator.accountId, profile });
    await call(env.root, LOCA, "storage_deposit", { account_id: agent.accountId }, nearToYocto("0.2"));
    for (const l of lenders) await call(env.root, LOCA, "storage_deposit", { account_id: l.accountId }, nearToYocto("0.05"));
    await tx("01", "Operator sets spend policy (approved vendor, $50 cap)", call(operator, LOCA, "set_spend_policy", {
      agent_id: agent.accountId, allowed_vendors: [vendor.accountId], max_principal: usd(50).toString(),
    }));
    await tx("01", "Operator posts $5 first-loss bond", ftCall(operator, usd(5), { PostBond: { agent_id: agent.accountId } }));

    // ---------- prior track record ----------
    const fundOrder = async (customer: Account, amount: number, terms: unknown) => {
      const deadline = (await now()) + 3600n * SEC;
      const r = await ftCall(customer, usd(amount), {
        FundOrder: { agent_id: agent.accountId, terms_hash: sha256(JSON.stringify(terms)), deadline: deadline.toString() },
      });
      const ev = r.events.find((e) => e.event === "order_funded")!;
      return { id: ev.data.order_id as number, r };
    };
    for (const [i, c] of [custA, custB, custC].entries()) {
      const { id } = await fundOrder(c, 20, { brief: `warm-up ${i}` });
      await call(agent, LOCA, "mark_delivered", { order_id: id, deliverable_hash: sha256(`warm-up ${i}`) });
      await call(c, LOCA, "approve", { order_id: id });
    }
    const score0 = await getScore();
    log({ act: "02", title: `Track record: 3 paid orders, score ${score0.score} (${score0.rated ? "rated" : "unrated"})`, detail: { score: score0 } });

    // ---------- a credit cycle ----------
    async function creditCycle(act: string, customer: Account, brief: ResearchBrief) {
      const { id: orderId, r } = await fundOrder(customer, 100, brief);
      log({ act, title: `Customer escrows $100 order #${orderId}`, tx: r.hash, events: r.events, detail: { brief } });

      const expires = (await now()) + 600n * SEC;
      await tx(act, "Agent requests $30 advance for data, max fee $3", call(agent, LOCA, "request_credit", {
        order_id: orderId, amount: usd(30).toString(), vendor_id: vendor.accountId,
        max_fee: usd(3).toString(), expires_at: expires.toString(),
      }));

      const [order, agentView, score] = await Promise.all([
        view<Order>(p, LOCA, "get_order", { order_id: orderId }), getAgent(), getScore(),
      ]);
      const decisions: { lender: string; strategy: string; decision: BidDecision }[] = [];
      for (const [i, s] of STRATEGIES.entries()) {
        const decision = s.decide({ order, request: order.credit_request!, agent: agentView, score, exposureToAgent: 0n });
        decisions.push({ lender: lenders[i].accountId, strategy: s.id, decision });
        if (!decision.bid) {
          log({ act, title: `${s.label}: no bid`, detail: { rationale: decision.rationale } });
          continue;
        }
        const offerExp = (await now()) + 300n * SEC;
        await tx(act, `${s.label}: bids ${fmtUsd(decision.fee)} (${decision.feeBps}bps)`, ftCall(lenders[i], usd(30), {
          MakeOffer: { order_id: orderId, fee: decision.fee.toString(), expires_at: offerExp.toString(), strategy: s.id },
        }), { rationale: decision.rationale });
      }

      const t = await now();
      const offers = (await view<Offer[]>(p, LOCA, "get_offers", { order_id: orderId }))
        .filter((o) => o.status === "Open" && BigInt(o.expires_at) > t)
        .sort((a, b) => Number(BigInt(a.fee) - BigInt(b.fee)));
      if (!offers.length) throw new Error("no valid offers");
      const best = offers[0];
      await tx(act, `Agent accepts cheapest valid offer: ${fmtUsd(best.fee)} from ${best.strategy}`,
        call(agent, LOCA, "accept_offer", { offer_id: best.id }), { offers });

      await tx(act, "Vendor withdraws $30 paid directly by the loan", call(vendor, LOCA, "withdraw"));
      const data = vendorDataset(vendor.accountId, brief);
      const report = await writeReport(brief, data);
      await tx(act, `Agent delivers report (${report.engine})`, call(agent, LOCA, "mark_delivered", {
        order_id: orderId, deliverable_hash: report.hash,
      }), { report: report.markdown });
      const settle = await tx(act, "Customer approves; escrow runs the repayment waterfall", call(customer, LOCA, "approve", { order_id: orderId }));
      const lender = lenders.find((l) => l.accountId === best.lender_id)!;
      await call(lender, LOCA, "withdraw");
      await call(agent, LOCA, "withdraw");
      const scoreAfter = await getScore();
      log({ act, title: `Score ${score.score} → ${scoreAfter.score}`, detail: { before: score, after: scoreAfter, settlement: settle.events } });
      return { decisions, best };
    }

    const brief: ResearchBrief = { topic: "Stablecoin flows into NEAR, Q3", questions: ["Net inflow", "Top source chain", "Active wallets"] };
    const first = await creditCycle("03", custA, brief);
    const second = await creditCycle("04", custB, { ...brief, topic: "Agent payments volume on NEAR" });
    log({ act: "04", title: `Repeat borrower pays ${fmtUsd(second.best.fee)} vs ${fmtUsd(first.best.fee)} on the first loan`, detail: {
      first: first.decisions.map((d) => ({ strategy: d.strategy, fee: d.decision.bid ? d.decision.fee.toString() : null })),
      second: second.decisions.map((d) => ({ strategy: d.strategy, fee: d.decision.bid ? d.decision.fee.toString() : null })),
    } });

    // ---------- blocked paths ----------
    const blocked = async (title: string, p: Promise<unknown>) => {
      try {
        await p;
        log({ act: "05", title, error: "UNEXPECTEDLY SUCCEEDED" });
      } catch (e) {
        const code = e instanceof ContractError ? e.code ?? e.message : (e as Error).message;
        log({ act: "05", title: `Blocked: ${title}`, error: code, tx: e instanceof ContractError ? e.hash : undefined });
      }
    };
    {
      const r = await ftCall(operator, usd(10), {
        FundOrder: { agent_id: agent.accountId, terms_hash: "x", deadline: ((await now()) + 3600n * SEC).toString() },
      });
      const rej = r.events.find((e) => e.event === "deposit_rejected");
      log({ act: "05", title: "Blocked: operator posing as customer (deposit returned, no order)",
        error: (rej?.data.reason as string) ?? "UNEXPECTEDLY ACCEPTED", tx: r.hash, events: r.events });
    }
    const { id: o3 } = await fundOrder(custC, 100, { brief: "blocked-path" });
    await blocked("agent routes loan to its operator", call(agent, LOCA, "request_credit", {
      order_id: o3, amount: usd(30).toString(), vendor_id: operator.accountId, max_fee: usd(3).toString(),
      expires_at: ((await now()) + 600n * SEC).toString(),
    }));
    await blocked("advance above 50% of escrow", call(agent, LOCA, "request_credit", {
      order_id: o3, amount: usd(51).toString(), vendor_id: vendor.accountId, max_fee: usd(3).toString(),
      expires_at: ((await now()) + 600n * SEC).toString(),
    }));

    const final = { agent: await getAgent(), score: await getScore() };
    const out = {
      network, explorer: EXPLORER[network], generatedAt: new Date().toISOString(),
      contracts: { loca: LOCA, token: USDC }, finalState: final, steps,
    };
    mkdirSync(join(ROOT, "runs"), { recursive: true });
    const file = join(ROOT, "runs", `${network}-latest.json`);
    writeFileSync(file, JSON.stringify(out, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
    console.log(`\nRun log: ${file}`);
  } finally {
    await env.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
