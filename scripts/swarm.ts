// LOCA agent swarm on NEAR testnet: eight service agents, their operators, customers, three
// lender agents, vendors and an arbiter, all trading on one LOCA market with real transactions.
//
//   pnpm swarm setup            deploy a fresh market + accounts under SWARM_ACCOUNT_ID (once)
//   pnpm swarm run [minutes]    run the economy (default 60 minutes; Ctrl-C to stop)
//
// Testnet only. Funds come from the testnet faucet (scripts/faucet.mts). The market and every
// participant's key live under the swarm root account; the shared sub-account key is in .env.

import "dotenv/config";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, type KeyPairString, nearToYocto } from "near-api-js";
import { STRATEGIES, type LenderStrategy } from "../src/agents/lenders.js";
import { sha256 } from "../src/agents/research.js";
import { call, ContractError, type TxResult } from "../src/lib/near.js";
import { fmtUsd, usd, type Agent, type Loan, type Order, type ScoreReport } from "../src/lib/types.js";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const STATE_FILE = join(ROOT_DIR, "runs/swarm.json");
const LOG_FILE = join(ROOT_DIR, "runs/swarm-log.jsonl");
const WASM = {
  loca: join(ROOT_DIR, "contracts/target/near/loca/loca.wasm"),
  token: join(ROOT_DIR, "contracts/target/near/test_token/test_token.wasm"),
};
const SEC = 1_000_000_000n;
const DISPUTE_WINDOW_SEC = 30;

// ---------------------------------------------------------------- cast

type VendorKind = "data" | "compute" | "api";
interface AgentSpec {
  slug: string; name: string; service: string; operator: string;
  price: [number, number]; reliability: number; borrowRate: number; vendors: VendorKind[];
  /** Share of orders from the agent's main customer (customer-concentration signal). */
  concentration?: number; bond: number;
}
const AGENTS: AgentSpec[] = [
  { slug: "atlas", name: "Atlas Research", service: "research briefs", operator: "northwind", price: [60, 160], reliability: 0.97, borrowRate: 0.8, vendors: ["data"], bond: 15 },
  { slug: "quill", name: "Quill Translate", service: "document translation", operator: "northwind", price: [25, 90], reliability: 0.99, borrowRate: 0.5, vendors: ["api"], bond: 10 },
  { slug: "forge", name: "Forge Code Review", service: "code audits", operator: "helix", price: [80, 200], reliability: 0.95, borrowRate: 0.9, vendors: ["compute"], bond: 20 },
  { slug: "echo", name: "Echo Transcribe", service: "audio transcription", operator: "helix", price: [20, 70], reliability: 0.98, borrowRate: 0.6, vendors: ["compute", "api"], bond: 10 },
  { slug: "pixel", name: "Pixel Studio", service: "image generation", operator: "kite", price: [30, 120], reliability: 0.88, borrowRate: 0.85, vendors: ["compute"], bond: 10 },
  { slug: "ledger", name: "Ledger Books", service: "bookkeeping", operator: "kite", price: [40, 140], reliability: 0.99, borrowRate: 0.6, vendors: ["api"], concentration: 0.8, bond: 15 },
  { slug: "scout", name: "Scout Leads", service: "sales lead lists", operator: "orbit", price: [50, 150], reliability: 0.82, borrowRate: 0.9, vendors: ["data"], bond: 5 },
  { slug: "nova", name: "Nova Support", service: "support triage", operator: "orbit", price: [20, 80], reliability: 0.93, borrowRate: 0.7, vendors: ["api"], bond: 10 },
];
const OPERATORS = ["northwind", "helix", "kite", "orbit"];
const CUSTOMERS = ["acme", "bluefin", "corvid", "delta", "evergreen", "fjord"];
const LENDERS: { slug: string; name: string; strategy: LenderStrategy }[] = [
  { slug: "cover-capital", name: "Cover Capital", strategy: STRATEGIES[0] },
  { slug: "track-fund", name: "Track Record Fund", strategy: STRATEGIES[1] },
  { slug: "spread-credit", name: "Spread Credit", strategy: STRATEGIES[2] },
];
const VENDORS: Record<VendorKind, string> = { data: "datahub", compute: "gpu-pool", api: "api-mart" };

// ---------------------------------------------------------------- plumbing

// Free public RPCs rate-limit a busy swarm, so reads rotate across several and sends fail over.
const RPCS = (process.env.SWARM_RPCS ?? "https://test.rpc.fastnear.com,https://near-testnet.drpc.org,https://rpc.testnet.fastnear.com").split(",");
const providers = RPCS.map((url) => new JsonRpcProvider({ url }, { retries: 3, wait: 700, backoff: 1.6 }));
const provider = new FailoverRpcProvider(providers);
let rr = 0;
async function rotate<T>(fn: (p: JsonRpcProvider) => Promise<T>): Promise<T> {
  let last: unknown;
  for (let i = 0; i < providers.length; i++) {
    try {
      return await fn(providers[rr++ % providers.length]);
    } catch (e) {
      last = e;
      // A contract panic is an answer, not an outage.
      if (!/429|rate limit|fetch failed|timeout|ECONN|50\d|Server error/i.test(String(e))) throw e;
    }
  }
  throw last;
}
const ROOT_ID = process.env.SWARM_ACCOUNT_ID;
const ROOT_KEY = process.env.SWARM_PRIVATE_KEY;
if (!ROOT_ID || !ROOT_KEY) throw new Error("Run `npx tsx scripts/faucet.mts root` first (sets SWARM_ACCOUNT_ID)");
const root = new Account(ROOT_ID, provider, ROOT_KEY as KeyPairString);
const id = (slug: string) => `${slug}.${ROOT_ID}`;
const LOCA = id("market");
const USDC = id("usdc");

let SUB_KEY = process.env.SWARM_SUBKEY;
const accounts = new Map<string, Account>();
const acct = (slug: string) => {
  let a = accounts.get(slug);
  if (!a) accounts.set(slug, (a = new Account(id(slug), provider, SUB_KEY as KeyPairString)));
  return a;
};

// Free RPCs rate-limit bursts, so the whole swarm keeps at most four requests in flight.
let inflight = 0;
const waiters: (() => void)[] = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (inflight >= 4) await new Promise<void>((r) => waiters.push(r));
  inflight++;
  try {
    return await fn();
  } finally {
    inflight--;
    waiters.shift()?.();
  }
}

// One transaction at a time per account, so nonces never collide.
const queues = new Map<string, Promise<unknown>>();
function serial<T>(who: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(who) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  queues.set(who, next);
  return next;
}
const tx = <T>(who: Account, method: string, args: Record<string, unknown>, contract = LOCA, deposit: bigint = 0n, gas?: bigint): Promise<TxResult<T>> =>
  serial(who.accountId, () => limited(() => call<T>(who, contract, method, args, deposit, gas)));

// ---------------------------------------------------------------- agent keys
// Each agent process signs with a function-call access key: it can call only these market methods,
// cannot attach NEAR, and cannot touch tokens or any other contract. NEAR enforces this before the
// transaction runs. The operator's full-access key (SWARM_SUBKEY) is used only for setup and upkeep.
export const AGENT_METHODS = ["request_credit", "accept_offer", "mark_delivered", "withdraw", "update_profile"];
const AGENT_GAS = 30_000_000_000_000n;
const WITHDRAW_GAS = 60_000_000_000_000n;
const KEY_ALLOWANCE = "1";
const KEYS_FILE = join(ROOT_DIR, "runs/agent-keys.json");
const agentKeys: Record<string, string> = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, "utf8")) : {};
const agentSigners = new Map<string, Account>();
function agentSigner(slug: string): Account {
  const key = agentKeys[slug];
  if (!key) return acct(slug);
  let a = agentSigners.get(slug);
  if (!a || (a as unknown as { __key?: string }).__key !== key) {
    a = new Account(id(slug), provider, key as KeyPairString);
    (a as unknown as { __key?: string }).__key = key;
    agentSigners.set(slug, a);
  }
  return a;
}

/** Give an agent a fresh restricted key, then remove the old one. */
async function issueAgentKey(slug: string) {
  const old = agentKeys[slug];
  const kp = KeyPair.fromRandom("ed25519");
  await serial(id(slug), () => acct(slug).addFunctionCallAccessKey({
    publicKey: kp.getPublicKey().toString(), contractId: LOCA, methodNames: AGENT_METHODS, allowance: nearToYocto(KEY_ALLOWANCE),
  }));
  agentKeys[slug] = kp.toString();
  mkdirSync(dirname(KEYS_FILE), { recursive: true });
  writeFileSync(KEYS_FILE, JSON.stringify(agentKeys, null, 2));
  if (old) await serial(id(slug), () => acct(slug).deleteKey(KeyPair.fromString(old as KeyPairString).getPublicKey().toString())).catch(() => {});
}

async function keyAllowance(slug: string): Promise<bigint | null> {
  const key = agentKeys[slug];
  if (!key) return null;
  try {
    const v = await rotate((p) => p.viewAccessKey({ accountId: id(slug), publicKey: KeyPair.fromString(key as KeyPairString).getPublicKey().toString() }));
    const perm = v.permission as unknown as { FunctionCall?: { allowance: string | bigint | null } };
    return perm.FunctionCall?.allowance != null ? BigInt(perm.FunctionCall.allowance) : null;
  } catch {
    return 0n; // key missing: treat as exhausted so it gets reissued
  }
}

/** Prepay market storage: agents pay for orders and loans, lenders for bids. */
async function ensureStorage(slug: string) {
  const bal = BigInt(await view<string>("storage_balance_of", { account_id: id(slug) }));
  if (bal >= nearToYocto("0.06")) return;
  await tx(root, "storage_deposit", { account_id: id(slug) }, LOCA, nearToYocto("0.3"));
  log("storage", `${slug} storage prepaid with 0.3 testnet NEAR`);
}
const ftCall = (who: Account, amount: bigint, msg: unknown) =>
  tx(who, "ft_transfer_call", { receiver_id: LOCA, amount: amount.toString(), msg: JSON.stringify(msg) }, USDC, 1n);
const view = <T>(method: string, args: Record<string, unknown> = {}, contract = LOCA) =>
  limited(() => rotate((p) => p.callFunction({ contractId: contract, method, args }) as Promise<T>));
// Wall clock is within seconds of block time; deadlines here are minutes long.
const nowNs = async () => BigInt(Date.now()) * 1_000_000n;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

const counters = { orders: 0, loans: 0, noBid: 0, defaults: 0, disputes: 0, errors: 0, txs: 0 };
function log(kind: string, text: string, data: Record<string, unknown> = {}) {
  const line = { t: new Date().toISOString(), kind, text, ...data };
  appendFileSync(LOG_FILE, JSON.stringify(line) + "\n");
  console.log(`${line.t.slice(11, 19)}  ${kind.padEnd(14)} ${text}`);
}

const ACTORS = ["arbiter", ...AGENTS.map((a) => a.slug), ...OPERATORS, ...CUSTOMERS, ...LENDERS.map((l) => l.slug), ...Object.values(VENDORS)];

/** Keep an account's spendable NEAR above a floor (contract accounts: above their storage). */
async function ensureNear(slug: string) {
  const v = await rotate((p) => p.viewAccount({ accountId: id(slug) }));
  const free = BigInt(v.amount) - BigInt(v.storage_usage) * 10n ** 19n;
  const market = slug === "market";
  if (free >= nearToYocto(market ? "0.8" : "0.4")) return;
  const amt = market ? "2" : "0.4";
  await serial(root.accountId, () => root.transfer({ receiverId: id(slug), amount: nearToYocto(amt) }));
  log("topup", `${slug} topped up with ${amt} testnet NEAR`);
}

// ---------------------------------------------------------------- setup

async function setup() {
  if (existsSync(STATE_FILE)) {
    console.log(`Swarm already set up (${STATE_FILE}). Delete it to deploy a new market.`);
    return;
  }
  if (!SUB_KEY) {
    SUB_KEY = KeyPair.fromRandom("ed25519").toString();
    appendFileSync(join(ROOT_DIR, ".env"), `\nSWARM_SUBKEY=${SUB_KEY}\n`);
  }
  const pub = KeyPair.fromString(SUB_KEY as KeyPairString).getPublicKey().toString();
  const create = async (slug: string, near: string) => {
    try {
      await root.createSubAccount({ accountOrPrefix: slug, publicKey: pub, nearToTransfer: nearToYocto(near as `${number}`) });
      console.log(`created ${id(slug)} (${near} NEAR)`);
    } catch (e) {
      if (!String(e).includes("already exists")) throw e;
    }
  };
  // Contract accounts pay for their own storage: LOCA's wasm is ~294 KB (~2.9 NEAR) plus state.
  await create("market", "6");
  await create("usdc", "2.2");
  // Every call reserves 150 TGas (~0.15 testnet NEAR) until its refund lands, so actors keep a margin.
  for (const slug of ACTORS) {
    await create(slug, "0.6");
    await ensureNear(slug);
  }

  // Resumable: each step checks chain state before acting.
  if (!(await view("ft_metadata", {}, USDC).catch(() => null))) {
    await acct("usdc").deployContract(readFileSync(WASM.token));
    await call(acct("usdc"), USDC, "new", { symbol: "USDC", decimals: 6 });
  }
  if (!(await view("get_config").catch(() => null))) {
    await acct("market").deployContract(readFileSync(WASM.loca));
    await call(acct("market"), LOCA, "new", {
      owner_id: ROOT_ID, arbiter_id: id("arbiter"), token_id: USDC, dispute_window_sec: DISPUTE_WINDOW_SEC, max_advance_bps: 5000,
    });
  }
  console.log(`deployed ${LOCA} and ${USDC}`);

  const everyone = [LOCA, ...AGENTS.map((a) => a.slug), ...OPERATORS, ...CUSTOMERS, ...LENDERS.map((l) => l.slug), ...Object.values(VENDORS), "arbiter"]
    .map((s) => (s.includes(".") ? s : id(s)));
  const funded = BigInt(await view<string>("ft_balance_of", { account_id: id(CUSTOMERS[0]) }, USDC).catch(() => "0")) > 0n;
  if (!funded) {
    await call(root, USDC, "register", { account_ids: everyone });
    for (const c of CUSTOMERS) await call(root, USDC, "mint", { account_id: id(c), amount: usd(3000).toString() });
    for (const l of LENDERS) await call(root, USDC, "mint", { account_id: id(l.slug), amount: usd(2500).toString() });
    for (const o of OPERATORS) await call(root, USDC, "mint", { account_id: id(o), amount: usd(300).toString() });
    for (const v of Object.values(VENDORS)) await call(root, LOCA, "add_vendor", { vendor_id: id(v) });
  }

  for (const a of AGENTS) {
    const profile = { name: a.name, service: a.service, operator: a.operator };
    let ag = await view<Agent | null>("get_agent", { agent_id: id(a.slug) });
    if (!ag) await call(acct(a.slug), LOCA, "register_agent", { operator_id: id(a.operator), profile_hash: sha256(JSON.stringify(profile)) }, nearToYocto("0.3"));
    if (!ag?.policy_version) {
      await call(acct(a.operator), LOCA, "set_spend_policy", {
        agent_id: id(a.slug), allowed_vendors: a.vendors.map((v) => id(VENDORS[v])), max_principal: usd(80).toString(),
      });
    }
    ag = await view<Agent>("get_agent", { agent_id: id(a.slug) });
    if (BigInt(ag.bond) === 0n) await ftCall(acct(a.operator), usd(a.bond), { PostBond: { agent_id: id(a.slug) } });
    console.log(`registered ${a.name}`);
  }

  mkdirSync(dirname(STATE_FILE), { recursive: true });
  const state = {
    network: "testnet", createdAt: new Date().toISOString(), root: ROOT_ID, contract: LOCA, token: USDC,
    agents: AGENTS.map((a) => ({ id: id(a.slug), name: a.name, service: a.service, operator: id(a.operator) })),
    operators: OPERATORS.map(id), customers: CUSTOMERS.map(id),
    lenders: LENDERS.map((l) => ({ id: id(l.slug), name: l.name, strategy: l.strategy.id })),
    vendors: Object.entries(VENDORS).map(([kind, v]) => ({ id: id(v), kind })),
    arbiter: id("arbiter"),
  };
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  // The dashboard reads the cast (display names) from here; it holds no keys.
  writeFileSync(join(ROOT_DIR, "docs/swarm.json"), JSON.stringify(state, null, 2));
  console.log(`\nSwarm ready. Market: ${LOCA}\nRun it with: pnpm swarm run`);
}

// ---------------------------------------------------------------- economy

/** Active loans, for the concentration-aware strategy's per-agent exposure. One read per order. */
async function activeLoans(): Promise<Loan[]> {
  const m = await view<{ next_loan_id: number }>("get_market");
  const loans = await view<Loan[]>("get_loans", { from_id: Math.max(0, m.next_loan_id - 100), limit: 100 });
  return loans.filter((l) => l.status === "Active");
}
const exposure = (loans: Loan[], lenderId: string, agentId: string) =>
  loans.filter((l) => l.lender_id === lenderId && l.agent_id === agentId).reduce((a, l) => a + BigInt(l.principal), 0n);

async function cycle(a: AgentSpec, mine: { order?: number }) {
  const agentAcc = acct(a.slug);
  const signer = agentSigner(a.slug);
  const customerSlug = a.concentration && Math.random() < a.concentration ? CUSTOMERS[0] : pick(CUSTOMERS);
  const customer = acct(customerSlug);
  const amount = Math.round(rand(...a.price));
  const t0 = await nowNs();
  const deadline = t0 + 150n * SEC;

  const funded = await ftCall(customer, usd(amount), {
    FundOrder: { agent_id: agentAcc.accountId, terms_hash: sha256(`${a.slug}:${customerSlug}:${t0}`).slice(0, 16), deadline: deadline.toString() },
  });
  const ev = funded.events.find((e) => e.event === "order_funded");
  if (!ev) return log("rejected", `${customerSlug} → ${a.name}: deposit refused`, { tx: funded.hash });
  const orderId = ev.data.order_id as number;
  inFlight.add(orderId);
  mine.order = orderId;
  counters.orders++;
  log("order_funded", `${customerSlug} escrowed ${fmtUsd(usd(amount))} for ${a.name} (order #${orderId})`, { tx: funded.hash, order: orderId });

  // Borrow against the order to buy inputs.
  if (Math.random() < a.borrowRate && amount >= 30) {
    const principal = usd(Math.min(80, Math.round(amount * rand(0.2, 0.45))));
    const vendor = id(VENDORS[pick(a.vendors)]);
    const req = await tx(signer, "request_credit", {
      order_id: orderId, amount: principal.toString(), vendor_id: vendor,
      max_fee: ((principal * 8n) / 100n).toString(), expires_at: (t0 + 90n * SEC).toString(),
    }, LOCA, 0n, AGENT_GAS);
    log("credit_requested", `${a.name} asks ${fmtUsd(principal)} against #${orderId}`, { tx: req.hash, order: orderId });

    const order = await view<Order>("get_order", { order_id: orderId });
    const agent = await view<Agent>("get_agent", { agent_id: agentAcc.accountId });
    const score = await view<ScoreReport>("get_score", { agent_id: agentAcc.accountId });
    const live = await activeLoans();
    const bids = await Promise.all(
      LENDERS.map(async (l) => {
        const d = l.strategy.decide({ order, request: order.credit_request!, agent, score, exposureToAgent: exposure(live, id(l.slug), agentAcc.accountId) });
        if (!d.bid) return null;
        const r = await ftCall(acct(l.slug), principal, {
          MakeOffer: { order_id: orderId, fee: d.fee.toString(), expires_at: (t0 + 85n * SEC).toString(), strategy: l.strategy.id },
        });
        const offer = r.events.find((e) => e.event === "offer_made");
        if (!offer) return null;
        log("offer_made", `${l.name} bids ${fmtUsd(d.fee)} (${(d.feeBps / 100).toFixed(2)}%) on #${orderId}`, { tx: r.hash, order: orderId });
        return { offerId: offer.data.offer_id as number, fee: d.fee, lender: l };
      }),
    );
    const valid = bids.filter(Boolean) as { offerId: number; fee: bigint; lender: (typeof LENDERS)[number] }[];
    if (!valid.length) {
      counters.noBid++;
      log("no_bids", `No lender would fund ${a.name} (score ${score.score}); it works unlevered`, { order: orderId });
    } else {
      const best = valid.sort((x, y) => Number(x.fee - y.fee))[0];
      const acc = await tx(signer, "accept_offer", { offer_id: best.offerId }, LOCA, 0n, AGENT_GAS);
      counters.loans++;
      log("loan_funded", `${a.name} takes ${best.lender.name} at ${fmtUsd(best.fee)}; ${fmtUsd(principal)} paid to ${vendor.split(".")[0]}`, { tx: acc.hash, order: orderId });
    }
  }

  // Do the work.
  await sleep(rand(6_000, 20_000));
  if (Math.random() > a.reliability) {
    log("missed", `${a.name} misses the deadline on #${orderId}`, { order: orderId });
    const wait = Number(deadline - (await nowNs())) / 1e6 + 3_000;
    await sleep(Math.max(0, wait));
    const r = await tx(customer, "cancel_order", { order_id: orderId });
    const def = r.events.find((e) => e.event === "loan_defaulted");
    if (def) counters.defaults++;
    log(def ? "loan_defaulted" : "order_refunded", `${customerSlug} reclaims #${orderId}${def ? `; bond covered ${fmtUsd(BigInt(def.data.paid_from_bond as string))}, loss ${fmtUsd(BigInt(def.data.shortfall as string))}` : ""}`, { tx: r.hash, order: orderId });
    return;
  }
  const d = await tx(signer, "mark_delivered", { order_id: orderId, deliverable_hash: sha256(`${orderId}:${Date.now()}`).slice(0, 32) }, LOCA, 0n, AGENT_GAS);
  log("order_delivered", `${a.name} delivers #${orderId}`, { tx: d.hash, order: orderId });

  // Customer decides.
  await sleep(rand(2_000, 7_000));
  const roll = Math.random();
  let settle: TxResult;
  if (roll < 0.83) {
    settle = await tx(customer, "approve", { order_id: orderId });
  } else if (roll < 0.95) {
    log("silent", `${customerSlug} goes quiet on #${orderId}; keeper finalizes after the window`, { order: orderId });
    await sleep((DISPUTE_WINDOW_SEC + 3) * 1000);
    settle = await tx(root, "finalize", { order_id: orderId });
  } else {
    const dsp = await tx(customer, "dispute", { order_id: orderId, reason_hash: sha256(`dispute ${orderId}`).slice(0, 16) });
    counters.disputes++;
    log("order_disputed", `${customerSlug} disputes #${orderId}`, { tx: dsp.hash, order: orderId });
    await sleep(rand(4_000, 9_000));
    const refundBps = Math.round(rand(10, 60)) * 100;
    settle = await tx(acct("arbiter"), "resolve_dispute", { order_id: orderId, refund_bps: refundBps });
  }
  const s = settle.events.find((e) => e.event === "order_settled");
  if (settle.events.some((e) => e.event === "loan_defaulted")) counters.defaults++;
  if (s) log("order_settled", `#${orderId} settled: lender ${fmtUsd(BigInt(s.data.to_lender as string))}, agent ${fmtUsd(BigInt(s.data.to_agent as string))}${BigInt(s.data.customer_refund as string) ? `, refund ${fmtUsd(BigInt(s.data.customer_refund as string))}` : ""}`, { tx: settle.hash, order: orderId });
}

async function agentWorker(a: AgentSpec, until: number) {
  const runCycle = async () => {
    const mine: { order?: number } = {};
    try {
      await cycle(a, mine);
    } finally {
      // Release this worker's order so the sweeper may take it over if the cycle died.
      if (mine.order !== undefined) inFlight.delete(mine.order);
    }
  };
  await sleep(rand(0, 25_000));
  while (Date.now() < until && !stopping) {
    try {
      await runCycle();
    } catch (e) {
      counters.errors++;
      log("error", `${a.name}: ${e instanceof ContractError ? e.code ?? e.message.slice(0, 120) : String(e).slice(0, 160)}`);
      await sleep(5_000);
    }
    await sleep(rand(15_000, 45_000));
  }
}

const inFlight = new Set<number>();

/** Settle orders abandoned by a restart: finalize after the dispute window, cancel after the deadline. */
async function sweepStale() {
  const m = await view<{ next_order_id: number }>("get_market");
  const orders = await view<Order[]>("get_orders", { from_id: Math.max(0, m.next_order_id - 100), limit: 100 });
  const now = BigInt(Date.now()) * 1_000_000n;
  const customerSlug = (accId: string) => accId.split(".")[0];
  for (const o of orders) {
    if (inFlight.has(o.id)) continue;
    if (o.status === "Delivered" && BigInt(o.delivered_at!) + BigInt(DISPUTE_WINDOW_SEC + 5) * SEC < now) {
      const r = await tx(root, "finalize", { order_id: o.id }).catch(() => null);
      if (r) log("order_settled", `keeper finalizes stale #${o.id}`, { tx: r.hash, order: o.id });
    } else if (o.status === "Funded" && BigInt(o.deadline) + 5n * SEC < now) {
      const r = await tx(acct(customerSlug(o.customer_id)), "cancel_order", { order_id: o.id }).catch(() => null);
      if (r) log(r.events.some((e) => e.event === "loan_defaulted") ? "loan_defaulted" : "order_refunded", `${customerSlug(o.customer_id)} reclaims stale #${o.id}`, { tx: r.hash, order: o.id });
    }
  }
}

/** Pull balances, refill bonds and wallets, keep every account able to pay gas and storage. */
async function housekeeping() {
  for (const slug of [...AGENTS.map((a) => a.slug), ...LENDERS.map((l) => l.slug)]) await ensureStorage(slug).catch((e) => log("error", `storage ${slug}: ${String(e).slice(0, 100)}`));
  for (const a of AGENTS) {
    const left = await keyAllowance(a.slug);
    if (left === null && agentKeys[a.slug]) continue; // unlimited
    if (!agentKeys[a.slug] || (left !== null && left < nearToYocto("0.2"))) {
      await issueAgentKey(a.slug).then(() => log("agent_key", `${a.name} got a fresh function-call key (${AGENT_METHODS.length} methods)`)).catch((e) => log("error", `key ${a.slug}: ${String(e).slice(0, 100)}`));
    }
  }
  await sweepStale();
  const balanceOf = async (acc: string) => BigInt(await view<string>("ft_balance_of", { account_id: acc }, USDC));
  for (const slug of [...LENDERS.map((l) => l.slug), ...Object.values(VENDORS), ...AGENTS.map((a) => a.slug), ...CUSTOMERS]) {
    const owed = BigInt(await view<string>("get_balance", { account_id: id(slug) }));
    const isAgent = AGENTS.some((a) => a.slug === slug);
    if (owed > usd(5)) await tx(isAgent ? agentSigner(slug) : acct(slug), "withdraw", {}, LOCA, 0n, isAgent ? WITHDRAW_GAS : undefined).catch(() => {});
  }
  for (const c of CUSTOMERS) if ((await balanceOf(id(c))) < usd(400)) await tx(root, "mint", { account_id: id(c), amount: usd(2000).toString() }, USDC);
  for (const a of AGENTS) {
    const ag = await view<Agent>("get_agent", { agent_id: id(a.slug) });
    if (BigInt(ag.bond) < usd(a.bond / 2)) {
      const r = await ftCall(acct(a.operator), usd(a.bond), { PostBond: { agent_id: id(a.slug) } });
      log("bond_posted", `${a.operator} tops up ${a.name}'s bond by ${fmtUsd(usd(a.bond))}`, { tx: r.hash });
    }
  }
  for (const l of LENDERS) if ((await balanceOf(id(l.slug))) < usd(400)) await tx(root, "mint", { account_id: id(l.slug), amount: usd(1500).toString() }, USDC);
  for (const o of OPERATORS) if ((await balanceOf(id(o))) < usd(60)) await tx(root, "mint", { account_id: id(o), amount: usd(300).toString() }, USDC);
  // NEAR for gas and storage.
  for (const slug of ["market", ...ACTORS]) await ensureNear(slug);
}

let stopping = false;

async function run(minutes: number) {
  if (!existsSync(STATE_FILE)) throw new Error("Run `pnpm swarm setup` first");
  const until = Date.now() + minutes * 60_000;
  console.log(`Swarm on ${LOCA} for ${minutes} min. Ctrl-C stops new orders; open ones finish.\n`);
  process.on("SIGINT", () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log("\nStopping: letting open orders settle (Ctrl-C again to quit now)…");
  });
  const keeper = (async () => {
    while (Date.now() < until && !stopping) {
      await housekeeping().catch((e) => log("error", `housekeeping: ${String(e).slice(0, 160)}`));
      await sleep(90_000);
    }
  })();
  await Promise.all([...AGENTS.map((a) => agentWorker(a, until)), keeper]);
  await housekeeping().catch(() => {});
  const m = await view<{ totals: Record<string, unknown> }>("get_market");
  console.log("\nSession:", counters);
  console.log("Market totals:", m.totals);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "setup") await setup();
else if (cmd === "upgrade") {
  // Deploy the current build over the live market and migrate its state in place.
  await acct("market").deployContract(readFileSync(WASM.loca));
  await call(acct("market"), LOCA, "migrate", {});
  const m = await view<{ totals: { orders: number } }>("get_market");
  console.log(`Upgraded ${LOCA}; ${m.totals.orders} orders carried over.`);
}
else if (cmd === "keys") {
  for (const a of AGENTS) {
    await ensureStorage(a.slug);
    if (!agentKeys[a.slug]) { await issueAgentKey(a.slug); console.log(`${a.name}: function-call key issued`); }
  }
  for (const l of LENDERS) await ensureStorage(l.slug);
}
else if (cmd === "run") await run(Number(arg ?? 60));
else console.log("usage: pnpm swarm setup | pnpm swarm run [minutes]");
